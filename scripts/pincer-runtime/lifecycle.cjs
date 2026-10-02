'use strict';
// PINCER runtime — ticket lifecycle (docs/runtime-contracts.md, "Modes"). The
// only writer of ticket lifecycle fields. Legacy mode reproduces the v0.4.1
// contract word for word (receipts in the ticket, `done` re-runs the check);
// migrated mode records attempts under .pincer/runtime/ and `done` consumes the
// current passing attempt without rewriting receipts.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const parse = require('./parse.cjs');
const identity = require('./identity.cjs');
const source = require('./source.cjs');
const state = require('./state.cjs');
const readiness = require('./readiness.cjs');
const runner = require('./runner.cjs');
const { sanitizeText, inlineSecretLine } = require('./sanitize.cjs');
const { nowIso } = require('./fsutil.cjs');
const statusModule = require('./status.cjs');
const gates = require('./gates.cjs');

const EXIT = { OK: 0, FAILED: 1, INVALID: 4 };
class Refusal extends Error {
  constructor(message, { prefix = 'pincer-ticket', exit = EXIT.FAILED, code } = {}) { super(message); this.prefix = prefix; this.exit = exit; this.reasonCode = code; }
}
const die = (message, options) => { throw new Refusal(message, options); };

// --- Frontmatter writes (the fm_set / fm_unset contract) --------------------
// Replace a field inside the frontmatter keeping an inline comment, or add it
// before the closing ---. Values are written as `key: value`.
function fmSet(text, key, value) {
  const rows = parse.lines(text);
  let done = false, closed = false;
  const out = rows.map((line, i) => {
    if (i === 0 || closed) return line;
    if (!done && line.startsWith(`${key}:`)) {
      done = true;
      const hash = line.indexOf('#');
      return hash === -1 ? `${key}: ${value}` : `${key}: ${value}   ${line.slice(hash)}`;
    }
    if (line === '---') { closed = true; return done ? line : `${key}: ${value}\n---`; }
    return line;
  });
  if (!done && !closed) out.push(`${key}: ${value}`);
  return `${out.join('\n')}\n`;
}
function fmUnset(text, key) {
  const rows = parse.lines(text);
  let closed = false;
  const out = rows.filter((line, i) => {
    if (i === 0) return true;
    if (closed) return true;
    if (line === '---') { closed = true; return true; }
    return !line.startsWith(`${key}:`);
  });
  return `${out.join('\n')}\n`;
}
const readTicket = (root, file) => fs.readFileSync(path.join(root, file), 'utf8');
const writeTicket = (root, file, text) => fs.writeFileSync(path.join(root, file), text);

// --- Resolution --------------------------------------------------------------
function resolve(root, input) {
  const set = parse.validateTicketSet(root);
  if (!set.ok) die(set.problems.map(p => (set.file ? `${set.file}: ${p}` : p)).join('\n'), { exit: EXIT.INVALID, code: 'INPUT_INVALID' });
  const tf = parse.ticketFile(root, input);
  if (tf.problem) die(tf.problem, { exit: EXIT.INVALID, code: 'INPUT_INVALID' });
  return load(root, tf.file, tf.id);
}
function load(root, file, id) {
  const text = readTicket(root, file);
  const v = parse.validateTicket(file, text);
  if (!v.ok) die(v.problems.map(p => `${file}: ${p}`).join('\n'), { exit: EXIT.INVALID, code: 'INPUT_INVALID' });
  return { id: id || v.fields.ticket, file, text, fields: v.fields, timeout: v.timeout };
}
// usable_ticket_prd: association plus a ticketed/built PRD.
function usablePrd(root, t) {
  const assoc = statusModule.ticketPrd(root, t.file, t.fields);
  if (assoc.problem) die(assoc.problem, { prefix: 'pincer' });
  if (!statusModule.usablePrd(assoc.prdResult)) die(`${assoc.prd}: PRD is draft; complete the authorized breakdown before starting (expected ticketed or built)`, { prefix: 'pincer' });
  return assoc;
}
// The mode of the ticket's PRD. In changes mode the command passes the shared
// guard (docs/runtime-contracts.md, "Command gates") before anything is written
// or launched; the guard's binding carries the change, current agreement and
// legacy receipts for readiness, attempts and closure.
const gateExit = code => (code === 'STATE_BUSY' ? 3 : ['INPUT_INVALID', 'INVENTORY_INVALID', 'COVERAGE_INVALID', 'MALFORMED', 'UNSUPPORTED_SCHEMA', 'HISTORY_INVALID', 'STATE_INCOMPLETE'].includes(code) ? EXIT.INVALID : EXIT.FAILED);
function modeFor(root, prd, { command, ticket } = {}) {
  const bind = identity.loadBinding(root, { prd });
  if (bind.binding && !bind.code) return { mode: 'migrated', binding: bind.binding };
  if (bind.code === 'CHANGE_REQUIRED') return { mode: 'legacy' };
  if (bind.code === 'CHANGES_MODE') {
    try {
      const g = gates.guard(root, { command, ticket: ticket ? { file: ticket.file, fields: ticket.fields } : null, prd });
      return { mode: 'changes', binding: g.binding, guard: g };
    } catch (error) {
      if (error && error.refusal) die(`${error.code}: ${error.message}`, { prefix: 'pincer', exit: gateExit(error.code), code: error.code });
      throw error;
    }
  }
  die(`${bind.code}: ${bind.problem}`, { prefix: 'pincer', exit: EXIT.INVALID, code: bind.code });
  return null;
}

// --- Readiness of a dependency or of the ticket itself ------------------------
function currentInputs(root, binding) {
  const manifest = source.snapshot(root);
  const indexRead = state.exists(root) ? state.readIndex(root) : { index: null };
  if (indexRead.error) die(indexRead.error, { prefix: 'pincer', exit: EXIT.INVALID, code: 'INPUT_INVALID' });
  return { manifest, index: indexRead.index, current: { prdRevision: binding.prd_revision, sourceDigest: manifest.digest } };
}
function migratedReadiness(root, t, binding, inputs) {
  const key = state.contextKey({ kind: 'ticket', change: binding.change, ticket: t.id });
  const attempt = inputs.index ? state.inspectArtifacts(root, state.latestAttempt(root, key, inputs.index)) : null;
  let changedPaths = [];
  if (attempt && attempt.source && inputs.manifest.digest && attempt.source.after !== inputs.manifest.digest) {
    const before = source.readManifest(root, attempt.source.after);
    if (before) changedPaths = source.diffManifests(before, inputs.manifest);
  }
  const legacyReceipt = (binding.legacy_receipts && binding.legacy_receipts[t.id]) || (t.fields.verified || t.fields.last_check ? { verified: t.fields.verified, last_check: t.fields.last_check } : null);
  const r = readiness.migratedTicketReadiness({ text: t.text, fields: t.fields, timeout: t.timeout, attempt, legacyReceipt, current: inputs.current, sourceProblems: inputs.manifest.problems, changedPaths, contextKey: key, pointedId: inputs.index ? inputs.index.current[key] || null : null, mode: binding.mode || 'migrated', strict: Boolean(binding.strict) });
  r.attempt = attempt;
  return r;
}
function ticketReady(root, t, mode, binding, inputs) {
  if (mode === 'legacy') { const r = readiness.legacyTicketReadiness(t.text, t.fields); return r.ready ? null : r.legacyMessage; }
  const r = migratedReadiness(root, t, binding, inputs);
  return r.ready ? null : `${r.reasons[0].code}: ${r.reasons[0].detail} — ${r.reasons[0].next}`;
}

// --- Commands ----------------------------------------------------------------
function bind(root, input, ref) {
  const t = resolve(root, input);
  const v = parse.validatePrd(root, ref);
  if (!v.ok) die(`${v.file ? `${v.file}: ` : ''}${v.problems[0]}`, { prefix: 'pincer' });
  const existing = t.fields.prd || '';
  if (existing && existing !== ref) die(`${t.id} already references ${existing}; refusing to rebind it to ${ref}`);
  if (existing !== ref) writeTicket(root, t.file, fmSet(t.text, 'prd', ref));
  return { out: `${t.id} bound to PRD ${ref}\n` };
}

function start(root, input, { quiet = false } = {}) {
  const t = resolve(root, input);
  const assoc = usablePrd(root, t);
  const { mode, binding } = modeFor(root, assoc.prd, { command: 'start', ticket: t });
  const st = t.fields.status;
  if (st === 'in_progress') {
    if (!t.fields.prd) writeTicket(root, t.file, fmSet(t.text, 'prd', assoc.prd));
    return { out: quiet ? '' : `${t.id} already in progress (started ${t.fields.started || ''})\n`, mode, binding };
  }
  if (st === 'done') die(`${t.id} is already done`);
  const inputs = mode !== 'legacy' ? currentInputs(root, binding) : null;
  for (const dep of parse.dependencies(t.fields)) {
    const df = parse.ticketFile(root, dep);
    if (df.problem) die(df.problem);
    const d = load(root, df.file, dep);
    if (d.fields.status !== 'done') die(`${t.id} depends on ${dep}, which is '${d.fields.status}' — finish ${dep} first (or fix depends_on in ${t.file})`);
    const depAssoc = usablePrd(root, d);
    if (depAssoc.prd !== assoc.prd) die(`${t.id} references ${assoc.prd} but dependency ${dep} references ${depAssoc.prd}`);
    const problem = ticketReady(root, d, mode, binding, inputs);
    if (problem) die(`${t.id} depends on ${dep}: ${problem}`);
  }
  let text = t.text;
  if (!t.fields.prd) text = fmSet(text, 'prd', assoc.prd);
  text = fmSet(text, 'status', 'in_progress');
  if (!t.fields.started) text = fmSet(text, 'started', nowIso());
  writeTicket(root, t.file, text);
  const started = parse.frontmatterField(text, 'started');
  return { out: `▶ ${t.id} started ${started} — ${t.file}\n`, mode, binding };
}

// Legacy execution: the block runs with inherited stdio in its own process group;
// SIGINT/SIGTERM to the runtime terminate it and are reported as interrupted.
function executeLegacy(root, block) {
  return new Promise(resolve => {
    const child = spawn(runner.runnerInfo().shell, ['-eo', 'pipefail', '-c', block], { cwd: root, detached: true, stdio: 'inherit', env: process.env });
    let interrupted = null;
    const onSignal = signal => { interrupted = signal; try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch { /* gone */ } } setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } }, runner.GRACE_MS).unref(); };
    process.on('SIGINT', onSignal); process.on('SIGTERM', onSignal);
    child.on('error', error => { process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal); resolve({ code: 127, signal: null, interrupted, error: error.message }); });
    child.on('exit', (code, signal) => { process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal); resolve({ code, signal, interrupted }); });
  });
}

async function verify(root, input, { write = process.stdout, error = process.stderr } = {}) {
  const t0 = resolve(root, input);
  const assoc = usablePrd(root, t0);
  const { mode, binding } = modeFor(root, assoc.prd, { command: 'verify', ticket: t0 });
  if (t0.fields.status === 'open') {
    // A verify on an open ticket starts it; in changes mode that needs an active change.
    if (mode === 'changes') modeFor(root, assoc.prd, { command: 'start', ticket: t0 });
    const s = start(root, t0.id); write.write(s.out);
  }
  const t = load(root, t0.file, t0.id);
  if (mode === 'legacy') return verifyLegacy(root, t, write, error);
  return verifyMigrated(root, t, binding, write, error);
}

async function verifyLegacy(root, t, write, error) {
  const id = t.id, file = t.file;
  if (t.fields.status === 'done') write.write(`${id} is done — re-running its check and updating the latest outcome\n`);
  const commands = parse.verificationCommands(t.text);
  const block = parse.blockText(t.text);
  let text = fmUnset(t.text, 'verified');
  const hash = parse.legacyBlockHash(t.text);
  text = fmSet(text, 'last_check', `${nowIso()} running ${hash}`);
  writeTicket(root, file, text);
  if (!commands.some(c => !/^[ \t]*(#.*)?$/.test(c))) die(`no runnable command in the Verification block of ${file}`);
  write.write(`── ${id} verification ──\n`);
  for (const c of commands) write.write(`  $ ${c}\n`);
  const result = await executeLegacy(root, block);
  const stamp = outcome => writeTicket(root, file, fmSet(readTicket(root, file), 'last_check', `${nowIso()} ${outcome} ${hash}`));
  if (result.interrupted) { stamp('interrupted'); return { exit: 130 }; }
  const rc = result.code === null ? 1 : result.code;
  if (rc !== 0) {
    stamp('failed');
    error.write(`✗ ${id} verification FAILED (exit ${rc}) — failure recorded in last_check of ${file}; any prior successful receipt was revoked. Fix, then re-run verify.\n`);
    return { exit: rc };
  }
  const after = readTicket(root, file);
  if (parse.legacyBlockHash(after) !== hash) { stamp('failed'); die('Verification block changed during execution — re-run verify'); }
  const v = parse.validateTicket(file, after);
  let usable = v.ok;
  if (usable) { try { usablePrd(root, { file, fields: v.fields }); } catch { usable = false; } }
  if (!usable) { stamp('failed'); die('ticket became invalid during verification — fix it and re-run verify'); }
  let done = fmSet(after, 'last_check', `${nowIso()} passed ${hash}`);
  done = fmSet(done, 'verified', `${nowIso()} ${hash}`);
  writeTicket(root, file, done);
  write.write(`✓ ${id} verified — receipt: ${parse.frontmatterField(done, 'verified')}\n`);
  return { exit: 0 };
}

async function verifyMigrated(root, t, binding, write, error) {
  const id = t.id;
  if (t.fields.status === 'done') write.write(`${id} is done — re-running its check and recording the latest outcome\n`);
  const commands = parse.verificationCommands(t.text);
  const secretLine = inlineSecretLine(commands);
  if (secretLine) die(`${t.file}: Verification block line ${secretLine} assigns a secret-like literal; reference it from the environment instead (the block is recorded as display text)`, { exit: EXIT.INVALID, code: 'INPUT_INVALID' });
  const announce = () => { write.write(`── ${id} verification ──\n`); for (const c of commands) write.write(`  $ ${sanitizeText(c).text}\n`); };
  const contextFor = b => ({ kind: 'ticket', change: b.change, prd: b.prd, prd_revision: b.prd_revision, base: b.base, ticket: id, ticket_digest: parse.ticketDigest(t.text), ...(b.agreement ? { agreement: b.agreement } : {}), ...(b.strict ? { inventory: b.inventory, coverage: b.coverage } : {}) });
  // In changes mode the guard runs again under the runner's lock (docs/runtime-contracts.md,
  // "Command gates"): a transition, revision or authorization committed since the
  // pre-launch evaluation refuses the attempt or is the agreement it records.
  const revalidate = binding.mode === 'changes' ? () => contextFor(gates.guard(root, { command: 'verify', ticket: { file: t.file, fields: t.fields } }).binding) : null;
  const result = await runner.runAttempt({ root, context: contextFor(binding), commands, timeoutSeconds: t.timeout, command: `verify ${id}`, revalidate, announce });
  if (result.code) die(`${result.code}: ${result.problem}`, { prefix: 'pincer', exit: result.refused ? gateExit(result.code) : result.code === 'STATE_BUSY' ? 3 : EXIT.INVALID, code: result.code });
  const a = result.attempt;
  const logs = `${state.RUNTIME_DIR}/attempts/${a.id}/`;
  if (a.outcome === 'passed') {
    write.write(`✓ ${id} verified — attempt ${a.id} passed (source ${a.source.after.slice(0, 12)}, logs ${logs})\n`);
    return { exit: 0, attempt: a };
  }
  const why = a.outcome === 'failed' ? `FAILED (exit ${a.exit_code ?? a.signal})` : a.outcome === 'timed_out' ? `TIMED OUT after ${a.check.timeout_seconds} s` : a.outcome === 'interrupted' ? 'INTERRUPTED' : `ERROR: ${a.error}`;
  error.write(`✗ ${id} verification ${why} — recorded as attempt ${a.id} (logs ${logs}); any prior passing attempt is superseded. Fix, then re-run verify.\n`);
  return { exit: runner.exitFor(a), attempt: a };
}

const slugWords = file => path.basename(file, '.md').replace(/^T-[0-9]+-/, '').replace(/-/g, ' ');
const closeHint = (id, file) => `✓ ${id} done. Inspect staged work, stage only this ticket's paths, review git diff --cached, then commit: ${id}: ${slugWords(file)}\n`;

async function done(root, input, io = {}) {
  const write = io.write || process.stdout, error = io.error || process.stderr;
  const t = resolve(root, input);
  const assoc = usablePrd(root, t);
  const { mode, binding } = modeFor(root, assoc.prd, { command: 'done', ticket: t });
  const id = t.id, st = t.fields.status;
  if (st !== 'in_progress' && st !== 'done') die(`${id} is '${st}' — run 'scripts/pincer-ticket.sh verify ${id}' first`);
  if (mode === 'legacy') return doneLegacy(root, t, write, error);
  return doneMigrated(root, t, binding, write);
}

async function doneLegacy(root, t, write, error) {
  const id = t.id, file = t.file, st = t.fields.status;
  const rec = t.fields.verified || '';
  if (!rec) die(`no verification receipt on ${id} — run 'scripts/pincer-ticket.sh verify ${id}' and get a green check first`);
  const cur = parse.legacyBlockHash(t.text);
  const recHash = rec.split(/\s+/).pop();
  if (recHash !== cur) die(`receipt hash ${recHash} does not match the current Verification block (${cur}): the check changed after it passed — run 'scripts/pincer-ticket.sh verify ${id}' again`);
  const u = parse.unticked(t.text);
  if (u.length) die(`unticked acceptance criteria on ${id}:\n${u.join('\n')}\nTick each verified criterion; a criterion that was cut is a scope change to record in the PRD, not a box to skip.`);
  const result = await verifyLegacy(root, t, write, error);
  if (result.exit !== 0) return result;
  const after = load(root, file, id);
  const u2 = parse.unticked(after.text);
  if (u2.length) die(`unticked acceptance criteria on ${id} after verification:\n${u2.join('\n')}`);
  if (st === 'done') { write.write(`${id} already done — current check passed\n`); return { exit: 0 }; }
  let text = fmSet(after.text, 'status', 'done');
  text = fmSet(text, 'finished', nowIso());
  writeTicket(root, file, text);
  write.write(closeHint(id, file));
  return { exit: 0 };
}

// Migrated closure consumes the latest passing attempt against current inputs
// and checked criteria; it never launches the check and writes the ticket once.
async function doneMigrated(root, t, binding, write) {
  const id = t.id, file = t.file, st = t.fields.status;
  const inputs = currentInputs(root, binding);
  const r = migratedReadiness(root, t, binding, inputs);
  if (!r.ready) {
    const first = r.reasons[0];
    const lines = r.reasons.map(x => `${x.code}: ${x.detail}`);
    die(`${id} cannot close — ${lines.join('; ')}\nnext: ${first.next}`, { code: first.code });
  }
  if (st === 'done') { write.write(`${id} already done — current attempt ${r.attempt.id} passed\n`); return { exit: 0 }; }
  let text = fmSet(t.text, 'status', 'done');
  text = fmSet(text, 'finished', nowIso());
  writeTicket(root, file, text);
  write.write(closeHint(id, file));
  return { exit: 0 };
}

module.exports = { Refusal, fmSet, fmUnset, bind, start, verify, done, migratedReadiness, currentInputs };
