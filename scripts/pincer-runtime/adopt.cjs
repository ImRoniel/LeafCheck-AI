'use strict';
// PINCER runtime — strict coverage adoption (docs/runtime-contracts.md, "Strict
// coverage" → "Adoption and rollback"). `coverage adopt --preview` computes the plan
// and writes nothing; `--apply` is one transaction that backs up the schema 2
// record, records the adoption agreement (projection 2, snapshot schema 2) and
// rewrites the record as schema 3 with the retained capability and one `adopt`
// event. It validates the authored inputs (inventory, map, graph), refuses on a
// running attempt, a terminal state, an incomplete transaction or changed inputs,
// grants no authorization, and is idempotent. Migration never adopts.
const fs = require('node:fs');
const path = require('node:path');
const changes = require('./changes.cjs');
const agreement = require('./agreement.cjs');
const authorization = require('./authorization.cjs');
const coverage = require('./coverage.cjs');
const dispositions = require('./dispositions.cjs');
const transaction = require('./transaction.cjs');
const state = require('./state.cjs');
const { nowIso } = require('./fsutil.cjs');

// Compute the plan. Returns { change, conflicts: [{ code, detail }], already, record,
// file, agreement: { id, digest }, inventory: { requirements, scenarios, digest },
// map: { path, digest }, historical, scope: [...], backup }.
function plan(root, { change } = {}) {
  const conflicts = [];
  const conflict = (code, detail) => conflicts.push({ code, detail });
  const out = { change, conflicts, already: false, record: null, file: null };
  if (typeof change !== 'string' || !changes.CHANGE_ID.test(change)) { conflict('INPUT_INVALID', `change ID must match [a-z0-9][a-z0-9-]{0,63}: ${change}`); return out; }
  const loaded = changes.loadRecords(root);
  if (loaded.mode === 'legacy') { conflict('CHANGE_REQUIRED', `no change record under ${changes.CHANGES_DIR}/ — register the change first (node scripts/pincer-runtime.cjs register --prd .prd/prd-vN.md); migration and registration never adopt strict coverage`); return out; }
  if (loaded.mode === 'migrated') { conflict('MIGRATION_REQUIRED', `${changes.CHANGES_DIR}/ holds a v0.5.0 binding; migrate to change records first (migrate --preview --prd <prd>); migration never adopts strict coverage`); return out; }
  for (const p of loaded.problems) conflict(p.code, p.detail);
  if (conflicts.length) return out;
  const entry = loaded.records.get(change);
  if (!entry) { conflict('INPUT_INVALID', `no change record ${changes.recordFile(change)} (retained: ${[...loaded.records.keys()].join(', ') || 'none'})`); return out; }
  out.record = entry.record; out.file = entry.file;
  if (changes.isStrict(entry.record)) { out.already = true; return out; }
  const record = entry.record;
  if (changes.TERMINAL.includes(record.lifecycle.state)) conflict('LIFECYCLE_BLOCKED', `change ${change} is ${record.lifecycle.state}; its history cannot adopt strict coverage — register a new change`);
  const running = transaction.runningAttempts(root, change);
  if (running.length) { const a = running[0]; const hint = a.alive === false ? ' (its owner is no longer running: run recover first)' : a.alive === true ? ` (pid ${a.owner.pid} is still running)` : ` (owned by ${a.owner.host || 'another host'})`; conflict('ATTEMPT_RUNNING', `attempt ${a.id} of change ${change} is running${hint}; adoption waits for it`); }
  const cov = coverage.load(root, record);
  if (cov.code && cov.code !== 'COVERAGE_INCOMPLETE') { for (const p of cov.problems) conflict(cov.code, p); return out; }
  if (cov.code === 'COVERAGE_INCOMPLETE') for (const p of cov.problems) conflict('COVERAGE_INCOMPLETE', p);
  if (conflicts.length) return out;
  const computed = agreement.compute(root, { ...record, schema: changes.SCHEMA_STRICT });
  if (computed.code) { conflict(computed.code, computed.problem); return out; }
  const gid = `G-${String(record.agreements.length + 1).padStart(2, '0')}`;
  out.agreement = { id: gid, digest: computed.digest };
  out.computed = computed;
  out.inventory = { requirements: Object.keys(cov.inventory.requirements).length, scenarios: Object.keys(cov.inventory.scenarios).length, digest: cov.inventory.digest };
  out.map = { path: cov.map.file, digest: cov.map.digest };
  out.historical = state.exists(root) ? state.listAttempts(root).filter(a => a.context && a.context.change === change && a.schema !== 3).length : 0;
  // Scope dispositions are reported for information: their authorization is recorded after adoption.
  const verdict = authorization.verdict(root, record);
  out.scope = Object.values(cov.graph.scope).map(s => ({ id: s.id, disposition: s.disposition, decision: s.decision }));
  out.scopeProblems = dispositions.scopeProblems(record, cov.graph, verdict).problems.map(p => p.detail);
  out.backup = `.pincer/backups/<UTC timestamp>/${entry.file}`;
  return out;
}

function renderPlan(p) {
  const lines = [];
  if (p.conflicts.length) {
    for (const c of p.conflicts) lines.push(`conflict  ${c.code}: ${c.detail}`);
    lines.push('adoption refused: resolve the conflicts above; nothing was written');
    return `${lines.join('\n')}\n`;
  }
  if (p.already) {
    lines.push(`already adopted: change ${p.change} is strict since ${p.record.coverage.adopted} (map ${p.record.coverage.map}, adoption agreement ${p.record.coverage.agreement}); nothing to do`);
    return `${lines.join('\n')}\n`;
  }
  lines.push(`adoption plan for change ${p.change} (${p.file}, ${p.record.lifecycle.state})`);
  lines.push(`  inventory ${p.inventory.requirements} requirement(s), ${p.inventory.scenarios} scenario(s) · digest ${p.inventory.digest.slice(0, 12)}`);
  lines.push(`  map       ${p.map.path} · digest ${p.map.digest.slice(0, 12)} · structure complete`);
  for (const s of p.scope) lines.push(`  scope     ${s.id} ${s.disposition} by decision ${s.decision}${p.scopeProblems.find(d => d.startsWith(`${s.id} (`)) ? ` — not yet authorized: ${p.scopeProblems.find(d => d.startsWith(`${s.id} (`)).replace(/^[^:]*: /, '')}` : ''}`);
  lines.push(`  agreement ${p.agreement.id} ${p.agreement.digest.slice(0, 12)} (projection 2: PRD revision, inventory, coverage map, tickets, resolved decisions) recorded with its snapshot`);
  lines.push(`  record    ${p.file} → schema 3 with coverage { map, adopted, agreement ${p.agreement.id} } and one adopt event; ${p.record.agreements.length} earlier agreement(s) kept (inventory history unavailable before ${p.agreement.id})`);
  lines.push(`  history   ${p.historical} existing attempt(s) of this change become HISTORICAL_EVIDENCE until verified again`);
  lines.push(`  backup    ${p.backup}`);
  lines.push('  note      adoption grants no authorization: the agreement above needs `change authorize` (user, or --delegated --basis A-NN) before execution');
  lines.push(`apply with: node scripts/pincer-runtime.cjs coverage adopt --apply --change ${p.change} --agreement ${p.agreement.digest}`);
  return `${lines.join('\n')}\n`;
}

// Apply as one transaction. Returns { plan, applied, record, backup } | { plan, already } |
// { plan, applied: false } (conflicts) | { plan, error, code }.
function apply(root, { change, agreement: expected = null, hooks = null } = {}) {
  const first = plan(root, { change });
  if (first.conflicts.length) return { plan: first, applied: false };
  if (first.already) return { plan: first, applied: false, already: true };
  const stamp = nowIso().replace(/[-:]/g, '');
  let backupRel = null;
  try {
    const out = transaction.run(root, { command: `coverage adopt ${change}`, hooks }, ctx => {
      const p = plan(root, { change });
      if (p.conflicts.length) ctx.refuse(p.conflicts[0].code, p.conflicts[0].detail);
      if (p.already) return { plan: p, already: true };
      if (expected !== null && expected !== p.agreement.digest) ctx.refuse('AGREEMENT_CHANGED', `--agreement ${expected.slice(0, 12)} is not the agreement adoption would record now (${p.agreement.digest.slice(0, 12)}); the inventory, the map, a ticket or a decision changed since the preview — preview again and adopt the current digest`);
      ctx.idle(change);
      const old = p.record;
      // Backup before anything is staged (the copy is outside the transaction's targets).
      const src = path.join(root, p.file);
      const dest = path.join(root, '.pincer', 'backups', stamp, p.file);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      backupRel = `.pincer/backups/${stamp}/${p.file}`;
      const record = {};
      for (const k of changes.RECORD_KEYS_STRICT) record[k] = k === 'coverage' ? null : JSON.parse(JSON.stringify(old[k]));
      record.schema = changes.SCHEMA_STRICT; record.runtime = changes.RUNTIME_STRICT;
      record.agreements = old.agreements.map(g => { const e = {}; for (const k of changes.AGREEMENT_KEYS_STRICT) e[k] = k === 'inventory' || k === 'coverage' ? null : g[k]; return e; });
      record.coverage = { map: coverage.file(change), adopted: ctx.now, agreement: p.agreement.id };
      const appended = agreement.appendAgreement(ctx, changes, record, p.file, p.computed, { stage: false, event: false });
      if (appended.agreement.id !== p.agreement.id) ctx.refuse('STATE_CHANGED', `the record changed since the operation was prepared (agreement ${appended.agreement.id} instead of ${p.agreement.id})`);
      const sequence = record.sequence + 1;
      record.events.push({ sequence, kind: 'adopt', from: record.lifecycle.state, to: record.lifecycle.state, at: ctx.now, reason: null, agreement: p.agreement.id, authorization: null, decision: null, replacement: null, note: null });
      record.sequence = sequence;
      const invalid = changes.validateRecord(record, p.file);
      if (invalid) ctx.refuse(invalid.code, invalid.problem);
      ctx.write(p.file, record);
      return { plan: p, record };
    });
    if (out.result.already) return { plan: out.result.plan, applied: false, already: true };
    return { plan: out.result.plan, applied: true, record: out.result.record, backup: backupRel };
  } catch (error) {
    if (error.refusal) return { plan: first, applied: false, error: error.message, code: error.code };
    if (error.code === 'STATE_BUSY') return { plan: first, applied: false, error: error.message, code: 'STATE_BUSY' };
    throw error;
  }
}

module.exports = { plan, renderPlan, apply };
