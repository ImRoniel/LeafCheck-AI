'use strict';
// PINCER runtime — migration (docs/runtime-contracts.md, "Migration and
// rollback"). Preview is read-only; apply is one transaction that backs up every
// authored file it changes, strips legacy receipts into the change record's
// `legacy.receipts` (history, never runtime evidence), converts a v0.5.0 schema 1
// binding into a schema 2 record (same id, base and registration; the free-text
// authorization retained as unvalidated history), rewrites the local candidate
// pointers that no longer resolve, ignores .pincer/, and selects the change in
// this worktree. The migrated change is planned with no authorization; existing
// attempts and evaluations stay history until verified again. Conflicts fail
// closed before the first write; repeated apply is a no-op.
const fs = require('node:fs');
const path = require('node:path');
const parse = require('./parse.cjs');
const identity = require('./identity.cjs');
const changes = require('./changes.cjs');
const statusModule = require('./status.cjs');
const state = require('./state.cjs');
const transaction = require('./transaction.cjs');
const { fmUnset } = require('./lifecycle.cjs');
const { nowIso, readJson } = require('./fsutil.cjs');

const IGNORE_LINE = '.pincer/';
const gitignoreHas = root => changes.gitignoreHas(fs.existsSync(path.join(root, '.gitignore')) ? fs.readFileSync(path.join(root, '.gitignore'), 'utf8') : '');
const OLD_CANDIDATE_KEY = /^candidate:([0-9a-f]{40}):(C-[0-9]{2,6})$/;

// Compute the plan. Returns { prd, change, source: 'legacy' | 'binding' | 'record',
// conflicts, binding: { file, existing, action }, tickets, gitignore, index,
// selection, alreadyMigrated, partial, authorization }.
function plan(root, { prd, change, authorization = null } = {}) {
  const conflicts = [];
  const conflict = (code, detail) => conflicts.push({ code, detail });
  const prdResult = parse.validatePrd(root, prd);
  if (!prdResult.ok) { conflict('INPUT_INVALID', `${prdResult.file || prd}: ${prdResult.problems[0]}`); return { prd, conflicts }; }
  let id = change || `prd-v${prd.match(parse.PRD_REF)[1]}`;
  if (!changes.CHANGE_ID.test(id)) conflict('INPUT_INVALID', `change ID must match [a-z0-9][a-z0-9-]{0,63}: ${id}`);
  if (!identity.head(root)) conflict('UNSUPPORTED_INPUT', 'migration needs a git repository with at least one commit');
  const scan = changes.scan(root);
  let source = 'legacy', binding = null, existing = null, bindingFile = null;
  if (scan.mode === 'invalid') for (const p of scan.problems) conflict(p.code, p.detail);
  else if (scan.mode === 'migrated') {
    const bindings = scan.entries.filter(e => e.schema === 1);
    const bad = scan.entries.filter(e => e.code);
    if (bindings.length > 1 || bad.length) conflict('AMBIGUOUS', `several files under .prd/changes/ (${scan.entries.map(e => path.basename(e.file)).join(', ')}); keep exactly one v0.5.0 binding`);
    else {
      const b = bindings[0].doc;
      const invalid = identity.validateBinding(b);
      if (invalid) conflict(/schema|runtime contract/.test(invalid) ? 'UNSUPPORTED_SCHEMA' : 'INPUT_INVALID', `${bindings[0].file}: ${invalid}`);
      else if (path.basename(bindings[0].file, '.json') !== b.change) conflict('INPUT_INVALID', `${bindings[0].file}: filename does not match change "${b.change}"`);
      else if (b.prd !== prd) conflict('AMBIGUOUS', `${bindings[0].file} binds ${b.prd}, not ${prd}; a v0.5.0 binding is converted first — migrate it with: node scripts/pincer-runtime.cjs migrate --preview --prd ${b.prd}, then register ${prd}`);
      else if (change && change !== b.change) conflict('AMBIGUOUS', `${bindings[0].file} already binds ${prd} as change "${b.change}"; pass --change ${b.change}`);
      else { id = b.change; source = 'binding'; binding = b; bindingFile = bindings[0].file; }
    }
  } else if (scan.mode === 'changes') {
    const loaded = changes.loadRecords(root);
    for (const p of loaded.problems) conflict(p.code, p.detail);
    if (!loaded.problems.length) {
      const owner = changes.ownerOf(loaded, prd);
      if (owner && owner[0] !== id) conflict('INPUT_INVALID', `${prd} is owned by change "${owner[0]}" (${owner[1].file}); pass --change ${owner[0]}`);
      else {
        const rec = loaded.records.get(id);
        if (rec && rec.record.prd !== prd) conflict('INPUT_INVALID', `${rec.file} names change "${id}" for ${rec.record.prd}; choose another --change ID for ${prd}`);
        else if (rec) { existing = rec; source = 'record'; }
      }
    }
  }
  const set = parse.validateTicketSet(root);
  if (!set.ok) conflict('INPUT_INVALID', `pincer-ticket: ${set.file ? `${set.file}: ` : ''}${set.problems[0]}`);
  const tickets = [];
  if (set.ok) {
    for (const file of set.files) {
      const text = fs.readFileSync(path.join(root, file), 'utf8');
      const fields = parse.validateTicket(file, text).fields;
      const assoc = statusModule.ticketPrd(root, file, fields);
      if (assoc.problem) { conflict('INPUT_INVALID', `pincer: ${assoc.problem}`); continue; }
      if (assoc.prd !== prd) continue;
      if (fields.verified || fields.last_check) tickets.push({ file, id: fields.ticket, verified: fields.verified || null, last_check: fields.last_check || null, text });
    }
  }
  const gitignore = !gitignoreHas(root);
  // Local pointers of a converted binding: candidate keys gain the change segment.
  let index = null;
  if (source === 'binding' && state.exists(root)) {
    const read = state.readIndex(root);
    if (read.error) conflict('INPUT_INVALID', read.error);
    else {
      const stale = Object.keys(read.index.current).filter(k => OLD_CANDIDATE_KEY.test(k));
      if (stale.length) index = { stale, doc: read.index };
    }
  }
  const sel = changes.readSelection(root);
  const selection = sel.code || sel.change !== id ? id : null;
  const alreadyMigrated = source === 'record' && tickets.length === 0 && !gitignore;
  const partial = source === 'record' && tickets.length > 0;
  return {
    prd, change: id, source, authorization, conflicts, bindingFile,
    binding: { file: changes.recordFile(id), existing: existing ? existing.record : binding, bindingFile, action: source === 'binding' ? 'convert' : source === 'record' ? (partial ? 'complete' : 'keep') : 'register' },
    tickets, gitignore, index, selection, alreadyMigrated, partial,
    historical: { attempts: state.exists(root) ? state.listAttempts(root).filter(a => a.schema === 1).length : 0 },
  };
}

function renderPlan(p) {
  const lines = [];
  if (p.conflicts.length) {
    for (const c of p.conflicts) lines.push(`conflict  ${c.code}: ${c.detail}`);
    lines.push('migration refused: resolve the conflicts above; nothing was written');
    return lines.join('\n') + '\n';
  }
  lines.push(`migration plan for ${p.prd} (change ${p.change})`);
  if (p.alreadyMigrated) { lines.push('  already migrated: change record present, no legacy receipts remain, .pincer/ ignored'); if (p.selection) lines.push(`  selection .pincer/runtime/selection.json → ${p.change} is not set in this worktree; select with: node scripts/pincer-runtime.cjs change select ${p.change}`); return lines.join('\n') + '\n'; }
  if (p.source === 'binding') {
    const b = p.binding.existing;
    lines.push(`  binding   ${p.bindingFile || p.binding.file} (v0.5.0, schema 1) → change record (schema 2) at the same path: change ${b.change}, base ${b.base.slice(0, 7)} and registration ${b.registered} kept; ${Object.keys(b.legacy_receipts).length} receipt(s) already imported carried over`);
    if (b.authorization) lines.push(`  note      the binding's authorization text "${b.authorization}" is retained as legacy.authorization_text (unvalidated history); it never authorizes execution`);
  } else if (p.source === 'record') lines.push(`  record    ${p.binding.file} (present; ${p.tickets.length} receipt(s) imported into legacy.receipts by a migrate event)`);
  else lines.push(`  record    ${p.binding.file} (new schema 2 record; base = HEAD; planned)`);
  if (p.partial) lines.push('  note      an earlier migration was partially applied (record present, receipts remain); apply completes it');
  for (const t of p.tickets) lines.push(`  ticket    ${t.file}: remove ${[t.verified ? 'verified' : null, t.last_check ? 'last_check' : null].filter(Boolean).join(', ')} → legacy.receipts[${t.id}] (history, not runtime evidence)`);
  if (!p.tickets.length) lines.push('  tickets   no legacy receipts to import');
  lines.push(p.gitignore ? `  gitignore add \`${IGNORE_LINE}\`` : '  gitignore already ignores .pincer/');
  if (p.index) lines.push(`  index     .pincer/runtime/index.json: ${p.index.stale.length} candidate pointer(s) dropped — a v0.5.0 attempt record cannot satisfy the change-scoped key, so its check is run again (attempt records untouched, kept as history)`);
  lines.push(`  history   ${p.historical.attempts} existing attempt(s) and any saved evaluation stay history (HISTORICAL_EVIDENCE) until verified again; the change is planned with no authorization`);
  if (p.selection) lines.push(`  selection .pincer/runtime/selection.json → ${p.change} (this worktree only; a fresh clone selects explicitly)`);
  lines.push('  backups   .pincer/backups/<timestamp>/ for every changed authored file (tickets, .gitignore, the binding, the local index)');
  if (p.authorization) lines.push(`  note      --authorization "${p.authorization}" is retained as legacy.authorization_text (unvalidated history); record the user's actual instruction afterwards with: node scripts/pincer-runtime.cjs change authorize ${p.change} --agreement <digest> --reference <text> --excerpt <text>`);
  else if (!(p.source === 'binding' && p.binding.existing.authorization)) lines.push(`  note      no --authorization given; migration grants no authorization — record the user's instruction afterwards with: node scripts/pincer-runtime.cjs change authorize ${p.change} …`);
  lines.push(`apply with: node scripts/pincer-runtime.cjs migrate --apply --prd ${p.prd}${p.change !== `prd-v${p.prd.match(parse.PRD_REF)[1]}` ? ` --change ${p.change}` : ''}`);
  return lines.join('\n') + '\n';
}

// Apply the plan as one transaction: backups first (copies of the originals),
// then tickets, .gitignore, the record, the index and the selection together.
function apply(root, options) {
  const first = plan(root, options);
  if (first.conflicts.length) return { plan: first, applied: false };
  if (first.alreadyMigrated) return { plan: first, applied: false, already: true };
  const stamp = nowIso().replace(/[-:]/g, '');
  const backupDir = path.join(root, '.pincer', 'backups', stamp);
  const backups = [];
  const backup = rel => {
    const src = path.join(root, rel);
    if (!fs.existsSync(src)) return;
    const dest = path.join(backupDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    backups.push(`.pincer/backups/${stamp}/${rel}`);
  };
  try {
    const out = transaction.run(root, { command: `migrate --apply ${options.prd}`, hooks: options.hooks || null }, ctx => {
      const p = plan(root, options);
      if (p.conflicts.length) ctx.refuse(p.conflicts[0].code, p.conflicts[0].detail);
      if (p.alreadyMigrated) return { plan: p, already: true };
      for (const t of p.tickets) backup(t.file);
      if (p.gitignore) backup('.gitignore');
      if (p.source === 'binding') backup(p.bindingFile);
      if (p.index) backup(`${state.RUNTIME_DIR}/index.json`);
      const receipts = {};
      for (const t of p.tickets) {
        receipts[t.id] = { verified: t.verified, last_check: t.last_check };
        ctx.write(t.file, fmUnset(fmUnset(t.text, 'verified'), 'last_check'));
      }
      if (p.gitignore) {
        const existing = ctx.text('.gitignore') || '';
        const lead = existing && !existing.endsWith('\n') ? '\n' : '';
        ctx.write('.gitignore', `${existing}${lead}${existing ? '\n' : ''}# pincer runtime state (added by migrate)\n${IGNORE_LINE}\n`);
      }
      let record;
      if (p.source === 'record') {
        record = JSON.parse(JSON.stringify(p.binding.existing));
        record.legacy.receipts = { ...record.legacy.receipts, ...receipts };
        if (options.authorization) record.legacy.authorization_text = options.authorization;
        const sequence = record.sequence + 1;
        record.events.push({ sequence, kind: 'migrate', from: record.lifecycle.state, to: record.lifecycle.state, at: ctx.now, reason: null, agreement: null, authorization: null, decision: null, replacement: null, note: `${Object.keys(receipts).length} legacy receipt(s) imported` });
        record.sequence = sequence;
      } else if (p.source === 'binding') {
        const b = p.binding.existing;
        record = changes.newRecord({ change: b.change, prd: b.prd, base: b.base, now: ctx.now, kind: 'migrate', legacy: { receipts: { ...b.legacy_receipts, ...receipts }, authorization_text: options.authorization || b.authorization || null, migrated_from: 'binding', migrated: ctx.now } });
        record.registered = b.registered;
        record.events[0].note = `converted from the v0.5.0 binding (registered ${b.registered})`;
      } else {
        record = changes.newRecord({ change: p.change, prd: p.prd, base: identity.head(root), now: ctx.now, kind: 'migrate', legacy: { receipts, authorization_text: options.authorization || null, migrated_from: 'legacy', migrated: ctx.now } });
      }
      const invalid = changes.validateRecord(record, p.binding.file);
      if (invalid) ctx.refuse(invalid.code, invalid.problem);
      ctx.write(p.binding.file, record);
      if (p.index) {
        const doc = p.index.doc;
        for (const key of p.index.stale) delete doc.current[key];
        ctx.write(`${state.RUNTIME_DIR}/index.json`, doc);
      }
      if (p.selection) ctx.write(changes.SELECTION_FILE, { schema: 1, change: p.change, selected: ctx.now });
      return { plan: p, record };
    });
    if (out.result.already) return { plan: out.result.plan, applied: false, already: true };
    return { plan: out.result.plan, applied: true, record: out.result.record, backups, backupDir: backups.length ? `.pincer/backups/${stamp}/` : null };
  } catch (error) {
    if (error.refusal) return { plan: first, applied: false, error: error.message, code: error.code, backups };
    if (error.code === 'STATE_BUSY') return { plan: first, applied: false, error: error.message, code: 'STATE_BUSY', backups };
    throw error;
  }
}

module.exports = { plan, renderPlan, apply, IGNORE_LINE, gitignoreHas };
