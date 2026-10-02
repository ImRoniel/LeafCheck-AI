'use strict';
// PINCER runtime — agreements (docs/runtime-contracts.md, "Agreements and
// authorization"). An agreement is the reviewed content a user authorized: the
// change, the PRD's authored revision, the breakdown (every ticket of the PRD,
// normalized as in "Content revisions") and the resolved consequential
// decisions. Its digest is SHA-256 over the projection text below, version 1.
// Agreement entries carry a tracked snapshot of the normalized inputs so an old
// agreement stays reviewable and its digest recomputable from the file alone;
// the structural difference between two agreements is computed here too. Nothing
// here judges semantics or grants approval.
const fs = require('node:fs');
const path = require('node:path');
const parse = require('./parse.cjs');
const transaction = require('./transaction.cjs');
const requirements = require('./requirements.cjs');
const coverage = require('./coverage.cjs');
const { readJson } = require('./fsutil.cjs');

const PROJECTION_VERSION = 1;
const SNAPSHOT_SCHEMA = 1;
// Strict coverage (PRD v6): projection version 2 adds the inventory and coverage
// map digests; snapshot schema 2 carries the normalized inventory and map text.
const PROJECTION_VERSION_STRICT = 2;
const SNAPSHOT_SCHEMA_STRICT = 2;
const SNAPSHOT_KEYS = ['schema', 'change', 'agreement', 'digest', 'projection', 'prd', 'tickets', 'decisions', 'recorded'];
const SNAPSHOT_KEYS_STRICT = ['schema', 'change', 'agreement', 'digest', 'projection', 'prd', 'inventory', 'coverage', 'tickets', 'decisions', 'recorded'];
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const ticketNumber = id => Number(id.slice(2));

const decisionDigest = d => parse.sha256(`${d.id}\n${d.summary}\n${d.reference}\n${d.excerpt}\n`);

// The exact projection text (each line terminated by \n).
function projectionText({ change, prd, tickets, decisions, inventory = null, coverage: map = null }) {
  const strict = Boolean(inventory && map);
  const lines = [`pincer agreement ${strict ? PROJECTION_VERSION_STRICT : PROJECTION_VERSION}`, `change ${change}`, `prd ${prd.path} ${prd.revision}`];
  if (strict) { lines.push(`inventory ${inventory.digest}`); lines.push(`coverage ${map.path} ${map.digest}`); }
  for (const id of Object.keys(tickets).sort((a, b) => ticketNumber(a) - ticketNumber(b))) lines.push(`ticket ${id} ${tickets[id].digest}`);
  for (const id of Object.keys(decisions).sort()) lines.push(`decision ${id} ${decisionDigest({ id, ...decisions[id] })}`);
  return `${lines.join('\n')}\n`;
}
const breakdownDigest = tickets => parse.sha256(Object.keys(tickets).sort((a, b) => ticketNumber(a) - ticketNumber(b)).map(id => `ticket ${id} ${tickets[id].digest}\n`).join(''));

// Compute the current agreement of a record from the files on disk. Returns
// { digest, projection, prd, tickets, decisions, breakdown } or { code, problem }.
function compute(root, record) {
  const prdResult = parse.validatePrd(root, record.prd);
  if (!prdResult.ok) return { code: 'INPUT_INVALID', problem: `${record.prd}: ${prdResult.problems[0]}` };
  const set = parse.validateTicketSet(root);
  if (!set.ok) return { code: 'INPUT_INVALID', problem: `pincer-ticket: ${set.file ? `${set.file}: ` : ''}${set.problems[0]}` };
  const statusModule = require('./status.cjs');
  const tickets = {};
  for (const file of set.files) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    const v = parse.validateTicket(file, text);
    const assoc = statusModule.ticketPrd(root, file, v.fields);
    if (assoc.problem) return { code: 'INPUT_INVALID', problem: assoc.problem };
    if (assoc.prd !== record.prd) continue;
    tickets[v.fields.ticket] = { file, digest: parse.ticketDigest(text), text: parse.normalizeTicket(text) };
  }
  const decisions = {};
  for (const d of record.decisions) if (d.status === 'resolved') decisions[d.id] = { summary: d.summary, reference: d.reference, excerpt: d.excerpt };
  const prd = { path: record.prd, revision: parse.prdDigest(prdResult.text), text: parse.normalizePrd(prdResult.text) };
  const inputs = { change: record.change, prd, tickets, decisions };
  if (record.schema === 3) {
    // A strict change binds its inventory and its coverage map (docs/runtime-contracts.md,
    // "Strict change records"); when either cannot be read the agreement cannot be computed.
    const inv = requirements.readInventory(root, record.prd);
    if (!inv.ok) return { code: inv.code, problem: inv.problems[0] };
    const m = coverage.readMap(root, record);
    if (!m.ok) return { code: m.code, problem: m.problems[0] };
    inputs.inventory = requirements.snapshotOf(inv.inventory);
    inputs.coverage = { path: m.file, digest: m.digest, text: m.normalized };
    inputs.graphInputs = { inventory: inv.inventory, map: m };
  }
  const projection = projectionText(inputs);
  return { ...inputs, projection, digest: parse.sha256(projection), breakdown: breakdownDigest(tickets) };
}

// --- Snapshots -----------------------------------------------------------------------
function snapshotDoc(record, agreementId, computed, recorded) {
  if (computed.inventory && computed.coverage) return { schema: SNAPSHOT_SCHEMA_STRICT, change: record.change, agreement: agreementId, digest: computed.digest, projection: computed.projection, prd: computed.prd, inventory: computed.inventory, coverage: computed.coverage, tickets: computed.tickets, decisions: computed.decisions, recorded };
  return { schema: SNAPSHOT_SCHEMA, change: record.change, agreement: agreementId, digest: computed.digest, projection: computed.projection, prd: computed.prd, tickets: computed.tickets, decisions: computed.decisions, recorded };
}
// Read and verify one agreement's snapshot: the file exists, has the documented
// shape, its projection recomputes from its own inputs, and the digest is the
// SHA-256 of that projection and equals the entry's. Returns { snapshot } or
// { code: 'HISTORY_INVALID', problem }.
function readSnapshot(root, record, agreement) {
  const rel = agreement.snapshot;
  const invalid = p => ({ code: 'HISTORY_INVALID', problem: `${rel}: ${p} — the agreement ${agreement.id} of change "${record.change}" cannot be reviewed from a digest alone` });
  const read = readJson(path.join(root, rel));
  if (read.error === 'missing') return invalid('snapshot missing');
  if (read.error) return invalid(read.error);
  const s = read.data;
  if (!isObject(s) || ![SNAPSHOT_SCHEMA, SNAPSHOT_SCHEMA_STRICT].includes(s.schema)) return invalid('not a schema 1 or 2 agreement snapshot');
  const keys = s.schema === SNAPSHOT_SCHEMA_STRICT ? SNAPSHOT_KEYS_STRICT : SNAPSHOT_KEYS;
  if (Object.keys(s).some(k => !keys.includes(k)) || !keys.every(k => k in s)) return invalid(`not a schema ${s.schema} agreement snapshot (keys)`);
  if (s.schema === SNAPSHOT_SCHEMA_STRICT) {
    if (!isObject(s.prd) || typeof s.prd.path !== 'string') return invalid('snapshot prd must be { path, revision, text }');
    const inv = requirements.validateSnapshot(s.inventory, s.prd.path);
    if (inv) return invalid(`snapshot inventory: ${inv}`);
    if (!isObject(s.coverage) || typeof s.coverage.path !== 'string' || typeof s.coverage.digest !== 'string' || typeof s.coverage.text !== 'string') return invalid('snapshot coverage must be { path, digest, text }');
    if (s.coverage.path !== coverage.file(record.change)) return invalid(`snapshot coverage path must be ${coverage.file(record.change)}`);
    const m = coverage.validateText(s.coverage.text, { change: record.change, prd: s.prd.path });
    if (m.problem) return invalid(`snapshot coverage map: ${m.problem}`);
    if (m.digest !== s.coverage.digest || parse.sha256(s.coverage.text) !== s.coverage.digest) return invalid('the snapshot coverage map text does not hash to its recorded digest');
    if (agreement.inventory !== undefined && (agreement.inventory !== s.inventory.digest || agreement.coverage !== s.coverage.digest)) return invalid('the snapshot inventory and coverage digests do not match the record entry');
  } else if (agreement.inventory !== undefined && (agreement.inventory !== null || agreement.coverage !== null)) return invalid('a schema 1 snapshot carries no inventory or coverage digest, but the record entry does');
  if (s.change !== record.change || s.agreement !== agreement.id) return invalid(`snapshot belongs to ${s.change}/${s.agreement}`);
  if (!isObject(s.prd) || typeof s.prd.path !== 'string' || typeof s.prd.revision !== 'string' || typeof s.prd.text !== 'string') return invalid('snapshot prd must be { path, revision, text }');
  if (!isObject(s.tickets) || !Object.values(s.tickets).every(t => isObject(t) && typeof t.file === 'string' && typeof t.digest === 'string' && typeof t.text === 'string')) return invalid('snapshot tickets must map IDs to { file, digest, text }');
  if (!isObject(s.decisions)) return invalid('snapshot decisions must be an object');
  if (parse.sha256(s.prd.text) !== s.prd.revision) return invalid('the snapshot PRD text does not hash to its recorded revision');
  for (const [id, t] of Object.entries(s.tickets)) if (parse.sha256(t.text) !== t.digest) return invalid(`the snapshot text of ${id} does not hash to its recorded digest`);
  const recomputed = projectionText({ change: s.change, prd: s.prd, tickets: s.tickets, decisions: s.decisions, inventory: s.inventory || null, coverage: s.coverage || null });
  if (recomputed !== s.projection) return invalid('the snapshot projection does not recompute from its inputs');
  if (parse.sha256(s.projection) !== s.digest || s.digest !== agreement.digest) return invalid('the snapshot digest does not match the projection or the record entry');
  return { snapshot: s };
}

// --- Structural difference ------------------------------------------------------------
// Which parts of two normalized ticket texts differ: frontmatter, acceptance,
// verification, other. Never a semantic judgment.
function ticketParts(a, b) {
  const sa = parse.ticketSections(a), sb = parse.ticketSections(b);
  return ['frontmatter', 'acceptance', 'verification', 'other'].filter(k => sa[k] !== sb[k]);
}
// difference(from, to): `from` is a snapshot (or computed inputs) and `to` the
// current computed inputs.
function difference(from, to) {
  const before = new Set(Object.keys(from.tickets)), after = new Set(Object.keys(to.tickets));
  const byNumber = (a, b) => ticketNumber(a) - ticketNumber(b);
  const added = [...after].filter(id => !before.has(id)).sort(byNumber);
  const removed = [...before].filter(id => !after.has(id)).sort(byNumber);
  const changed = [...after].filter(id => before.has(id) && from.tickets[id].digest !== to.tickets[id].digest).sort(byNumber).map(id => ({ id, parts: ticketParts(from.tickets[id].text, to.tickets[id].text) }));
  const decisionsBefore = Object.keys(from.decisions), decisionsAfter = Object.keys(to.decisions);
  const both = from.inventory && to.inventory && from.coverage && to.coverage;
  const out = {
    same: from.digest === to.digest,
    prd_changed: from.prd.revision !== to.prd.revision,
    tickets_added: added, tickets_removed: removed, tickets_changed: changed,
    decisions_added: decisionsAfter.filter(id => !decisionsBefore.includes(id)).sort(),
    decisions_removed: decisionsBefore.filter(id => !decisionsAfter.includes(id)).sort(),
  };
  // Strict coverage (either side strict): the inventory difference, or null with
  // strict_history false when one side has no inventory (history unavailable).
  // A difference between two non-strict agreements keeps the v5 shape exactly.
  if (from.inventory || to.inventory) {
    out.inventory = both ? requirements.difference(from.inventory, to.inventory) : null;
    out.coverage_changed = both ? from.coverage.digest !== to.coverage.digest : null;
    out.strict_history = Boolean(both);
  }
  return out;
}
function renderDifference(d) {
  if (d.same) return 'unchanged';
  const bits = [];
  if (d.prd_changed) bits.push('PRD body changed');
  if (d.tickets_added.length) bits.push(`tickets added: ${d.tickets_added.join(', ')}`);
  if (d.tickets_removed.length) bits.push(`tickets removed: ${d.tickets_removed.join(', ')}`);
  if (d.tickets_changed.length) bits.push(`tickets changed: ${d.tickets_changed.map(t => `${t.id} (${t.parts.join(', ') || 'content'})`).join(', ')}`);
  if (d.decisions_added.length) bits.push(`decisions resolved: ${d.decisions_added.join(', ')}`);
  if (d.decisions_removed.length) bits.push(`decisions no longer recorded: ${d.decisions_removed.join(', ')}`);
  if (d.inventory && !d.inventory.same) {
    const inv = d.inventory, parts = [];
    if (inv.requirements.added.length) parts.push(`requirements added: ${inv.requirements.added.join(', ')}`);
    if (inv.requirements.removed.length) parts.push(`requirements removed: ${inv.requirements.removed.join(', ')}`);
    if (inv.requirements.changed.length) parts.push(`requirements changed: ${inv.requirements.changed.map(r => `${r.id} (${r.parts.join(', ')})`).join(', ')}`);
    if (inv.scenarios.added.length) parts.push(`scenarios added: ${inv.scenarios.added.join(', ')}`);
    if (inv.scenarios.removed.length) parts.push(`scenarios removed: ${inv.scenarios.removed.join(', ')}`);
    if (inv.scenarios.changed.length) parts.push(`scenarios changed: ${inv.scenarios.changed.map(r => `${r.id} (${r.parts.join(', ')})`).join(', ')}`);
    bits.push(`inventory changed (${parts.join('; ') || 'digest'})`);
  }
  if (d.coverage_changed) bits.push('coverage map changed');
  if (d.strict_history === false) bits.push('inventory history unavailable for one side');
  return bits.join('; ') || 'digest differs';
}

// The latest recorded agreement entry, and whether it matches the current digest.
const latestEntry = record => (record.agreements.length ? record.agreements[record.agreements.length - 1] : null);
const entryFor = (record, digest) => record.agreements.find(g => g.digest === digest) || null;

// --- change revise ---------------------------------------------------------------------
// Record the current agreement as G-NN with its snapshot when it differs from the
// latest recorded one; a no-op otherwise. Authorizes nothing. `expect` is the
// record sequence the caller prepared against. Returns { action: 'recorded' |
// 'unchanged', agreement, record, difference } or { code, problem }.
function revise(root, id, { expect = null, hooks = null } = {}) {
  const changes = require('./changes.cjs');
  try {
    const out = transaction.run(root, { command: `change revise ${id}`, hooks }, ctx => {
      const resolved = changes.resolveSelected(root, { change: id });
      if (resolved.code) ctx.refuse(resolved.code, resolved.problem);
      if (expect !== null) ctx.expect(resolved.file, 'sequence', expect);
      const record = resolved.record;
      if (changes.TERMINAL.includes(record.lifecycle.state)) ctx.refuse('LIFECYCLE_BLOCKED', `change ${id} is ${record.lifecycle.state}; its agreements are history and cannot be revised — register a new change`);
      const computed = compute(root, record);
      if (computed.code) ctx.refuse(computed.code, computed.problem);
      const latest = latestEntry(record);
      if (latest && latest.digest === computed.digest) return { action: 'unchanged', agreement: latest, record, difference: null };
      const previous = latest ? readSnapshot(root, record, latest) : null;
      if (previous && previous.code) ctx.refuse(previous.code, previous.problem);
      return appendAgreement(ctx, changes, record, resolved.file, computed, { previous: previous ? previous.snapshot : null });
    });
    return out.result;
  } catch (error) {
    if (error.refusal) return { code: error.code, problem: error.message };
    if (error.code === 'STATE_BUSY') return { code: 'STATE_BUSY', problem: error.message };
    throw error;
  }
}
// Stage a new agreement entry, its snapshot and the `agreement` event on an
// in-memory record; shared with `change authorize` (which records the agreement
// it binds when it is not recorded yet). Mutates `record`; the caller must stage
// the record write when it adds more.
function appendAgreement(ctx, changes, record, file, computed, { previous = null, stage = true, event = true } = {}) {
  const gid = `G-${String(record.agreements.length + 1).padStart(2, '0')}`;
  const snapshotRel = changes.snapshotFile(record.change, gid);
  const entry = record.schema === 3
    ? { id: gid, digest: computed.digest, prd_revision: computed.prd.revision, breakdown: computed.breakdown, inventory: computed.inventory ? computed.inventory.digest : null, coverage: computed.coverage ? computed.coverage.digest : null, tickets: Object.keys(computed.tickets).sort((a, b) => ticketNumber(a) - ticketNumber(b)), decisions: Object.keys(computed.decisions).sort(), snapshot: snapshotRel, recorded: ctx.now }
    : { id: gid, digest: computed.digest, prd_revision: computed.prd.revision, breakdown: computed.breakdown, tickets: Object.keys(computed.tickets).sort((a, b) => ticketNumber(a) - ticketNumber(b)), decisions: Object.keys(computed.decisions).sort(), snapshot: snapshotRel, recorded: ctx.now };
  record.agreements.push(entry);
  if (event) {
    // `change authorize` records the entry inside its own event instead.
    const sequence = record.sequence + 1;
    record.events.push({ sequence, kind: 'agreement', from: record.lifecycle.state, to: record.lifecycle.state, at: ctx.now, reason: null, agreement: gid, authorization: null, decision: null, replacement: null, note: null });
    record.sequence = sequence;
  }
  ctx.write(snapshotRel, snapshotDoc(record, gid, computed, ctx.now));
  if (stage) ctx.write(file, record);
  return { action: 'recorded', agreement: entry, record, difference: previous ? difference(previous, computed) : null };
}

// The inventory snapshot of an agreement entry (null when the entry predates strict coverage or is unreadable).
function inventoryOf(root, record, entry) {
  if (!entry || entry.inventory === null || entry.inventory === undefined) return null;
  const snap = readSnapshot(root, record, entry);
  return snap.code ? null : snap.snapshot.inventory;
}
module.exports = { PROJECTION_VERSION, PROJECTION_VERSION_STRICT, SNAPSHOT_SCHEMA, SNAPSHOT_SCHEMA_STRICT, inventoryOf, projectionText, decisionDigest, breakdownDigest, compute, snapshotDoc, readSnapshot, difference, renderDifference, latestEntry, entryFor, revise, appendAgreement };
