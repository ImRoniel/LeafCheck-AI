'use strict';
// PINCER runtime — the coverage map and the validated coverage graph
// (docs/runtime-contracts.md, "Strict coverage" → "Coverage map"). The map
// `.prd/coverage/<change-id>.json` is authored by hand: it owns links from
// scenarios to tickets and declared checks, ticket roles and planned scope
// dispositions; it never owns requirement prose or observed outcomes. This module
// parses it strictly (duplicate JSON keys, unknown keys, bounds, safe paths),
// normalizes it for the agreement digest, and resolves it against the inventory
// and the change's tickets into one validated graph that every consumer reads.
// COVERAGE_INVALID: the file cannot be interpreted. COVERAGE_INCOMPLETE: it can,
// but the graph is incomplete or disagrees with the inventory and the tickets.
// Nothing here writes a file, launches a check or judges semantics.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const parse = require('./parse.cjs');
const requirements = require('./requirements.cjs');
const { inlineSecretLine } = require('./sanitize.cjs');
const { readJson } = require('./fsutil.cjs');

const SCHEMA = 1;
const DIR = '.prd/coverage';
const MAX_BYTES = 1024 * 1024;
const MAX_TEXT = 2000;
const MAX_ENTRIES = 1000;
const MAP_KEYS = ['schema', 'change', 'prd', 'scenarios', 'scope', 'tickets', 'checks'];
const SCENARIO_KEYS = ['tickets', 'checks'];
const SCOPE_KEYS = ['disposition', 'decision', 'prior', 'note'];
const TICKET_KEYS = ['role', 'rationale'];
const CHECK_KEYS = ['kind', 'required', 'command', 'timeout', 'cwd', 'obligation', 'note'];
const KINDS = ['command', 'review', 'visual'];
const ROLES = ['implements', 'enables'];
const DISPOSITIONS = ['deferred', 'removed'];
const CHECK_ID = /^C-[0-9]{2,6}$/;
const DECISION_ID = /^D-[0-9]{2,6}$/;
const AGREEMENT_ID = /^G-[0-9]{2,6}$/;
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const file = id => `${DIR}/${id}.json`;

// --- Strict JSON (duplicate keys are an error, unlike JSON.parse) -------------------
function parseStrict(text) {
  let i = 0;
  const fail = message => { throw new Error(`${message} at offset ${i}`); };
  const ws = () => { while (i < text.length && ' \t\n\r'.includes(text[i])) i++; };
  const value = () => {
    ws();
    const c = text[i];
    if (c === '{') return object();
    if (c === '[') return array();
    if (c === '"') return string();
    if (c === 't' && text.startsWith('true', i)) { i += 4; return true; }
    if (c === 'f' && text.startsWith('false', i)) { i += 5; return false; }
    if (c === 'n' && text.startsWith('null', i)) { i += 4; return null; }
    const m = text.slice(i).match(/^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/);
    if (m) { i += m[0].length; return Number(m[0]); }
    fail(c === undefined ? 'unexpected end of input' : `unexpected token ${JSON.stringify(c)}`);
  };
  const string = () => {
    let out = ''; i++;
    for (;;) {
      if (i >= text.length) fail('unterminated string');
      const c = text[i++];
      if (c === '"') return out;
      if (c === '\\') {
        const e = text[i++];
        if (e === 'u') { const hex = text.slice(i, i + 4); if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('bad unicode escape'); out += String.fromCharCode(parseInt(hex, 16)); i += 4; }
        else { const map = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }; if (!(e in map)) fail(`bad escape \\${e}`); out += map[e]; }
      } else if (c < ' ') fail('control character in string');
      else out += c;
    }
  };
  const object = () => {
    const out = {}; i++; ws();
    if (text[i] === '}') { i++; return out; }
    for (;;) {
      ws();
      if (text[i] !== '"') fail('expected a string key');
      const key = string();
      if (Object.prototype.hasOwnProperty.call(out, key)) throw new Error(`duplicate key ${JSON.stringify(key)}`);
      ws();
      if (text[i] !== ':') fail('expected ":"');
      i++;
      out[key] = value();
      ws();
      if (text[i] === ',') { i++; continue; }
      if (text[i] === '}') { i++; return out; }
      fail('expected "," or "}"');
    }
  };
  const array = () => {
    const out = []; i++; ws();
    if (text[i] === ']') { i++; return out; }
    for (;;) {
      out.push(value());
      ws();
      if (text[i] === ',') { i++; continue; }
      if (text[i] === ']') { i++; return out; }
      fail('expected "," or "]"');
    }
  };
  const result = value();
  ws();
  if (i < text.length) fail('trailing characters');
  return result;
}

// --- Paths -------------------------------------------------------------------------------
// Why a repository-relative path is unsafe, or null.
function unsafePath(p) {
  if (typeof p !== 'string' || p === '') return 'must be a nonempty repository-relative path';
  if (p.startsWith('/')) return 'absolute paths are not allowed';
  if (/^[A-Za-z]:/.test(p)) return 'drive-letter paths are not allowed';
  if (p.includes('\\')) return 'backslashes are not allowed';
  if (p.split('/').some(s => s === '' || s === '.' || s === '..')) return 'must be normalized (no "..", "." or empty segments)';
  return null;
}
// Every component of a repository-relative path must exist and none may be a symlink.
function realFile(root, rel, { directory = false } = {}) {
  const segments = rel.split('/');
  let current = root;
  for (let k = 0; k < segments.length; k++) {
    current = path.join(current, segments[k]);
    let stat;
    try { stat = fs.lstatSync(current); } catch { return `${rel}: missing`; }
    if (stat.isSymbolicLink()) return `${rel}: ${k === segments.length - 1 ? 'is a symbolic link' : `path component ${segments.slice(0, k + 1).join('/')} is a symbolic link`}`;
    const last = k === segments.length - 1;
    if (!last && !stat.isDirectory()) return `${rel}: ${segments.slice(0, k + 1).join('/')} is not a directory`;
    if (last && (directory ? !stat.isDirectory() : !stat.isFile())) return `${rel}: not a ${directory ? 'directory' : 'regular file'}`;
  }
  return null;
}

// --- Map validation ----------------------------------------------------------------------
// Returns null or the first problem (string). Structural (COVERAGE_INVALID) only.
function validateMap(doc, { change, prd, root }) {
  const str = v => typeof v === 'string';
  const text = v => str(v) && v.length <= MAX_TEXT;
  const textOrNull = v => v === null || text(v);
  const ids = (list, label, re) => {
    if (!Array.isArray(list)) return `${label} must be an array`;
    if (list.length > MAX_ENTRIES) return `${label} has more than ${MAX_ENTRIES} entries`;
    const seen = new Set();
    for (const id of list) {
      if (!str(id) || !re.test(id)) return `${label}: ${JSON.stringify(id)} is not a valid ID`;
      if (seen.has(id)) return `${label}: duplicate entry ${id}`;
      seen.add(id);
    }
    return null;
  };
  if (!isObject(doc)) return 'the map must be a JSON object';
  if (doc.schema !== SCHEMA) return `unsupported coverage map schema ${JSON.stringify(doc.schema)} (this runtime reads schema 1)`;
  for (const k of Object.keys(doc)) if (!MAP_KEYS.includes(k)) return `unknown key ${JSON.stringify(k)}`;
  for (const k of MAP_KEYS) if (!(k in doc)) return `missing key ${JSON.stringify(k)}`;
  if (doc.change !== change) return `change must be ${JSON.stringify(change)} (got ${JSON.stringify(doc.change)})`;
  if (doc.prd !== prd) return `prd must be ${prd} (got ${JSON.stringify(doc.prd)})`;
  for (const k of ['scenarios', 'scope', 'tickets', 'checks']) {
    if (!isObject(doc[k])) return `${k} must be an object`;
    if (Object.keys(doc[k]).length > MAX_ENTRIES) return `${k} has more than ${MAX_ENTRIES} entries`;
  }
  for (const [id, s] of Object.entries(doc.scenarios)) {
    if (!requirements.ID_RE.test(id)) return `scenarios: ${JSON.stringify(id)} is not a valid ID`;
    if (!isObject(s)) return `${id}: must be an object`;
    for (const k of Object.keys(s)) if (!SCENARIO_KEYS.includes(k)) return `${id}: unknown key ${JSON.stringify(k)}`;
    for (const k of SCENARIO_KEYS) if (!(k in s)) return `${id}: missing key ${JSON.stringify(k)}`;
    const t = ids(s.tickets, `${id}`, /^T-[0-9]{2,6}$/); if (t) return t;
    const c = ids(s.checks, `${id}`, CHECK_ID); if (c) return c;
  }
  for (const [id, s] of Object.entries(doc.scope)) {
    if (!requirements.ID_RE.test(id)) return `scope: ${JSON.stringify(id)} is not a valid ID`;
    if (!isObject(s)) return `${id}: must be an object`;
    for (const k of Object.keys(s)) if (!SCOPE_KEYS.includes(k)) return `${id}: unknown key ${JSON.stringify(k)}`;
    for (const k of SCOPE_KEYS) if (!(k in s)) return `${id}: missing key ${JSON.stringify(k)}`;
    if (!DISPOSITIONS.includes(s.disposition)) return `${id}: disposition must be deferred or removed`;
    if (!str(s.decision) || !DECISION_ID.test(s.decision)) return `${id}: decision must be a decision ID such as D-01`;
    if (s.disposition === 'removed') { if (!str(s.prior) || !AGREEMENT_ID.test(s.prior)) return `${id}: a removed tombstone names its prior agreement G-NN`; }
    else if (s.prior !== null) return `${id}: prior is null for a deferral`;
    if (!textOrNull(s.note)) return `${id}: note must be null or a short string`;
    if (id in doc.scenarios) return `${id}: appears in both scenarios and scope`;
  }
  for (const [id, t] of Object.entries(doc.tickets)) {
    if (!/^T-[0-9]{2,6}$/.test(id) || !parse.canonicalId(id)) return `tickets: ${JSON.stringify(id)} is not a canonical ticket ID`;
    if (!isObject(t)) return `${id}: must be an object`;
    for (const k of Object.keys(t)) if (!TICKET_KEYS.includes(k)) return `${id}: unknown key ${JSON.stringify(k)}`;
    for (const k of TICKET_KEYS) if (!(k in t)) return `${id}: missing key ${JSON.stringify(k)}`;
    if (!ROLES.includes(t.role)) return `${id}: role must be implements or enables`;
    if (t.role === 'enables') { if (!text(t.rationale) || t.rationale.trim() === '') return `${id}: an enabling ticket needs a nonempty rationale`; }
    else if (t.rationale !== null) return `${id}: rationale is null for an implementing ticket`;
  }
  for (const [id, c] of Object.entries(doc.checks)) {
    if (!CHECK_ID.test(id)) return `checks: ${JSON.stringify(id)} is not a check ID such as C-01`;
    if (!isObject(c)) return `${id}: must be an object`;
    for (const k of Object.keys(c)) if (!CHECK_KEYS.includes(k)) return `${id}: unknown key ${JSON.stringify(k)}`;
    for (const k of CHECK_KEYS) if (!(k in c)) return `${id}: missing key ${JSON.stringify(k)}`;
    if (!KINDS.includes(c.kind)) return `${id}: kind must be command, review or visual`;
    if (typeof c.required !== 'boolean') return `${id}: required must be true or false`;
    if (!textOrNull(c.note)) return `${id}: note must be null or a short string`;
    if (c.kind === 'command') {
      if (!text(c.command) || c.command.trim() === '') return `${id}: command must be a nonempty string of at most ${MAX_TEXT} characters`;
      if (!Number.isInteger(c.timeout) || c.timeout <= 0 || c.timeout > parse.MAX_TIMEOUT) return `${id}: timeout must be a positive integer number of seconds (at most ${parse.MAX_TIMEOUT})`;
      if (c.obligation !== null) return `${id}: obligation is null for a command check`;
      if (c.cwd !== null) {
        const why = unsafePath(c.cwd); if (why) return `${id}: cwd ${c.cwd}: ${why}`;
        if (root) { const real = realFile(root, c.cwd, { directory: true }); if (real) return `${id}: cwd ${real}`; }
      }
      if (inlineSecretLine(c.command.split('\n'))) return `${id}: command assigns a secret-like literal; reference it from the environment instead`;
      const syntax = spawnSync('bash', ['-n', '-c', `${c.command}\n`], { encoding: 'utf8' });
      if (syntax.error) return `${id}: cannot run bash to check the command (${syntax.error.message})`;
      if (syntax.status !== 0) return `${id}: invalid bash syntax in command`;
    } else {
      if (!text(c.obligation) || c.obligation.trim() === '') return `${id}: a ${c.kind} check needs a nonempty obligation`;
      for (const k of ['command', 'timeout', 'cwd']) if (c[k] !== null) return `${id}: ${k} is null for a ${c.kind} check`;
    }
  }
  return null;
}

// Canonical form: object keys sorted, ID arrays sorted, no insignificant whitespace.
function normalize(doc) {
  const canon = v => {
    if (Array.isArray(v)) return v.map(canon);
    if (isObject(v)) { const out = {}; for (const k of Object.keys(v).sort()) out[k] = canon(v[k]); return out; }
    return v;
  };
  const copy = canon(doc);
  for (const s of Object.values(copy.scenarios)) { s.tickets = requirements.sortIds(s.tickets); s.checks = requirements.sortIds(s.checks); }
  return `${JSON.stringify(copy)}\n`;
}
const digestOf = text => parse.sha256(text);
// The definition digest of a declared check (a command's equals the attempt check digest).
const definitionDigest = c => (c.kind === 'command' ? parse.sha256(`${c.command}\ntimeout=${c.timeout}\n`) : parse.sha256(`${c.kind}\n${c.obligation}\n`));

// Read and validate the map of a change. Returns { ok: true, map, text, normalized,
// digest, file } or { ok: false, code: 'COVERAGE_INVALID', problems: [string] }.
function readMap(root, record) {
  const rel = file(record.change);
  const invalid = p => ({ ok: false, code: 'COVERAGE_INVALID', problems: [`${rel}: ${p}`], file: rel });
  const real = realFile(root, rel);
  if (real) return real.endsWith(': missing') ? invalid(`missing — author ${rel} first (see docs/runtime-contracts.md, "Coverage map")`) : invalid(real.slice(rel.length + 2));
  let raw;
  try { raw = fs.readFileSync(path.join(root, rel)); } catch (error) { return invalid(error.message); }
  if (raw.length > MAX_BYTES) return invalid(`larger than ${MAX_BYTES} bytes`);
  const text = raw.toString('utf8');
  let doc;
  try { doc = parseStrict(text); } catch (error) { return invalid(/^duplicate key/.test(error.message) ? error.message : `malformed JSON (${error.message})`); }
  const problem = validateMap(doc, { change: record.change, prd: record.prd, root });
  if (problem) return invalid(problem);
  const normalized = normalize(doc);
  return { ok: true, map: doc, text, normalized, digest: digestOf(normalized), file: rel };
}
// Validate a map document that is not on disk (a snapshot's text): shape only, no cwd existence.
function validateText(text, { change, prd }) {
  let doc;
  try { doc = parseStrict(text); } catch (error) { return { problem: /^duplicate key/.test(error.message) ? error.message : `malformed JSON (${error.message})` }; }
  const problem = validateMap(doc, { change, prd, root: null });
  if (problem) return { problem };
  return { map: doc, normalized: normalize(doc), digest: digestOf(normalize(doc)) };
}

// --- The tickets of a change ---------------------------------------------------------------
// { ok, tickets: { "T-NN": { file, text, fields, timeout } }, others: { "T-NN": prd } } or
// { ok: false, code: 'INPUT_INVALID', problems }.
function ticketsOf(root, record) {
  const set = parse.validateTicketSet(root);
  if (!set.ok) return { ok: false, code: 'INPUT_INVALID', problems: [`pincer-ticket: ${set.file ? `${set.file}: ` : ''}${set.problems[0]}`] };
  const statusModule = require('./status.cjs');
  const tickets = {}, others = {};
  for (const f of set.files) {
    const text = fs.readFileSync(path.join(root, f), 'utf8');
    const v = parse.validateTicket(f, text);
    const assoc = statusModule.ticketPrd(root, f, v.fields);
    if (assoc.problem) return { ok: false, code: 'INPUT_INVALID', problems: [assoc.problem] };
    if (assoc.prd === record.prd) tickets[v.fields.ticket] = { file: f, text, fields: v.fields, timeout: v.timeout };
    else others[v.fields.ticket] = assoc.prd;
  }
  return { ok: true, tickets, others };
}

// --- The graph ---------------------------------------------------------------------------------
// Resolve a validated map against the inventory and the change's tickets. Pure:
// returns { complete, problems: [{ code: 'COVERAGE_INCOMPLETE', detail, ids }],
// scenarios, scope, tickets, checks } where every entry carries its resolved links.
// `priorInventory(gid)` returns the inventory snapshot of an agreement entry (or null)
// for removed tombstones; without it, tombstone priors are checked for shape only.
function resolve({ map, inventory, tickets, others = {}, priorInventory = null }) {
  const problems = [];
  const problem = (detail, ids) => problems.push({ code: 'COVERAGE_INCOMPLETE', detail, ids: requirements.sortIds([...new Set(ids)]) });
  const live = inventory.scenarios;
  const graph = { scenarios: {}, scope: {}, tickets: {}, checks: {} };
  for (const [id, c] of Object.entries(map.checks)) graph.checks[id] = { id, ...c, digest: definitionDigest(c), scenarios: [] };
  for (const [id, t] of Object.entries(map.tickets)) graph.tickets[id] = { id, role: t.role, rationale: t.rationale, scenarios: [], present: Boolean(tickets[id]), other: others[id] || null };
  // Membership: every live scenario exactly once; no invented or stale rows.
  const missing = Object.keys(live).filter(id => !(id in map.scenarios) && !(id in map.scope));
  if (missing.length) problem(`${missing.join(', ')} ${missing.length === 1 ? 'has' : 'have'} no row in scenarios or scope`, missing);
  for (const id of Object.keys(map.scenarios)) {
    if (!live[id]) {
      problem(`${id} is not a scenario of the inventory${inventory.requirements[id] ? ' (a requirement is covered through its scenarios)' : ''}`, [id]);
      // A stale row's links are still authored links: they keep counting for classification.
      for (const t of map.scenarios[id].tickets) if (graph.tickets[t]) graph.tickets[t].scenarios.push(id);
      for (const c of map.scenarios[id].checks) if (graph.checks[c]) graph.checks[c].scenarios.push(id);
      continue;
    }
    const row = map.scenarios[id];
    const entry = { id, requirement: live[id].requirement, tickets: requirements.sortIds(row.tickets), checks: requirements.sortIds(row.checks) };
    if (!row.tickets.length) problem(`${id}: no implementing ticket`, [id]);
    if (!row.checks.length) problem(`${id}: no candidate check`, [id]);
    for (const t of row.tickets) {
      const classified = map.tickets[t];
      if (!tickets[t]) problem(`${id}: ticket ${t} is not a ticket of this change${others[t] ? ` (WRONG_CHANGE: it belongs to ${others[t]})` : ' (no such ticket file)'}`, [id, t]);
      else if (!classified) problem(`${id}: ticket ${t} is not classified in tickets`, [id, t]);
      else if (classified.role !== 'implements') problem(`${id}: ticket ${t} is classified enables, but the scenario links it as implementation`, [id, t]);
      if (graph.tickets[t]) graph.tickets[t].scenarios.push(id);
    }
    for (const c of row.checks) {
      if (!map.checks[c]) problem(`${id}: check ${c} is not declared`, [id, c]);
      else graph.checks[c].scenarios.push(id);
    }
    graph.scenarios[id] = entry;
  }
  for (const id of Object.keys(map.scope)) {
    const row = map.scope[id];
    const entry = { id, requirement: live[id] ? live[id].requirement : null, disposition: row.disposition, decision: row.decision, prior: row.prior, note: row.note, live: Boolean(live[id]) };
    if (!live[id]) {
      if (row.disposition !== 'removed') { problem(`${id} is not a scenario of the inventory (a deferral applies to a defined scenario; a withdrawn one needs a removed tombstone)`, [id]); continue; }
      if (inventory.requirements[id]) { problem(`${id} is a requirement; scope entries name scenarios`, [id]); continue; }
    }
    if (row.disposition === 'removed' && priorInventory) {
      const prior = priorInventory(row.prior);
      if (!prior) problem(`${id}: prior agreement ${row.prior} is not a retained agreement with an inventory snapshot`, [id]);
      else if (!prior.scenarios[id]) problem(`${id}: prior agreement ${row.prior} does not define ${id}`, [id]);
      else entry.requirement = entry.requirement || prior.scenarios[id].requirement;
    }
    graph.scope[id] = entry;
  }
  // Classification: every ticket of the change exactly once, roles consistent with the links.
  for (const id of Object.keys(tickets)) if (!map.tickets[id]) problem(`${id} is not classified (every ticket of the change is listed with role implements or enables)`, [id]);
  for (const [id, t] of Object.entries(graph.tickets)) {
    if (!tickets[id]) problem(`${id} is listed in tickets but is not a ticket of this change${others[id] ? ` (WRONG_CHANGE: it belongs to ${others[id]})` : ''}`, [id]);
    else if (t.role === 'implements' && !t.scenarios.length) problem(`${id} is classified implements but no scenario links it (classify it enables with a rationale, or link it)`, [id]);
    else if (t.role === 'enables' && t.scenarios.length) problem(`${id} is classified enables but ${t.scenarios.join(', ')} links it as implementation`, [id, ...t.scenarios]);
    t.scenarios = requirements.sortIds(t.scenarios);
  }
  for (const c of Object.values(graph.checks)) c.scenarios = requirements.sortIds(c.scenarios);
  return { complete: problems.length === 0, problems, ...graph };
}

// Load everything for a change: the inventory, the map and the graph. Returns
// { ok, code, problems, inventory, map, tickets, graph }. `ok` is false for
// INPUT_INVALID / INVENTORY_INVALID / COVERAGE_INVALID (nothing usable) and for
// COVERAGE_INCOMPLETE (inventory and map usable, graph.problems set).
function load(root, record, { priorInventory = null } = {}) {
  const inv = requirements.readInventory(root, record.prd);
  if (!inv.ok) return { ok: false, code: inv.code, problems: inv.problems };
  const m = readMap(root, record);
  if (!m.ok) return { ok: false, code: m.code, problems: m.problems, inventory: inv.inventory };
  const t = ticketsOf(root, record);
  if (!t.ok) return { ok: false, code: t.code, problems: t.problems, inventory: inv.inventory, map: m };
  const graph = resolve({ map: m.map, inventory: inv.inventory, tickets: t.tickets, others: t.others, priorInventory });
  return { ok: graph.complete, code: graph.complete ? null : 'COVERAGE_INCOMPLETE', problems: graph.problems.map(p => p.detail), inventory: inv.inventory, map: m, tickets: t.tickets, others: t.others, graph };
}

module.exports = { SCHEMA, DIR, MAX_BYTES, MAX_TEXT, KINDS, ROLES, DISPOSITIONS, CHECK_ID, file, parseStrict, unsafePath, realFile, validateMap, validateText, normalize, digestOf, definitionDigest, readMap, ticketsOf, resolve, load };
