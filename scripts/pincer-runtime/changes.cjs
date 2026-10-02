'use strict';
// PINCER runtime — change records (docs/runtime-contracts.md, "Change records").
// `.prd/changes/<id>.json` with schema 2 is the portable identity and history of
// one change; several coexist, each owning exactly one PRD. This module reads
// and validates the whole directory (mode detection, per-record validation,
// projection replay, cross-record ownership and supersession rules), registers
// new records through the transaction API, and renders list/show. Nothing here
// grants approval or executes anything.
const fs = require('node:fs');
const path = require('node:path');
const parse = require('./parse.cjs');
const transaction = require('./transaction.cjs');
const { readJson, nowIso, tryGit } = require('./fsutil.cjs');

const SCHEMA = 2;
const RUNTIME = 2;
// Strict coverage (PRD v6): schema 3 records carry the retained capability.
const SCHEMA_STRICT = 3;
const RUNTIME_STRICT = 3;
const RECORD_SCHEMAS = [SCHEMA, SCHEMA_STRICT];
const CHANGE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SUB_ID = /^[GAD]-[0-9]{2,6}$/;
const STATES = ['planned', 'active', 'paused', 'completed', 'cancelled', 'superseded'];
const TERMINAL = ['cancelled', 'superseded'];
// kind -> [allowed from states, to state]; null from = record creation.
const LIFECYCLE_KINDS = {
  register: [[null], 'planned'], migrate: [[null], 'planned'], activate: [['planned'], 'active'], pause: [['active'], 'paused'],
  resume: [['paused'], 'active'], complete: [['active'], 'completed'], reopen: [['completed'], 'active'],
  cancel: [['planned', 'active', 'paused'], 'cancelled'], supersede: [['planned', 'active', 'paused', 'completed'], 'superseded'],
};
const OTHER_KINDS = ['agreement', 'authorize', 'decide', 'resolve', 'adopt'];
const EVENT_KINDS = [...Object.keys(LIFECYCLE_KINDS), 'agreement', 'authorize', 'decide', 'resolve'];
const EVENT_KINDS_STRICT = [...EVENT_KINDS, 'adopt'];
const RECORD_KEYS = ['schema', 'runtime', 'change', 'prd', 'base', 'registered', 'sequence', 'lifecycle', 'agreements', 'authorizations', 'decisions', 'events', 'evaluations', 'legacy'];
const RECORD_KEYS_STRICT = [...RECORD_KEYS, 'coverage'];
const COVERAGE_KEYS = ['map', 'adopted', 'agreement'];
const LIFECYCLE_KEYS = ['state', 'since', 'reason', 'note', 'superseded_by'];
const AGREEMENT_KEYS = ['id', 'digest', 'prd_revision', 'breakdown', 'tickets', 'decisions', 'snapshot', 'recorded'];
const AGREEMENT_KEYS_STRICT = ['id', 'digest', 'prd_revision', 'breakdown', 'inventory', 'coverage', 'tickets', 'decisions', 'snapshot', 'recorded'];
const AUTHORIZATION_KEYS = ['id', 'agreement', 'digest', 'disposition', 'reference', 'excerpt', 'constraints', 'basis', 'explanation', 'decisions', 'recorded'];
const DECISION_KEYS = ['id', 'status', 'summary', 'reference', 'excerpt', 'raised', 'resolved'];
const EVENT_KEYS = ['sequence', 'kind', 'from', 'to', 'at', 'reason', 'agreement', 'authorization', 'decision', 'replacement', 'note'];
const LEGACY_KEYS = ['receipts', 'authorization_text', 'migrated_from', 'migrated'];
const MAX_TEXT = transaction.MAX_TEXT;

const CHANGES_DIR = '.prd/changes';
const COVERAGE_DIR = '.prd/coverage';
const isStrict = record => Boolean(record) && record.schema === SCHEMA_STRICT;
const recordFile = id => `${CHANGES_DIR}/${id}.json`;
const snapshotFile = (id, agreementId) => `${CHANGES_DIR}/${id}/agreements/${agreementId}.json`;
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = v => typeof v === 'string' && v.length > 0;
const textOrNull = v => v === null || (typeof v === 'string' && v.length <= MAX_TEXT);
const nonemptyText = v => typeof v === 'string' && v.trim() !== '' && v.length <= MAX_TEXT;
const timestamp = v => typeof v === 'string' && parse.TIMESTAMP.test(v);
const sequentialId = (prefix, i) => `${prefix}-${String(i + 1).padStart(2, '0')}`;

// --- Projection replay ------------------------------------------------------------
// The lifecycle projection is what the events say it is. Returns { state,
// superseded_by, since, reason, note } or { error }.
function replay(events) {
  let state = null, superseded_by = null, since = null, reason = null, note = null;
  for (const [i, e] of events.entries()) {
    if (!isObject(e)) return { error: `event ${i + 1} is not an object` };
    if (e.sequence !== i + 1) return { error: `event ${i + 1} carries sequence ${JSON.stringify(e.sequence)}` };
    const rule = e.kind === 'migrate' && state !== null ? null : LIFECYCLE_KINDS[e.kind];
    if (rule) {
      if (!rule[0].includes(state)) return { error: `event ${e.sequence} (${e.kind}) is not permitted from ${state === null ? 'no record' : state}` };
      if (e.from !== state || e.to !== rule[1]) return { error: `event ${e.sequence} (${e.kind}) records ${JSON.stringify(e.from)} → ${JSON.stringify(e.to)}, expected ${JSON.stringify(state)} → ${rule[1]}` };
      state = rule[1]; since = e.at; reason = e.reason ?? null; note = e.note ?? null;
      superseded_by = e.kind === 'supersede' ? e.replacement : null;
      if (e.kind === 'supersede' && !(typeof e.replacement === 'string' && CHANGE_ID.test(e.replacement))) return { error: `event ${e.sequence} (supersede) names no replacement change` };
      if ((e.kind === 'cancel' || e.kind === 'supersede') && !(typeof e.decision === 'string' && SUB_ID.test(e.decision) && e.decision.startsWith('D-'))) return { error: `event ${e.sequence} (${e.kind}) names no decision` };
    } else if (OTHER_KINDS.includes(e.kind) || e.kind === 'migrate') {
      if (state === null) return { error: `event ${e.sequence} (${e.kind}) precedes the record's creation` };
      if (e.from !== state || e.to !== state) return { error: `event ${e.sequence} (${e.kind}) changes the state` };
    } else return { error: `event ${e.sequence} has unknown kind ${JSON.stringify(e.kind)}` };
  }
  if (state === null) return { error: 'no events' };
  return { state, superseded_by, since, reason, note };
}

// --- Per-record validation ---------------------------------------------------------
// Returns null or { code: MALFORMED | UNSUPPORTED_SCHEMA | HISTORY_INVALID, problem }.
function validateRecord(doc, file) {
  const where = file || (isObject(doc) && str(doc.change) ? recordFile(doc.change) : `${CHANGES_DIR}/?`);
  const malformed = p => ({ code: 'MALFORMED', problem: `${where}: ${p}` });
  const history = p => ({ code: 'HISTORY_INVALID', problem: `${where}: ${p}` });
  if (!isObject(doc)) return malformed('record must be a JSON object');
  if (!RECORD_SCHEMAS.includes(doc.schema)) return { code: 'UNSUPPORTED_SCHEMA', problem: `${where}: unsupported change record schema ${JSON.stringify(doc.schema)} (this runtime reads schema 2 and 3 records and schema 1 bindings)` };
  const strict = doc.schema === SCHEMA_STRICT;
  const recordKeys = strict ? RECORD_KEYS_STRICT : RECORD_KEYS;
  const agreementKeys = strict ? AGREEMENT_KEYS_STRICT : AGREEMENT_KEYS;
  const eventKinds = strict ? EVENT_KINDS_STRICT : EVENT_KINDS;
  const capability = 'the strict coverage capability cannot be removed by editing the record; restore the backed-up schema 2 record instead';
  for (const key of Object.keys(doc)) if (!recordKeys.includes(key)) return malformed(`unknown key "${key}"${key === 'coverage' ? ' (a schema 2 record carries no strict coverage capability; adoption writes a schema 3 record)' : ''}`);
  for (const key of recordKeys) if (!(key in doc)) return malformed(`missing key "${key}"${key === 'coverage' ? ` (${capability})` : ''}`);
  if (strict && doc.coverage === null) return malformed(capability);
  if (doc.runtime !== (strict ? RUNTIME_STRICT : RUNTIME)) return { code: 'UNSUPPORTED_SCHEMA', problem: `${where}: unsupported runtime contract ${JSON.stringify(doc.runtime)}` };
  if (!str(doc.change) || !CHANGE_ID.test(doc.change)) return malformed('change must match [a-z0-9][a-z0-9-]{0,63}');
  if (file && path.basename(file, '.json') !== doc.change) return malformed(`filename does not match change "${doc.change}"`);
  if (!str(doc.prd) || !parse.PRD_REF.test(doc.prd)) return malformed('prd must be of the form .prd/prd-vN.md');
  if (!str(doc.base) || !parse.HEX40.test(doc.base)) return malformed('base must be a full 40-hex commit ID');
  if (!timestamp(doc.registered)) return malformed('registered must be an ISO UTC timestamp');
  if (!Number.isInteger(doc.sequence) || doc.sequence < 1) return malformed('sequence must be a positive integer');
  for (const [key, keys] of [['lifecycle', LIFECYCLE_KEYS], ['legacy', LEGACY_KEYS]]) {
    if (!isObject(doc[key])) return malformed(`${key} must be an object`);
    for (const k of Object.keys(doc[key])) if (!keys.includes(k)) return malformed(`${key}.${k} is not allowed`);
    for (const k of keys) if (!(k in doc[key])) return malformed(`${key}.${k} is missing`);
  }
  for (const key of ['agreements', 'authorizations', 'decisions', 'events', 'evaluations']) if (!Array.isArray(doc[key])) return malformed(`${key} must be an array`);
  if (doc.evaluations.length) return malformed('evaluations must be empty in schema 2 (evaluation references live in the evaluation locator)');
  const lc = doc.lifecycle;
  if (!STATES.includes(lc.state)) return malformed(`lifecycle.state must be one of ${STATES.join(', ')}`);
  if (!timestamp(lc.since)) return malformed('lifecycle.since must be an ISO UTC timestamp');
  if (!textOrNull(lc.reason) || !textOrNull(lc.note)) return malformed('lifecycle.reason and lifecycle.note must be null or short strings');
  if (!(lc.superseded_by === null || (str(lc.superseded_by) && CHANGE_ID.test(lc.superseded_by)))) return malformed('lifecycle.superseded_by must be null or a change ID');
  if ((lc.state === 'superseded') !== (lc.superseded_by !== null)) return malformed('lifecycle.superseded_by is set exactly when the state is superseded');
  // Decisions first: agreements and authorizations refer to them.
  const decisions = new Map();
  for (const [i, d] of doc.decisions.entries()) {
    if (!isObject(d)) return malformed(`decisions[${i}] must be an object`);
    for (const k of Object.keys(d)) if (!DECISION_KEYS.includes(k)) return malformed(`decisions[${i}].${k} is not allowed`);
    for (const k of DECISION_KEYS) if (!(k in d)) return malformed(`decisions[${i}].${k} is missing`);
    if (d.id !== sequentialId('D', i)) return malformed(`decisions[${i}].id must be ${sequentialId('D', i)}`);
    if (!['open', 'resolved'].includes(d.status)) return malformed(`${d.id}: status must be open or resolved`);
    if (!nonemptyText(d.summary)) return malformed(`${d.id}: summary must be a nonempty short string`);
    if (!timestamp(d.raised)) return malformed(`${d.id}: raised must be an ISO UTC timestamp`);
    if (d.status === 'resolved') {
      if (!nonemptyText(d.reference) || !nonemptyText(d.excerpt)) return malformed(`${d.id}: a resolved decision needs reference and excerpt`);
      if (!timestamp(d.resolved)) return malformed(`${d.id}: resolved must be an ISO UTC timestamp`);
    } else if (d.reference !== null || d.excerpt !== null || d.resolved !== null) return malformed(`${d.id}: an open decision carries null reference, excerpt and resolved`);
    decisions.set(d.id, d);
  }
  const decisionRefs = (list, label) => {
    if (!Array.isArray(list)) return `${label}: decisions must be an array`;
    for (const id of list) { const d = decisions.get(id); if (!d) return `${label}: references unknown decision ${JSON.stringify(id)}`; if (d.status !== 'resolved') return `${label}: references open decision ${id}`; }
    return null;
  };
  const agreements = new Map();
  for (const [i, g] of doc.agreements.entries()) {
    if (!isObject(g)) return malformed(`agreements[${i}] must be an object`);
    for (const k of Object.keys(g)) if (!agreementKeys.includes(k)) return malformed(`agreements[${i}].${k} is not allowed`);
    for (const k of agreementKeys) if (!(k in g)) return malformed(`agreements[${i}].${k} is missing`);
    if (strict) for (const k of ['inventory', 'coverage']) if (!(g[k] === null || (str(g[k]) && SHA256.test(g[k])))) return malformed(`${g.id}: ${k} must be null or a 64-hex digest`);
    if (g.id !== sequentialId('G', i)) return malformed(`agreements[${i}].id must be ${sequentialId('G', i)}`);
    for (const k of ['digest', 'prd_revision', 'breakdown']) if (!str(g[k]) || !SHA256.test(g[k])) return malformed(`${g.id}: ${k} must be a 64-hex digest`);
    if (!Array.isArray(g.tickets) || !g.tickets.every(t => parse.canonicalId(t))) return malformed(`${g.id}: tickets must be canonical ticket IDs`);
    const refs = decisionRefs(g.decisions, g.id); if (refs) return malformed(refs);
    if (g.snapshot !== snapshotFile(doc.change, g.id)) return malformed(`${g.id}: snapshot must be ${snapshotFile(doc.change, g.id)}`);
    if (!timestamp(g.recorded)) return malformed(`${g.id}: recorded must be an ISO UTC timestamp`);
    agreements.set(g.id, g);
  }
  const authorizations = new Map();
  for (const [i, a] of doc.authorizations.entries()) {
    if (!isObject(a)) return malformed(`authorizations[${i}] must be an object`);
    for (const k of Object.keys(a)) if (!AUTHORIZATION_KEYS.includes(k)) return malformed(`authorizations[${i}].${k} is not allowed`);
    for (const k of AUTHORIZATION_KEYS) if (!(k in a)) return malformed(`authorizations[${i}].${k} is missing`);
    if (a.id !== sequentialId('A', i)) return malformed(`authorizations[${i}].id must be ${sequentialId('A', i)}`);
    const g = agreements.get(a.agreement);
    if (!g) return history(`${a.id}: references unknown agreement ${JSON.stringify(a.agreement)}`);
    if (a.digest !== g.digest) return history(`${a.id}: digest does not equal ${g.id}'s`);
    if (!['user', 'delegated'].includes(a.disposition)) return malformed(`${a.id}: disposition must be user or delegated`);
    if (!textOrNull(a.constraints)) return malformed(`${a.id}: constraints must be null or a short string`);
    if (a.disposition === 'user') {
      if (!nonemptyText(a.reference) || !nonemptyText(a.excerpt)) return malformed(`${a.id}: a user authorization needs reference and excerpt`);
      if (a.basis !== null || a.explanation !== null) return malformed(`${a.id}: a user authorization carries null basis and explanation`);
    } else {
      if (a.reference !== null || a.excerpt !== null) return malformed(`${a.id}: a delegated authorization carries null reference and excerpt`);
      if (!nonemptyText(a.explanation)) return malformed(`${a.id}: a delegated authorization needs an explanation`);
      if (!authorizations.has(a.basis)) return history(`${a.id}: basis ${JSON.stringify(a.basis)} is not an earlier authorization of this change`);
    }
    const refs = decisionRefs(a.decisions, a.id); if (refs) return malformed(refs);
    if (!timestamp(a.recorded)) return malformed(`${a.id}: recorded must be an ISO UTC timestamp`);
    authorizations.set(a.id, a);
  }
  for (const [i, e] of doc.events.entries()) {
    if (!isObject(e)) return malformed(`events[${i}] must be an object`);
    for (const k of Object.keys(e)) if (!EVENT_KEYS.includes(k)) return malformed(`events[${i}].${k} is not allowed`);
    for (const k of EVENT_KEYS) if (!(k in e)) return malformed(`events[${i}].${k} is missing`);
    if (!eventKinds.includes(e.kind)) return malformed(`events[${i}].kind must be one of ${eventKinds.join(', ')}${e.kind === 'adopt' ? ' (a schema 2 record carries no adopt event; adoption writes a schema 3 record)' : ''}`);
    if (!timestamp(e.at)) return malformed(`events[${i}].at must be an ISO UTC timestamp`);
    if (!textOrNull(e.reason) || !textOrNull(e.note)) return malformed(`events[${i}]: reason and note must be null or short strings`);
    if (!(e.agreement === null || agreements.has(e.agreement))) return history(`events[${i}]: references unknown agreement ${JSON.stringify(e.agreement)}`);
    if (!(e.authorization === null || authorizations.has(e.authorization))) return history(`events[${i}]: references unknown authorization ${JSON.stringify(e.authorization)}`);
    if (!(e.decision === null || decisions.has(e.decision))) return history(`events[${i}]: references unknown decision ${JSON.stringify(e.decision)}`);
    if (!(e.replacement === null || (str(e.replacement) && CHANGE_ID.test(e.replacement)))) return malformed(`events[${i}].replacement must be null or a change ID`);
  }
  if (doc.sequence !== doc.events.length) return history(`sequence is ${doc.sequence} but the history has ${doc.events.length} event(s)`);
  const projected = replay(doc.events);
  if (projected.error) return history(projected.error);
  if (projected.state !== lc.state) return history(`lifecycle.state is ${lc.state} but the history ends at ${projected.state}`);
  if ((projected.superseded_by || null) !== lc.superseded_by) return history(`lifecycle.superseded_by disagrees with the supersede event`);
  if (lc.superseded_by === doc.change) return history('a change cannot supersede itself');
  if (strict) {
    const cv = doc.coverage;
    if (!isObject(cv)) return malformed('coverage must be an object { map, adopted, agreement }');
    for (const k of Object.keys(cv)) if (!COVERAGE_KEYS.includes(k)) return malformed(`coverage.${k} is not allowed`);
    for (const k of COVERAGE_KEYS) if (!(k in cv)) return malformed(`coverage.${k} is missing`);
    if (cv.map !== `${COVERAGE_DIR}/${doc.change}.json`) return malformed(`coverage.map must be ${COVERAGE_DIR}/${doc.change}.json`);
    if (!timestamp(cv.adopted)) return malformed('coverage.adopted must be an ISO UTC timestamp');
    const g = agreements.get(cv.agreement);
    if (!g) return history(`coverage.agreement ${JSON.stringify(cv.agreement)} is not an agreement of this record`);
    if (g.inventory === null || g.coverage === null) return history(`coverage.agreement ${g.id} carries no inventory and coverage digests (it predates adoption)`);
    const adopts = doc.events.filter(e => e.kind === 'adopt');
    if (adopts.length !== 1) return history(`a strict record carries exactly one adopt event (found ${adopts.length})`);
    if (adopts[0].agreement !== cv.agreement) return history(`the adopt event names agreement ${JSON.stringify(adopts[0].agreement)}, coverage.agreement is ${cv.agreement}`);
  }
  const lg = doc.legacy;
  if (!isObject(lg.receipts)) return malformed('legacy.receipts must be an object');
  for (const [id, r] of Object.entries(lg.receipts)) {
    if (!parse.canonicalId(id) || !isObject(r) || !['verified', 'last_check'].every(k => k in r && (r[k] === null || typeof r[k] === 'string'))) return malformed(`legacy.receipts[${id}] must be { verified, last_check }`);
  }
  if (!textOrNull(lg.authorization_text)) return malformed('legacy.authorization_text must be null or a short string');
  if (!(lg.migrated_from === null || ['legacy', 'binding'].includes(lg.migrated_from))) return malformed('legacy.migrated_from must be null, legacy or binding');
  if (!(lg.migrated === null || timestamp(lg.migrated))) return malformed('legacy.migrated must be null or an ISO UTC timestamp');
  if ((lg.migrated_from === null) !== (lg.migrated === null)) return malformed('legacy.migrated_from and legacy.migrated are set together');
  return null;
}

// --- Directory scan and mode ---------------------------------------------------------
function listFiles(root) {
  const dir = path.join(root, CHANGES_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(name => name.endsWith('.json')).sort().map(name => `${CHANGES_DIR}/${name}`);
}
// Classify every file: schema 1 bindings, schema 2 records, and files this
// runtime cannot read. Mode: legacy (nothing), migrated (schema 1 only; the
// v0.5.0 rules decide the rest), changes (schema 2 only, readable or not),
// invalid (mixed schemas, or nothing readable).
function scan(root) {
  const entries = [];
  for (const file of listFiles(root)) {
    const read = readJson(path.join(root, file));
    if (read.error) { entries.push({ file, code: 'MALFORMED', problem: `${file}: ${read.error}` }); continue; }
    const doc = read.data;
    if (!isObject(doc)) { entries.push({ file, code: 'MALFORMED', problem: `${file}: record must be a JSON object` }); continue; }
    if (doc.schema === 1) entries.push({ file, schema: 1, doc });
    else if (RECORD_SCHEMAS.includes(doc.schema)) entries.push({ file, schema: doc.schema, record: true, id: path.basename(file, '.json'), doc });
    else entries.push({ file, code: 'UNSUPPORTED_SCHEMA', problem: `${file}: unsupported schema ${JSON.stringify(doc.schema)} (this runtime reads schema 1 bindings and schema 2 and 3 change records)` });
  }
  const one = entries.filter(e => e.schema === 1), two = entries.filter(e => e.record), bad = entries.filter(e => e.code);
  const problems = [];
  let mode;
  if (!entries.length) mode = 'legacy';
  else if (one.length && two.length) { mode = 'invalid'; problems.push({ code: 'INPUT_INVALID', detail: `${CHANGES_DIR}/ mixes a schema 1 binding (${one.map(e => path.basename(e.file)).join(', ')}) with schema 2 change records (${two.map(e => path.basename(e.file)).join(', ')}); migrate the binding or remove the records by hand` }); }
  else if (two.length) mode = 'changes';
  else if (one.length) mode = 'migrated';
  else mode = 'invalid';
  for (const e of bad) if (mode !== 'migrated') problems.push({ code: e.code, detail: e.problem });
  return { mode, entries, problems };
}

// Load and validate every schema 2 record and the cross-record rules. Returns
// { mode, records: Map<id, { record, file }>, problems: [{ code, detail }], pending }.
function loadRecords(root) {
  const s = scan(root);
  const out = { mode: s.mode, records: new Map(), problems: [...s.problems], pending: transaction.pending(root) };
  if (s.mode !== 'changes') return out;
  if (out.pending.committed.length) out.problems.push({ code: 'STATE_INCOMPLETE', detail: `a committed transaction (${out.pending.committed[0].command || out.pending.committed[0].id}) was not fully applied; run: node scripts/pincer-runtime.cjs recover` });
  const owners = new Map();
  for (const e of s.entries.filter(x => x.record)) {
    const invalid = validateRecord(e.doc, e.file);
    if (invalid) { out.problems.push({ code: invalid.code, detail: invalid.problem }); continue; }
    // Every recorded agreement must be reviewable: its snapshot exists and its
    // digest recomputes from the snapshot (docs/runtime-contracts.md).
    const agreement = require('./agreement.cjs');
    const badSnapshot = e.doc.agreements.map(g => agreement.readSnapshot(root, e.doc, g)).find(r => r.code);
    if (badSnapshot) { out.problems.push({ code: badSnapshot.code, detail: badSnapshot.problem }); continue; }
    out.records.set(e.id, { record: e.doc, file: e.file });
    const prior = owners.get(e.doc.prd);
    if (prior) out.problems.push({ code: 'INPUT_INVALID', detail: `duplicate PRD ownership: ${e.doc.prd} is owned by change "${prior}" and change "${e.id}"; remove one record by hand` });
    else owners.set(e.doc.prd, e.id);
  }
  for (const [id, { record }] of out.records) {
    const target = record.lifecycle.superseded_by;
    if (target === null) continue;
    if (!out.records.has(target)) { out.problems.push({ code: 'HISTORY_INVALID', detail: `${recordFile(id)}: superseded by "${target}", which is not a retained change record` }); continue; }
    const seen = new Set([id]);
    let cursor = target;
    while (cursor && out.records.has(cursor)) {
      if (seen.has(cursor)) { out.problems.push({ code: 'HISTORY_INVALID', detail: `${recordFile(id)}: supersession returns to "${cursor}" (a cycle)` }); break; }
      seen.add(cursor);
      cursor = out.records.get(cursor).record.lifecycle.superseded_by;
    }
  }
  return out;
}
// One record by id (after the directory validated). { record, file, loaded } or { code, problem }.
function loadRecord(root, id) {
  const loaded = loadRecords(root);
  if (loaded.mode === 'legacy') return { code: 'CHANGE_REQUIRED', problem: `no change record under ${CHANGES_DIR}/ — register with: node scripts/pincer-runtime.cjs register --prd .prd/prd-vN.md`, loaded };
  if (loaded.mode === 'migrated') return { code: 'MIGRATION_REQUIRED', problem: `${CHANGES_DIR}/ holds a v0.5.0 binding; migrate it first: node scripts/pincer-runtime.cjs migrate --preview --prd ${loaded.records.size ? '' : '<prd>'}`, loaded };
  if (loaded.problems.length) return { code: loaded.problems[0].code, problem: loaded.problems[0].detail, loaded };
  if (typeof id !== 'string' || !CHANGE_ID.test(id)) return { code: 'INPUT_INVALID', problem: `change ID must match [a-z0-9][a-z0-9-]{0,63}: ${id}`, loaded };
  const entry = loaded.records.get(id);
  if (!entry) return { code: 'INPUT_INVALID', problem: `no change record ${recordFile(id)} (retained: ${[...loaded.records.keys()].join(', ') || 'none'})`, loaded };
  return { ...entry, loaded };
}
const ownerOf = (loaded, prd) => [...loaded.records.entries()].find(([, e]) => e.record.prd === prd) || null;

function head(root) {
  const result = tryGit(root, ['rev-parse', '--verify', 'HEAD^{commit}']);
  if (result.error || !parse.HEX40.test(result.out.trim())) return null;
  return result.out.trim();
}
const IGNORE_LINE = '.pincer/';
function gitignoreHas(text) {
  return text.split('\n').map(l => l.trim()).some(l => l === IGNORE_LINE || l === '/.pincer/' || l === '.pincer');
}
function gitignoreWith(existing) {
  const lead = existing && !existing.endsWith('\n') ? '\n' : '';
  return `${existing}${lead}${existing ? '\n' : ''}# pincer runtime state (added by the runtime)\n${IGNORE_LINE}\n`;
}

function newRecord({ change, prd, base, now, kind = 'register', legacy = null }) {
  return {
    schema: SCHEMA, runtime: RUNTIME, change, prd, base, registered: now, sequence: 1,
    lifecycle: { state: 'planned', since: now, reason: null, note: null, superseded_by: null },
    agreements: [], authorizations: [], decisions: [],
    events: [{ sequence: 1, kind, from: null, to: 'planned', at: now, reason: null, agreement: null, authorization: null, decision: null, replacement: null, note: null }],
    evaluations: [],
    legacy: legacy || { receipts: {}, authorization_text: null, migrated_from: null, migrated: null },
  };
}

// --- register (legacy or changes mode) ---------------------------------------------
// Writes a planned schema 2 record and ignores .pincer/, through one transaction.
// Returns { record, file, action: 'registered' | 'unchanged' } or { code, problem }.
function register(root, { prd, change } = {}) {
  const prdResult = parse.validatePrd(root, prd);
  if (!prdResult.ok) return { code: 'INPUT_INVALID', problem: `${prdResult.file || prd}: ${prdResult.problems[0]}` };
  const id = change || `prd-v${prd.match(parse.PRD_REF)[1]}`;
  if (!CHANGE_ID.test(id)) return { code: 'INPUT_INVALID', problem: `change ID must match [a-z0-9][a-z0-9-]{0,63}: ${id}` };
  const base = head(root);
  if (!base) return { code: 'UNSUPPORTED_INPUT', problem: 'registration needs a git repository with at least one commit (base = HEAD)' };
  try {
    const out = transaction.run(root, { command: `register ${id}` }, ctx => {
      const loaded = loadRecords(root);
      if (loaded.mode === 'migrated') ctx.refuse('MIGRATION_REQUIRED', `${CHANGES_DIR}/ holds a v0.5.0 binding; one binding per worktree in migrated mode — migrate to change records first: node scripts/pincer-runtime.cjs migrate --preview --prd <its prd>, then register ${prd}`);
      if (loaded.problems.length) ctx.refuse(loaded.problems[0].code, loaded.problems[0].detail);
      const existing = loaded.records.get(id);
      if (existing) {
        if (existing.record.prd === prd) return { record: existing.record, file: existing.file, action: 'unchanged' };
        ctx.refuse('INPUT_INVALID', `${existing.file} already names change "${id}" for ${existing.record.prd}; choose another --change ID for ${prd}`);
      }
      const owner = ownerOf(loaded, prd);
      if (owner) ctx.refuse('INPUT_INVALID', `${prd} is already owned by change "${owner[0]}" (${owner[1].file}); work on it with: node scripts/pincer-runtime.cjs change select ${owner[0]}`);
      const record = newRecord({ change: id, prd, base, now: ctx.now });
      const file = recordFile(id);
      ctx.write(file, record);
      const ignore = ctx.text('.gitignore') || '';
      if (!gitignoreHas(ignore)) ctx.write('.gitignore', gitignoreWith(ignore));
      return { record, file, action: 'registered' };
    });
    return out.result;
  } catch (error) {
    if (error.refusal) return { code: error.code, problem: error.message };
    if (error.code === 'STATE_BUSY') return { code: 'STATE_BUSY', problem: error.message };
    throw error;
  }
}

// --- list / show ----------------------------------------------------------------------
function summarize(id, { record, file }, extra = {}) {
  return { id, file, prd: record.prd, strict: isStrict(record), state: record.lifecycle.state, since: record.lifecycle.since, reason: record.lifecycle.reason, note: record.lifecycle.note, superseded_by: record.lifecycle.superseded_by, sequence: record.sequence, base: record.base, registered: record.registered, ...extra };
}
function list(root) {
  const loaded = loadRecords(root);
  const changes = [...loaded.records.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, e]) => summarize(id, e));
  return { mode: loaded.mode, changes, problems: loaded.problems };
}
const short = s => (typeof s === 'string' ? s.slice(0, 12) : '—');
function renderList(result, { selection = null } = {}) {
  const lines = [];
  if (result.mode === 'legacy') return 'Changes  none (legacy project; register with: node scripts/pincer-runtime.cjs register --prd .prd/prd-vN.md)\n';
  if (result.mode === 'migrated') return 'Changes  v0.5.0 binding (migrated mode); migrate to change records with: node scripts/pincer-runtime.cjs migrate --preview --prd <prd>\n';
  for (const p of result.problems) lines.push(`WARN     ${p.code}: ${p.detail}`);
  lines.push(`Changes  ${result.changes.length} retained${selection && selection.change ? ` · selected ${selection.change}` : ' · no selection'}`);
  for (const c of result.changes) {
    const mark = selection && selection.change === c.id ? '*' : ' ';
    let detail = `${c.prd} · since ${c.since} · sequence ${c.sequence}${c.authorization ? ` · authorization ${c.authorization}` : ''}`;
    if (c.state === 'superseded') detail += ` · by ${c.superseded_by}`;
    if (c.reason) detail += ` · ${c.reason}`;
    lines.push(`${mark} ${c.id.padEnd(16)} ${c.state.padEnd(10)} ${detail}`);
  }
  if (!result.changes.length) lines.push('  (no readable change record)');
  return `${lines.join('\n')}\n`;
}
function renderShow(id, { record, file }, extra = {}) {
  const r = record, lines = [];
  lines.push(`Change     ${id} · ${r.prd} · base ${r.base.slice(0, 7)} · registered ${r.registered} · sequence ${r.sequence} (${file})`);
  const lc = r.lifecycle;
  lines.push(`Lifecycle  ${lc.state} since ${lc.since}${lc.superseded_by ? ` · superseded by ${lc.superseded_by}` : ''}${lc.reason ? ` · reason: ${lc.reason}` : ''}${lc.note ? ` · note (authored): ${lc.note}` : ''}`);
  lines.push(`Agreements ${r.agreements.length ? r.agreements.map(g => `${g.id} ${short(g.digest)} (prd ${short(g.prd_revision)}, ${g.tickets.length} ticket(s), ${g.decisions.length} decision(s)) recorded ${g.recorded}`).join('; ') : 'none recorded'}`);
  if (extra.agreement) {
    const a = extra.agreement;
    if (a.code) lines.push(`Agreement  now: cannot be computed — ${a.code}: ${a.problem}`);
    else lines.push(`Agreement  now ${short(a.digest)}${a.entry ? ` = ${a.entry.id}` : a.latest ? ` ≠ latest recorded ${a.latest.id} ${short(a.latest.digest)} (${a.rendered}); record it with: node scripts/pincer-runtime.cjs change revise ${id}` : ' (not recorded; record it with: node scripts/pincer-runtime.cjs change revise ' + id + ')'}`);
  }
  lines.push(`Authorizations ${r.authorizations.length ? r.authorizations.map(a => `${a.id} ${a.disposition} for ${a.agreement} (${short(a.digest)}) recorded ${a.recorded}${a.disposition === 'user' ? ` — "${a.excerpt}" (${a.reference})` : ` — basis ${a.basis}: ${a.explanation}`}`).join('; ') : 'none'}`);
  if (extra.verdict) lines.push(`Authorization ${extra.verdict.verdict}${extra.verdict.verdict === 'current' ? ` — ${extra.verdict.detail}` : `: ${extra.verdict.detail}`}`);
  lines.push(`Decisions  ${r.decisions.length ? r.decisions.map(d => `${d.id} ${d.status}: ${d.summary}${d.status === 'resolved' ? ` — "${d.excerpt}" (${d.reference})` : ''}`).join('; ') : 'none'}`);
  lines.push(`Evaluations ${extra.locatorProblem ? `unreadable: ${extra.locatorProblem}` : extra.evaluations && extra.evaluations.length ? extra.evaluations.map(e => `${e.candidate.slice(0, 7)} ${e.manifest} recorded ${e.recorded}`).join('; ') : `none recorded (.prd/evidence/changes/${id}.json)`}`);
  lines.push(`Coverage   ${isStrict(r) ? `strict since ${r.coverage.adopted} · map ${r.coverage.map} · adoption agreement ${r.coverage.agreement}` : 'unverified (strict coverage not adopted; preview with: node scripts/pincer-runtime.cjs coverage adopt --preview --change ' + id + ')'}`);
  lines.push(`Legacy     ${r.legacy.migrated_from ? `migrated from ${r.legacy.migrated_from} at ${r.legacy.migrated}; ${Object.keys(r.legacy.receipts).length} receipt(s) as history${r.legacy.authorization_text ? `; v0.5.0 authorization text (unvalidated): "${r.legacy.authorization_text}"` : ''}` : 'none'}`);
  lines.push('Events');
  for (const e of r.events) lines.push(`  ${String(e.sequence).padStart(3)} ${e.at} ${e.kind.padEnd(10)} ${e.from === null ? '—' : e.from} → ${e.to}${e.agreement ? ` ${e.agreement}` : ''}${e.authorization ? ` ${e.authorization}` : ''}${e.decision ? ` ${e.decision}` : ''}${e.replacement ? ` → ${e.replacement}` : ''}${e.reason ? ` · ${e.reason}` : ''}${e.note ? ` · note: ${e.note}` : ''}`);
  return `${lines.join('\n')}\n`;
}

module.exports = {
  SCHEMA, RUNTIME, SCHEMA_STRICT, RUNTIME_STRICT, RECORD_SCHEMAS, CHANGE_ID, STATES, TERMINAL, LIFECYCLE_KINDS, EVENT_KINDS, EVENT_KINDS_STRICT, RECORD_KEYS, RECORD_KEYS_STRICT, AGREEMENT_KEYS, AGREEMENT_KEYS_STRICT, COVERAGE_KEYS, CHANGES_DIR, COVERAGE_DIR, IGNORE_LINE, isStrict,
  recordFile, snapshotFile, replay, validateRecord, scan, loadRecords, loadRecord, ownerOf, newRecord, register, list, summarize, renderList, renderShow, head, gitignoreHas, gitignoreWith,
};

// --- Selection (docs/runtime-contracts.md, "Selection") ---------------------------
// The selected change of this worktree: .pincer/runtime/selection.json, written
// only by `change select` and migration. No file → SELECTION_REQUIRED even when a
// single record exists; a file naming a missing or unreadable record →
// SELECTION_INVALID; never a fallback to another record or the highest PRD.
const state = require('./state.cjs');
const SELECTION_FILE = `${state.RUNTIME_DIR}/selection.json`;
const SELECTION_KEYS = ['schema', 'change', 'selected'];
function readSelection(root) {
  const file = path.join(root, SELECTION_FILE);
  const read = readJson(file);
  if (read.error === 'missing') return { code: 'SELECTION_REQUIRED', problem: 'no change is selected in this worktree; select one with: node scripts/pincer-runtime.cjs change select <id>' };
  if (read.error) return { code: 'MALFORMED', problem: `${SELECTION_FILE}: ${read.error}; select again with: node scripts/pincer-runtime.cjs change select <id>` };
  const doc = read.data;
  if (!isObject(doc) || doc.schema !== 1 || Object.keys(doc).some(k => !SELECTION_KEYS.includes(k)) || !SELECTION_KEYS.every(k => k in doc) || !str(doc.change) || !CHANGE_ID.test(doc.change) || !timestamp(doc.selected)) {
    return { code: 'MALFORMED', problem: `${SELECTION_FILE}: not a schema 1 selection { schema, change, selected }; select again with: node scripts/pincer-runtime.cjs change select <id>` };
  }
  return { change: doc.change, selected: doc.selected, file: SELECTION_FILE };
}
// Resolve the record commands act on: `--change <id>` inspects without touching
// the selection; otherwise the selection. Returns { record, file, id, loaded,
// selection, explicit } or { code, problem, loaded, selection }.
function resolveSelected(root, { change = null } = {}) {
  const loaded = loadRecords(root);
  const selection = readSelection(root);
  const base = { loaded, selection: selection.code ? null : selection, selectionProblem: selection.code ? selection : null };
  if (loaded.mode === 'legacy') return { ...base, code: 'CHANGE_REQUIRED', problem: `no change record under ${CHANGES_DIR}/ — register with: node scripts/pincer-runtime.cjs register --prd .prd/prd-vN.md` };
  if (loaded.mode === 'migrated') return { ...base, code: 'MIGRATION_REQUIRED', problem: `${CHANGES_DIR}/ holds a v0.5.0 binding; migrate it first: node scripts/pincer-runtime.cjs migrate --preview --prd <prd>` };
  if (loaded.problems.length && !(change || !selection.code)) return { ...base, code: loaded.problems[0].code, problem: loaded.problems[0].detail };
  const id = change || (selection.code ? null : selection.change);
  if (!id) return { ...base, code: selection.code, problem: `${selection.problem} (retained: ${[...loaded.records.keys()].join(', ') || 'none'})` };
  if (!CHANGE_ID.test(id)) return { ...base, code: 'INPUT_INVALID', problem: `change ID must match [a-z0-9][a-z0-9-]{0,63}: ${id}` };
  const entry = loaded.records.get(id);
  if (!entry) {
    const own = loaded.problems.find(p => p.detail.startsWith(`${recordFile(id)}:`) || p.detail.startsWith(`${CHANGES_DIR}/${id}/`));
    const why = own ? `is unreadable (${own.code}: ${own.detail})` : `does not exist (retained: ${[...loaded.records.keys()].join(', ') || 'none'})`;
    if (change) return { ...base, code: own ? own.code : 'INPUT_INVALID', problem: `change record ${recordFile(id)} ${why}` };
    return { ...base, code: 'SELECTION_INVALID', problem: `the selected change "${id}" ${why}; select another with: node scripts/pincer-runtime.cjs change select <id>, or repair the record` };
  }
  if (loaded.problems.length) return { ...base, code: loaded.problems[0].code, problem: loaded.problems[0].detail };
  return { ...base, ...entry, id, explicit: Boolean(change) };
}
// change select <id>: the local pointer only. Never touches HEAD, the index,
// tracked or untracked files; refuses an unknown or unreadable record.
function select(root, id) {
  if (typeof id !== 'string' || !CHANGE_ID.test(id)) return { code: 'INPUT_INVALID', problem: `change ID must match [a-z0-9][a-z0-9-]{0,63}: ${id}` };
  try {
    const out = transaction.run(root, { command: `change select ${id}` }, ctx => {
      const loaded = loadRecords(root);
      if (loaded.mode === 'legacy') ctx.refuse('CHANGE_REQUIRED', `no change record under ${CHANGES_DIR}/ — register with: node scripts/pincer-runtime.cjs register --prd .prd/prd-vN.md`);
      if (loaded.mode === 'migrated') ctx.refuse('MIGRATION_REQUIRED', `${CHANGES_DIR}/ holds a v0.5.0 binding; migrate it first: node scripts/pincer-runtime.cjs migrate --preview --prd <prd>`);
      if (loaded.problems.length) ctx.refuse(loaded.problems[0].code, loaded.problems[0].detail);
      const entry = loaded.records.get(id);
      if (!entry) ctx.refuse('INPUT_INVALID', `no change record ${recordFile(id)} (retained: ${[...loaded.records.keys()].join(', ') || 'none'})`);
      const current = readSelection(root);
      if (!current.code && current.change === id) return { action: 'unchanged', record: entry.record, file: entry.file, selected: current.selected };
      const selected = ctx.now;
      ctx.write(SELECTION_FILE, { schema: 1, change: id, selected });
      return { action: 'selected', record: entry.record, file: entry.file, selected, previous: current.code ? null : current.change };
    });
    return out.result;
  } catch (error) {
    if (error.refusal) return { code: error.code, problem: error.message };
    if (error.code === 'STATE_BUSY') return { code: 'STATE_BUSY', problem: error.message };
    throw error;
  }
}

// --- Repository view ---------------------------------------------------------------------
// Compatibility of a record with the working tree: HEAD exists, the PRD validates,
// the recorded base is an ancestor of HEAD. The branch name is printed as a hint
// only. Returns { head, branch, base_is_ancestor, dirty, prdResult, problems }.
function view(root, record) {
  const problems = [];
  const headSha = head(root);
  const branchRead = tryGit(root, ['symbolic-ref', '--short', '-q', 'HEAD']);
  const branch = branchRead.error ? null : branchRead.out.trim() || null;
  const dirtyRead = tryGit(root, ['status', '--porcelain', '--untracked-files=all']);
  const dirty = dirtyRead.error ? [] : dirtyRead.out.split('\n').filter(Boolean).map(l => l.slice(3).replace(/^"(.*)"$/, '$1'));
  const prdResult = parse.validatePrd(root, record.prd);
  let ancestor = false;
  if (!headSha) problems.push({ code: 'BASE_MISMATCH', detail: 'no commit at HEAD (not a git repository with commits)' });
  else {
    ancestor = !tryGit(root, ['merge-base', '--is-ancestor', record.base, 'HEAD']).error;
    if (!ancestor) problems.push({ code: 'BASE_MISMATCH', detail: `the recorded base ${record.base.slice(0, 7)} of change "${record.change}" is not an ancestor of HEAD ${headSha.slice(0, 7)}${branch ? ` (branch ${branch})` : ' (detached HEAD)'}${dirty.length ? `; dirty: ${dirty.slice(0, 5).join(', ')}${dirty.length > 5 ? ` (+${dirty.length - 5})` : ''}` : ''} — check out the branch that carries the change; the branch name is a hint, not proof` });
  }
  if (!prdResult.ok) problems.push({ code: 'BASE_MISMATCH', detail: `${record.prd}: ${prdResult.problems[0]} — the change's PRD is missing or invalid in this working tree` });
  return { head: headSha, branch, base_is_ancestor: ancestor, dirty, prdResult, problems };
}
// The change a ticket belongs to, through its PRD association. Returns
// { id, prd } or { problem } (no owner, or an unresolved association).
function ticketOwner(root, loaded, file, fields) {
  const assoc = require('./status.cjs').ticketPrd(root, file, fields);
  if (assoc.problem) return { problem: assoc.problem };
  const owner = ownerOf(loaded, assoc.prd);
  if (!owner) return { prd: assoc.prd, problem: `${file} belongs to ${assoc.prd}, which no change record owns — register it with: node scripts/pincer-runtime.cjs register --prd ${assoc.prd}` };
  return { id: owner[0], prd: assoc.prd, prdResult: assoc.prdResult };
}

Object.assign(module.exports, { SELECTION_FILE, readSelection, resolveSelected, select, view, ticketOwner });
