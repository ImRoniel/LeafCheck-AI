'use strict';
// PINCER runtime — local state store (docs/runtime-contracts.md, "Attempts").
// Everything under <root>/.pincer/runtime/ belongs to this worktree: an index
// with the authoritative sequence and current pointers, one record per attempt,
// content-addressed source manifests, an exclusive lock directory and a journal
// for atomic replacement. Nothing here is a second editable truth.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { nowIso, atomicWrite, readJson } = require('./fsutil.cjs');
const io = require('./io.cjs');

const RUNTIME_DIR = '.pincer/runtime';
const INDEX_SCHEMA = 1;
const LOCK_WAIT_MS = 10000;
const LOCK_POLL_MS = 100;
const GRACE_MS = 5000;

function paths(root) {
  const dir = path.join(root, RUNTIME_DIR);
  return {
    dir,
    index: path.join(dir, 'index.json'),
    attempts: path.join(dir, 'attempts'),
    manifests: path.join(dir, 'manifests'),
    lock: path.join(dir, 'lock'),
    owner: path.join(dir, 'lock', 'owner.json'),
    journal: path.join(dir, 'journal'),
  };
}
function ensureLayout(root) {
  const p = paths(root);
  for (const dir of [p.dir, p.attempts, p.manifests, p.journal]) fs.mkdirSync(dir, { recursive: true });
  return p;
}
const exists = root => fs.existsSync(paths(root).dir);
// Local attempt history exists once an index was written; a selection alone (a fresh
// clone that ran `change select`) is not attempt history.
const hasIndex = root => fs.existsSync(paths(root).index);

const emptyIndex = () => ({ schema: INDEX_SCHEMA, sequence: 0, current: {}, running: [] });
function validateIndex(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return 'index must be a JSON object';
  if (doc.schema !== INDEX_SCHEMA) return `unsupported index schema ${JSON.stringify(doc.schema)}`;
  if (!Number.isInteger(doc.sequence) || doc.sequence < 0) return 'sequence must be a non-negative integer';
  if (!doc.current || typeof doc.current !== 'object' || Array.isArray(doc.current)) return 'current must be an object';
  if (!Array.isArray(doc.running) || !doc.running.every(id => typeof id === 'string')) return 'running must be an array of attempt IDs';
  return null;
}
// Read the index; a missing file is an empty index, a malformed one is an error
// (code INVALID) and is never overwritten by inspection.
function readIndex(root) {
  const p = paths(root);
  if (!fs.existsSync(p.index)) return { index: emptyIndex(), missing: true };
  const read = readJson(p.index);
  if (read.error) return { error: `${RUNTIME_DIR}/index.json: ${read.error}`, code: 'INVALID' };
  const invalid = validateIndex(read.data);
  if (invalid) return { error: `${RUNTIME_DIR}/index.json: ${invalid}`, code: 'INVALID' };
  return { index: read.data };
}
function writeIndex(root, index) {
  const p = ensureLayout(root);
  atomicWrite(p.index, `${JSON.stringify(index, null, 2)}\n`, { journalDir: p.journal });
}

function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}
function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

class StateBusy extends Error {
  constructor(message, owner) { super(message); this.code = 'STATE_BUSY'; this.owner = owner; }
}

// Acquire the exclusive lock: mkdir is atomic; a lock whose owner pid is dead on
// this host is reclaimed with a diagnostic; a live or foreign-host owner is never
// stolen. Returns a release function.
function acquireLock(root, { waitMs, command = 'runtime', log = message => io.err(`${message}\n`) } = {}) {
  const p = ensureLayout(root);
  const bound = waitMs ?? (Number(process.env.PINCER_LOCK_WAIT_MS) > 0 ? Number(process.env.PINCER_LOCK_WAIT_MS) : LOCK_WAIT_MS);
  const deadline = Date.now() + bound;
  const ownerJson = () => `${JSON.stringify({ pid: process.pid, ppid: process.ppid, host: os.hostname(), started: nowIso(), command }, null, 2)}\n`;
  for (;;) {
    // Build the lock directory with its owner file in a private location and
    // rename it into place: a directory rename onto an existing lock fails, so
    // acquisition is atomic and a waiter never sees an owner-less lock.
    const staging = `${p.lock}.new.${process.pid}.${crypto.randomBytes(3).toString('hex')}`;
    try {
      fs.mkdirSync(staging);
      fs.writeFileSync(path.join(staging, 'owner.json'), ownerJson());
      fs.renameSync(staging, p.lock);
      let released = false;
      return () => { if (released) return; released = true; try { fs.rmSync(p.lock, { recursive: true, force: true }); } catch { /* already gone */ } };
    } catch (error) {
      try { fs.rmSync(staging, { recursive: true, force: true }); } catch { /* nothing staged */ }
      if (!['EEXIST', 'ENOTEMPTY', 'EISDIR', 'EPERM'].includes(error.code)) throw error;
    }
    const owner = readJson(p.owner).data || null;
    if (owner && owner.host === os.hostname() && !isAlive(owner.pid)) {
      // Claim the stale directory by renaming it first; only the process that
      // won the rename removes it, after confirming the owner is still the
      // dead one it read (another waiter may have replaced the lock meanwhile).
      const claim = `${p.lock}.stale.${process.pid}.${crypto.randomBytes(3).toString('hex')}`;
      try { fs.renameSync(p.lock, claim); } catch { sleep(LOCK_POLL_MS); continue; }
      const claimed = readJson(path.join(claim, 'owner.json')).data || null;
      if (claimed && claimed.host === os.hostname() && !isAlive(claimed.pid)) {
        log(`pincer: reclaiming stale lock left by pid ${claimed.pid} (${claimed.command || 'unknown command'}, started ${claimed.started || '?'}); the process is no longer running`);
        try { fs.rmSync(claim, { recursive: true, force: true }); } catch { /* best effort */ }
      } else {
        // A live holder's lock was renamed by mistake: give it back.
        try { fs.renameSync(claim, p.lock); } catch { try { fs.rmSync(claim, { recursive: true, force: true }); } catch { /* gone */ } }
      }
      continue;
    }
    if (Date.now() >= deadline) {
      const who = owner ? `pid ${owner.pid} on ${owner.host} (${owner.command || 'unknown command'}, started ${owner.started || '?'})` : 'an unknown owner (no owner.json)';
      throw new StateBusy(`${RUNTIME_DIR}/lock is held by ${who}; retry, or run recover if that process died`, owner);
    }
    sleep(LOCK_POLL_MS);
  }
}
function withLock(root, fn, options) {
  const release = acquireLock(root, options);
  try { return fn(); } finally { release(); }
}

const compactTimestamp = () => nowIso().replace(/[-:]/g, '');
const attemptId = sequence => `${String(sequence).padStart(6, '0')}-${compactTimestamp()}-${crypto.randomBytes(3).toString('hex')}`;
// Context keys (docs/runtime-contracts.md, "Attempts"): ticket keys are change-scoped
// in every runtime mode; candidate keys gain the change in changes mode (schema 2
// records) so two changes sharing a check ID and a candidate never share a pointer.
const contextKey = context => (context.kind === 'candidate'
  ? (context.mode === 'changes' || context.agreement ? `candidate:${context.change}:${context.candidate}:${context.check}` : `candidate:${context.candidate}:${context.check}`)
  : `ticket:${context.change}:${context.ticket}`);

const OUTCOMES = ['running', 'passed', 'failed', 'interrupted', 'timed_out', 'error'];
const SHA256 = /^[0-9a-f]{64}$/;
// Validate an attempt record read from disk against record schema 1 and, when
// given, the context `key` it is read for and the `pointedId` the index names.
// A record that is incomplete, malformed, written for another context or
// carrying another id than the pointer is never evidence: readiness reports
// ATTEMPT_ERROR and export refuses. An `interrupted` record may lack log
// digests (a `recover` that predates their recording). Returns null or a problem.
function validateAttempt(a, key, pointedId) {
  const obj = v => v && typeof v === 'object' && !Array.isArray(v);
  const str = v => typeof v === 'string' && v.length > 0;
  const digestOrNull = v => v === null || (typeof v === 'string' && SHA256.test(v));
  if (!obj(a)) return 'record is not a JSON object';
  const bad = [];
  // Schema 1 (migrated mode), schema 2 (changes mode: the agreement digest is part
  // of the context) and schema 3 (strict coverage: inventory and coverage digests
  // too) share every other field.
  if (![1, 2, 3].includes(a.schema)) bad.push('schema');
  if (a.runtime !== a.schema) bad.push('runtime');
  if (!str(a.id)) bad.push('id');
  if (!Number.isInteger(a.sequence) || a.sequence < 1) bad.push('sequence');
  const c = a.context;
  if (!obj(c) || !['ticket', 'candidate'].includes(c.kind) || !str(c.change) || !str(c.prd) || !str(c.prd_revision) || !str(c.base)
    || (c.kind === 'ticket' ? !str(c.ticket) || !str(c.ticket_digest) : !str(c.candidate) || !str(c.check))
    || (a.schema === 1 ? 'agreement' in c || 'inventory' in c || 'coverage' in c
      : !(typeof c.agreement === 'string' && SHA256.test(c.agreement))
        || (a.schema === 2 ? 'inventory' in c || 'coverage' in c : !(typeof c.inventory === 'string' && SHA256.test(c.inventory) && typeof c.coverage === 'string' && SHA256.test(c.coverage))))) bad.push('context');
  if (!obj(a.check) || typeof a.check.digest !== 'string' || !SHA256.test(a.check.digest) || typeof a.check.display !== 'string'
    || !Number.isInteger(a.check.timeout_seconds) || a.check.timeout_seconds <= 0) bad.push('check');
  if (!OUTCOMES.includes(a.outcome)) bad.push('outcome');
  const finished = OUTCOMES.includes(a.outcome) && a.outcome !== 'running';
  if (!(a.exit_code === null || Number.isInteger(a.exit_code))) bad.push('exit_code');
  if (!(a.signal === null || str(a.signal))) bad.push('signal');
  if (!obj(a.runner) || !str(a.runner.shell) || !Array.isArray(a.runner.args)) bad.push('runner');
  if (!str(a.cwd)) bad.push('cwd');
  if (!obj(a.environment)) bad.push('environment');
  if (!str(a.started)) bad.push('started');
  if (finished ? !str(a.finished) : a.finished !== null) bad.push('finished');
  if (!obj(a.source) || !digestOrNull(a.source.before) || !digestOrNull(a.source.after)) bad.push('source');
  if (!obj(a.artifacts)) bad.push('artifacts');
  else {
    for (const k of ['stdout', 'stderr']) {
      const info = a.artifacts[k];
      const expectedPath = str(a.id) ? `${RUNTIME_DIR}/attempts/${a.id}/${k}.log` : null;
      const digestRequired = finished && a.outcome !== 'interrupted';
      if (!obj(info) || info.path !== expectedPath || !(digestRequired ? typeof info.sha256 === 'string' && SHA256.test(info.sha256) : digestOrNull(info.sha256))) bad.push(`artifacts.${k}`);
    }
  }
  if (bad.length) return `record is incomplete or malformed: ${bad.join(', ')}`;
  if (key && contextKey(c) !== key) return `record belongs to ${contextKey(c)}, not ${key}`;
  if (pointedId && a.id !== pointedId) return `record ${a.id} is not the attempt the index points at (${pointedId})`;
  return null;
}
// Compare an attempt's captured logs with local state: `missing` when a log is
// gone, `altered` when its content no longer matches the digest the record
// carries. Annotates and returns the record; never writes.
function inspectArtifacts(root, attempt) {
  if (!attempt || !attempt.artifacts || typeof attempt.artifacts !== 'object') return attempt;
  for (const k of ['stdout', 'stderr']) {
    const info = attempt.artifacts[k];
    if (!info || typeof info !== 'object' || typeof info.path !== 'string') continue;
    let data;
    try { data = fs.readFileSync(path.join(root, info.path)); } catch { attempt.artifacts[k] = { ...info, missing: true }; continue; }
    if (attempt.outcome !== 'running' && typeof info.sha256 === 'string' && crypto.createHash('sha256').update(data).digest('hex') !== info.sha256) attempt.artifacts[k] = { ...info, altered: true };
  }
  return attempt;
}

function attemptFile(root, id) { return path.join(paths(root).attempts, `${id}.json`); }
function writeAttempt(root, attempt) {
  const p = ensureLayout(root);
  atomicWrite(attemptFile(root, attempt.id), `${JSON.stringify(attempt, null, 2)}\n`, { journalDir: p.journal });
}
function readAttempt(root, id) {
  const read = readJson(attemptFile(root, id));
  if (read.error) return { error: `${RUNTIME_DIR}/attempts/${id}.json: ${read.error}` };
  return { attempt: read.data };
}
function listAttempts(root, key) {
  const p = paths(root);
  if (!fs.existsSync(p.attempts)) return [];
  const out = [];
  for (const name of fs.readdirSync(p.attempts)) {
    if (!name.endsWith('.json') || name.startsWith('.')) continue;
    const read = readJson(path.join(p.attempts, name));
    if (read.error || !read.data || typeof read.data !== 'object') continue;
    if (!key || contextKey(read.data.context || {}) === key) out.push(read.data);
  }
  return out.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
}
// The attempt the index points at for a context. The pointer is the authority:
// a pointed-at record that is missing or unreadable yields null (readiness then
// reports EVIDENCE_MISSING) rather than an older record that may have passed.
// Only when the index carries no pointer at all is the highest sequence used.
function latestAttempt(root, key, index) {
  const idx = index || readIndex(root).index;
  const pointed = idx && idx.current && idx.current[key];
  if (pointed) {
    const read = readAttempt(root, pointed);
    return read.attempt || null;
  }
  const all = listAttempts(root, key);
  return all.length ? all[all.length - 1] : null;
}

// Diagnose and repair after a crash: finalize running attempts whose owner is
// dead on this host as interrupted, report the rest, remove stray journal files.
// Never promotes an unfinished record to passed.
function recover(root, options = {}) {
  return withLock(root, () => {
    const p = paths(root);
    // Committed-but-unapplied transactions are completed and uncommitted staging
    // is discarded before anything else is read (docs/runtime-contracts.md,
    // "Transactions and recovery"); required lazily to avoid a module cycle.
    const transactions = require('./transaction.cjs').recoverPending(root);
    const read = readIndex(root);
    if (read.error) { const e = new Error(read.error); e.code = 'INVALID'; throw e; }
    const index = read.index;
    const report = { finalized: [], live: [], foreign: [], missing: [], journal: [], transactions };
    const stillRunning = [];
    for (const id of index.running) {
      const attempt = readAttempt(root, id).attempt;
      if (!attempt) { report.missing.push(id); continue; }
      if (attempt.outcome !== 'running') continue;
      const owner = attempt.owner || {};
      if (owner.host !== os.hostname()) { report.foreign.push({ id, owner }); stillRunning.push(id); continue; }
      if (isAlive(owner.pid)) { report.live.push({ id, owner }); stillRunning.push(id); continue; }
      attempt.outcome = 'interrupted';
      attempt.finished = nowIso();
      attempt.limitations = [...(attempt.limitations || []), `finalized as interrupted by recover: owner pid ${owner.pid} was no longer running`];
      // Record what the dead runner captured so the logs are bound to the
      // record like every finalized attempt's (a missing log stays unrecorded).
      for (const k of ['stdout', 'stderr']) {
        const info = attempt.artifacts && attempt.artifacts[k];
        if (!info || typeof info.path !== 'string') continue;
        try { const data = fs.readFileSync(path.join(root, info.path)); attempt.artifacts[k] = { ...info, sha256: crypto.createHash('sha256').update(data).digest('hex'), bytes: data.length }; } catch { /* leave as recorded */ }
      }
      const childPid = attempt.child && attempt.child.pid;
      if (childPid && isAlive(childPid)) {
        // Terminate the orphaned group and wait for it here: an unref'd timer
        // would never fire before the command exits.
        const signalGroup = signal => { try { process.kill(-childPid, signal); } catch { try { process.kill(childPid, signal); } catch { /* gone */ } } };
        signalGroup('SIGTERM');
        const deadline = Date.now() + GRACE_MS;
        while (isAlive(childPid) && Date.now() < deadline) sleep(LOCK_POLL_MS);
        if (isAlive(childPid)) {
          signalGroup('SIGKILL');
          const hardDeadline = Date.now() + 2000;
          while (isAlive(childPid) && Date.now() < hardDeadline) sleep(LOCK_POLL_MS);
          attempt.limitations.push(`orphaned child process group ${childPid} ignored SIGTERM for ${GRACE_MS / 1000} s and was sent SIGKILL${isAlive(childPid) ? ' (still alive when recover returned)' : ''}`);
        } else attempt.limitations.push(`orphaned child process group ${childPid} was sent SIGTERM and exited`);
      }
      writeAttempt(root, attempt);
      report.finalized.push(id);
    }
    if (fs.existsSync(p.journal)) {
      for (const name of fs.readdirSync(p.journal)) {
        const file = path.join(p.journal, name);
        let stat = null;
        try { stat = fs.lstatSync(file); } catch { continue; }
        if (stat.isDirectory()) continue; // transaction staging is handled above; an unreadable manifest stays for inspection
        try { fs.rmSync(file, { force: true }); report.journal.push(`${RUNTIME_DIR}/journal/${name}`); } catch { /* ignore */ }
      }
    }
    if (stillRunning.length !== index.running.length || report.missing.length) {
      index.running = stillRunning;
      writeIndex(root, index);
    }
    return report;
  }, { command: 'recover', ...options });
}

module.exports = {
  RUNTIME_DIR, INDEX_SCHEMA, LOCK_WAIT_MS, StateBusy,
  paths, ensureLayout, exists, hasIndex, emptyIndex, readIndex, writeIndex, isAlive,
  acquireLock, withLock, attemptId, contextKey, validateAttempt, inspectArtifacts, writeAttempt, readAttempt, listAttempts, latestAttempt, recover,
};
