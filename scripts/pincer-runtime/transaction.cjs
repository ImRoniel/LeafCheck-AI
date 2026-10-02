'use strict';
// PINCER runtime — transactions (docs/runtime-contracts.md, "Transactions and
// recovery"). Every write of a change record, agreement snapshot, selection,
// evaluation locator or migration goes through `run`: the worktree lock is held
// for the whole validate-and-write operation, the caller's function computes the
// outcome in memory, the new files are staged under the journal, a manifest is
// written last as the commit point, and the staged files are renamed onto their
// targets. A process killed before the manifest leaves the old state; killed
// after it, the next transaction or `recover` completes the renames. A
// projection is therefore never observable without its event.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const state = require('./state.cjs');
const { nowIso, readJson } = require('./fsutil.cjs');

const MANIFEST_SCHEMA = 1;
const TXN_PREFIX = 'txn-';
const MAX_TEXT = 2000;
const SAFE_RELATIVE = /^(?!\/)(?!.*(^|\/)\.\.(\/|$))[^\0]+$/;

class Refusal extends Error {
  constructor(code, message, extra = {}) { super(message); this.code = code; this.refusal = true; Object.assign(this, extra); }
}
const refuse = (code, message, extra) => { throw new Refusal(code, message, extra); };

const journalDir = root => state.paths(root).journal;
const compact = () => nowIso().replace(/[-:]/g, '');
const serialize = content => (typeof content === 'string' || Buffer.isBuffer(content) ? content : `${JSON.stringify(content, null, 2)}\n`);

// --- Pending transactions (read-only) -------------------------------------------
// A staging directory with a manifest is a committed transaction that was not
// fully applied; one without a manifest is uncommitted staging. Never writes.
function pending(root) {
  const dir = journalDir(root);
  if (!fs.existsSync(dir)) return { committed: [], uncommitted: [] };
  const committed = [], uncommitted = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.startsWith(TXN_PREFIX)) continue;
    const staging = path.join(dir, name);
    let stat = null;
    try { stat = fs.statSync(staging); } catch { continue; }
    if (!stat.isDirectory()) continue;
    const read = readJson(path.join(staging, 'manifest.json'));
    if (read.error === 'missing') { uncommitted.push({ id: name, dir: `${state.RUNTIME_DIR}/journal/${name}` }); continue; }
    if (read.error || !validManifest(read.data)) { committed.push({ id: name, dir: `${state.RUNTIME_DIR}/journal/${name}`, manifest: null, problem: read.error || 'malformed manifest' }); continue; }
    committed.push({ id: name, dir: `${state.RUNTIME_DIR}/journal/${name}`, manifest: read.data, command: read.data.command, started: read.data.started });
  }
  return { committed, uncommitted };
}
function validManifest(m) {
  return m && typeof m === 'object' && !Array.isArray(m) && m.schema === MANIFEST_SCHEMA && typeof m.id === 'string' && typeof m.command === 'string'
    && typeof m.started === 'string' && Array.isArray(m.writes)
    && m.writes.every(w => w && typeof w === 'object' && typeof w.target === 'string' && SAFE_RELATIVE.test(w.target) && typeof w.staged === 'string' && /^[0-9]{2,}-[^/\0]+$/.test(w.staged));
}

// --- Recovery (caller holds the lock) -------------------------------------------
// Complete every committed transaction (each rename is idempotent: a staged file
// that is already gone was renamed before the crash) and discard uncommitted
// staging. Returns what was done. A manifest that cannot be read is left in place
// and reported: completing it would mean guessing its targets.
function recoverPending(root) {
  const report = { completed: [], discarded: [], unreadable: [] };
  const found = pending(root);
  for (const t of found.committed) {
    if (!t.manifest) { report.unreadable.push({ id: t.id, problem: t.problem }); continue; }
    applyManifest(root, path.join(root, t.dir), t.manifest);
    report.completed.push({ id: t.id, command: t.manifest.command, targets: t.manifest.writes.map(w => w.target) });
  }
  for (const t of found.uncommitted) {
    fs.rmSync(path.join(root, t.dir), { recursive: true, force: true });
    report.discarded.push({ id: t.id });
  }
  return report;
}
function applyManifest(root, staging, manifest, hooks = null) {
  manifest.writes.forEach((w, i) => {
    const staged = path.join(staging, w.staged);
    const target = path.join(root, w.target);
    if (fs.existsSync(staged)) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.renameSync(staged, target);
    }
    if (hooks) hooks(`rename:${i}`);
  });
  fs.rmSync(path.join(staging, 'manifest.json'), { force: true });
  if (hooks) hooks('cleanup');
  fs.rmSync(staging, { recursive: true, force: true });
}

// --- Running attempts of a change ---------------------------------------------
// Attempts listed as running in the index whose context names the change. The
// owner's liveness is reported so callers can name `recover` as the next step
// for a dead owner; the transaction never terminates an attempt itself.
function runningAttempts(root, changeId) {
  if (!state.exists(root)) return [];
  const read = state.readIndex(root);
  if (read.error) refuse('INPUT_INVALID', read.error);
  const out = [];
  for (const id of read.index.running) {
    const attempt = state.readAttempt(root, id).attempt;
    if (!attempt || attempt.outcome !== 'running') continue;
    if (!attempt.context || attempt.context.change !== changeId) continue;
    const owner = attempt.owner || {};
    out.push({ id, context: attempt.context, owner, alive: owner.host === os.hostname() ? state.isAlive(owner.pid) : null });
  }
  return out;
}
function requireIdle(root, changeId) {
  const running = runningAttempts(root, changeId);
  if (!running.length) return;
  const a = running[0];
  const hint = a.alive === false ? ' (its owner is no longer running: run recover first)' : a.alive === true ? ` (pid ${a.owner.pid} is still running)` : ` (owned by ${a.owner.host || 'another host'})`;
  refuse('ATTEMPT_RUNNING', `attempt ${a.id} of change ${changeId} is running${hint}; the transition is refused and the attempt is not terminated`, { attempt: a.id });
}

// --- The transaction --------------------------------------------------------------
// run(root, { command, waitMs, hooks }, fn): fn receives a context and returns
// the result to hand back. Inside fn, ctx.read(rel) reads a repository-relative
// JSON file (null when missing), ctx.text(rel) a text file, ctx.write(rel,
// content) stages a write, ctx.expect(rel, key, value) refuses STATE_CHANGED when
// the file's field differs from what the caller prepared against, ctx.idle(id)
// refuses ATTEMPT_RUNNING for a change with a running attempt, ctx.refuse(code,
// message) aborts with nothing written. `hooks(point)` is a test seam invoked at
// 'validated', 'staged', 'manifest', 'rename:<i>' and 'cleanup'.
function run(root, { command = 'transaction', waitMs, hooks = null, log } = {}, fn) {
  return state.withLock(root, () => {
    // Before anything else: finish what a killed writer committed and drop what
    // it only staged, so every reader inside the lock sees consistent state.
    recoverPending(root);
    const writes = [];
    const targets = new Set();
    const ctx = {
      root,
      read(rel) {
        assertRelative(rel);
        const read = readJson(path.join(root, rel));
        if (read.error === 'missing') return null;
        if (read.error) refuse('MALFORMED', `${rel}: ${read.error}`);
        return read.data;
      },
      text(rel) {
        assertRelative(rel);
        try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch (error) { return error.code === 'ENOENT' ? null : refuse('INPUT_INVALID', `${rel}: ${error.message}`); }
      },
      exists(rel) { assertRelative(rel); return fs.existsSync(path.join(root, rel)); },
      expect(rel, key, value) {
        const doc = ctx.read(rel);
        const actual = doc ? doc[key] : null;
        if (actual !== value) refuse('STATE_CHANGED', `${rel}: ${key} is ${JSON.stringify(actual)}, expected ${JSON.stringify(value)}; the record changed since the operation was prepared — inspect it and repeat the command against the current state`);
        return doc;
      },
      idle(changeId) { requireIdle(root, changeId); },
      running(changeId) { return runningAttempts(root, changeId); },
      refuse,
      write(rel, content) {
        assertRelative(rel);
        if (rel.startsWith(`${state.RUNTIME_DIR}/journal/`) || rel.startsWith(`${state.RUNTIME_DIR}/lock`)) refuse('INPUT_INVALID', `${rel}: the journal and the lock are not transaction targets`);
        if (targets.has(rel)) refuse('INPUT_INVALID', `${rel}: written twice in one transaction`);
        targets.add(rel);
        writes.push({ target: rel, content: serialize(content) });
      },
      now: nowIso(),
    };
    const result = fn(ctx);
    if (hooks) hooks('validated');
    if (!writes.length) return { result, writes: [], id: null };
    const id = `${TXN_PREFIX}${compact()}-${crypto.randomBytes(3).toString('hex')}`;
    const staging = path.join(journalDir(root), id);
    fs.mkdirSync(staging, { recursive: true });
    const manifest = { schema: MANIFEST_SCHEMA, id, command, started: ctx.now, writes: [] };
    writes.forEach((w, i) => {
      const staged = `${String(i + 1).padStart(2, '0')}-${path.basename(w.target)}`;
      fs.writeFileSync(path.join(staging, staged), w.content);
      manifest.writes.push({ target: w.target, staged });
    });
    if (hooks) hooks('staged');
    // The manifest is the commit point: written to a temporary name and renamed.
    const temp = path.join(staging, `.manifest.${process.pid}.tmp`);
    fs.writeFileSync(temp, `${JSON.stringify(manifest, null, 2)}\n`);
    fs.renameSync(temp, path.join(staging, 'manifest.json'));
    if (hooks) hooks('manifest');
    applyManifest(root, staging, manifest, hooks);
    return { result, writes: manifest.writes.map(w => w.target), id };
  }, { command, waitMs, log });
}
function assertRelative(rel) {
  if (typeof rel !== 'string' || !SAFE_RELATIVE.test(rel) || path.isAbsolute(rel)) refuse('INPUT_INVALID', `${rel}: paths must be repository-relative without ".."`);
}

// Bounded text arguments stored verbatim in records (reasons, notes, references…).
function boundedText(value, name, { required = true } = {}) {
  if (value === undefined || value === null) { if (required) refuse('INPUT_INVALID', `--${name} is required`); return null; }
  if (typeof value !== 'string' || (required && !value.trim())) refuse('INPUT_INVALID', `--${name} must be a nonempty string`);
  if (value.length > MAX_TEXT) refuse('INPUT_INVALID', `--${name} is longer than ${MAX_TEXT} characters; store a reference, not a transcript`);
  return value;
}

module.exports = { Refusal, refuse, run, pending, recoverPending, runningAttempts, requireIdle, boundedText, MANIFEST_SCHEMA, MAX_TEXT, TXN_PREFIX };
