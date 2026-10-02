'use strict';
// PINCER runtime — change identity (docs/runtime-contracts.md, "Change binding").
// A change binding under .prd/changes/<id>.json ties runtime verification to one
// explicitly selected PRD and its content revision. Written only here and by
// migration; never inferred from the highest PRD number.
const fs = require('node:fs');
const path = require('node:path');
const parse = require('./parse.cjs');
const { nowIso, atomicWrite, readJson, tryGit } = require('./fsutil.cjs');

const CHANGE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const RUNTIME = 1;
const BINDING_KEYS = ['schema', 'change', 'prd', 'prd_revision', 'base', 'registered', 'authorization', 'runtime', 'legacy_receipts'];

const bindingsDir = root => path.join(root, '.prd', 'changes');
const CHANGES_HINT = 'this project keeps change records (schema 2) under .prd/changes/; inspect them with: node scripts/pincer-runtime.cjs change list';
function listBindings(root) {
  const dir = bindingsDir(root);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(name => name.endsWith('.json')).sort().map(name => `.prd/changes/${name}`);
}

function validateBinding(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return 'binding must be a JSON object';
  if (doc.schema !== 1) return `unsupported binding schema ${JSON.stringify(doc.schema)} (this runtime reads schema 1)`;
  for (const key of Object.keys(doc)) if (!BINDING_KEYS.includes(key)) return `unknown binding key "${key}"`;
  for (const key of BINDING_KEYS) if (!(key in doc)) return `missing binding key "${key}"`;
  if (typeof doc.change !== 'string' || !CHANGE_ID.test(doc.change)) return 'change must match [a-z0-9][a-z0-9-]{0,63}';
  if (typeof doc.prd !== 'string' || !parse.PRD_REF.test(doc.prd)) return 'prd must be of the form .prd/prd-vN.md';
  if (typeof doc.prd_revision !== 'string' || !SHA256.test(doc.prd_revision)) return 'prd_revision must be a 64-hex SHA-256 digest';
  if (typeof doc.base !== 'string' || !parse.HEX40.test(doc.base)) return 'base must be a full 40-hex commit ID';
  if (typeof doc.registered !== 'string' || !parse.TIMESTAMP.test(doc.registered)) return 'registered must be an ISO UTC timestamp';
  if (doc.authorization !== null && (typeof doc.authorization !== 'string' || doc.authorization.length > 2000)) return 'authorization must be null or a short string';
  if (doc.runtime !== RUNTIME) return `unsupported runtime contract ${JSON.stringify(doc.runtime)}`;
  if (!doc.legacy_receipts || typeof doc.legacy_receipts !== 'object' || Array.isArray(doc.legacy_receipts)) return 'legacy_receipts must be an object';
  return null;
}

// Resolve the binding for this worktree. Returns { binding, file, prd } or
// { code, problem } with the contracted codes; `prd`, when given, is the PRD the
// caller needs — a binding for another PRD is CHANGE_REQUIRED with `other` set so
// callers can treat that PRD as legacy.
function loadBinding(root, { prd } = {}) {
  // Mode first (docs/runtime-contracts.md, "Modes"): schema 2 records are the
  // changes mode and never fall back to a binding or to legacy; mixed or
  // unreadable directories are invalid.
  const scan = require('./changes.cjs').scan(root);
  if (scan.mode === 'changes') return { code: 'CHANGES_MODE', problem: `${CHANGES_HINT}`, scan };
  if (scan.mode === 'invalid') return { code: scan.problems[0].code, problem: scan.problems[0].detail, scan };
  // A committed transaction that was not fully applied is unsafe in every mode, not
  // only in changes mode: `recover` finishes it by renaming its staged files into
  // place, over anything written since. Changes mode raises this through
  // changes.scan(); a migrated or legacy project reaches it here, and a migrated
  // project is the one `migrate --apply` crashes in.
  const pending = require('./transaction.cjs').pending(root);
  if (pending.committed.length) {
    const first = pending.committed[0];
    return { code: 'STATE_INCOMPLETE', problem: `a committed transaction (${first.command || first.id}) was not fully applied; run: node scripts/pincer-runtime.cjs recover` };
  }
  const files = listBindings(root);
  if (files.length === 0) {
    const hint = prd ? `register it with: node scripts/pincer-runtime.cjs register --prd ${prd}` : 'run register or migrate';
    return { code: 'CHANGE_REQUIRED', problem: `no change binding under .prd/changes/ — ${hint}` };
  }
  if (files.length > 1) return { code: 'AMBIGUOUS', problem: `several change bindings under .prd/changes/ (${files.map(f => path.basename(f)).join(', ')}) — keep exactly one` };
  const file = files[0];
  const read = readJson(path.join(root, file));
  if (read.error) return { code: 'MALFORMED', problem: `${file}: ${read.error}`, file };
  const invalid = validateBinding(read.data);
  if (invalid) return { code: /schema|runtime contract/.test(invalid) ? 'UNSUPPORTED_SCHEMA' : 'MALFORMED', problem: `${file}: ${invalid}`, file };
  const binding = read.data;
  if (path.basename(file, '.json') !== binding.change) return { code: 'MALFORMED', problem: `${file}: filename does not match change "${binding.change}"`, file };
  if (prd && binding.prd !== prd) return { code: 'CHANGE_REQUIRED', other: true, binding, file, problem: `${file} binds ${binding.prd}, not ${prd}` };
  const prdResult = parse.validatePrd(root, binding.prd);
  if (!prdResult.ok) return { code: 'INPUT_INVALID', problem: `${binding.prd}: ${prdResult.problems[0]}`, binding, file };
  const revision = parse.prdDigest(prdResult.text);
  if (revision !== binding.prd_revision) {
    return { code: 'REVISION_CHANGED', binding, file, revision, problem: `${binding.prd} content changed since registration (revision ${binding.prd_revision.slice(0, 12)} → ${revision.slice(0, 12)}) — rebind explicitly with: node scripts/pincer-runtime.cjs register --prd ${binding.prd} --rebind` };
  }
  return { binding, file, prd: prdResult };
}

function head(root) {
  const result = tryGit(root, ['rev-parse', '--verify', 'HEAD^{commit}']);
  if (result.error || !parse.HEX40.test(result.out.trim())) return null;
  return result.out.trim();
}

const IGNORE_LINE = '.pincer/';
function gitignoreHas(root) {
  const file = path.join(root, '.gitignore');
  if (!fs.existsSync(file)) return false;
  return fs.readFileSync(file, 'utf8').split('\n').map(l => l.trim()).some(l => l === IGNORE_LINE || l === '/.pincer/' || l === '.pincer');
}
// Local runtime state must never become an untracked change: registration and
// migration both make sure .pincer/ is ignored before the binding is written.
function ensureIgnored(root) {
  if (gitignoreHas(root)) return false;
  const file = path.join(root, '.gitignore');
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const lead = existing && !existing.endsWith('\n') ? '\n' : '';
  fs.appendFileSync(file, `${lead}${existing ? '\n' : ''}# pincer runtime state (added by the runtime)\n${IGNORE_LINE}\n`);
  return true;
}

function writeBinding(root, binding) {
  ensureIgnored(root);
  const file = path.join(bindingsDir(root), `${binding.change}.json`);
  atomicWrite(file, `${JSON.stringify(binding, null, 2)}\n`);
  return `.prd/changes/${binding.change}.json`;
}

// Register (or rebind / replace) the selected PRD. Returns { binding, file,
// action: 'registered' | 'unchanged' | 'updated' | 'rebound' | 'replaced', notes }
// or { code, problem }.
function register(root, { prd, change, authorization = null, replace = false, rebind = false } = {}) {
  const prdResult = parse.validatePrd(root, prd);
  if (!prdResult.ok) return { code: 'INPUT_INVALID', problem: `${prdResult.file || prd}: ${prdResult.problems[0]}` };
  const version = prd.match(parse.PRD_REF)[1];
  const id = change || `prd-v${version}`;
  if (!CHANGE_ID.test(id)) return { code: 'INPUT_INVALID', problem: `change ID must match [a-z0-9][a-z0-9-]{0,63}: ${id}` };
  const base = head(root);
  if (!base) return { code: 'UNSUPPORTED_INPUT', problem: 'registration needs a git repository with at least one commit (base = HEAD)' };
  const revision = parse.prdDigest(prdResult.text);
  const notes = [];
  if (authorization === null) notes.push('no --authorization recorded; running registration does not prove human approval');
  const files = listBindings(root);
  if (files.length > 1) return { code: 'AMBIGUOUS', problem: `several change bindings under .prd/changes/ (${files.map(f => path.basename(f)).join(', ')}) — keep exactly one before registering` };
  let existing = null;
  if (files.length === 1) {
    const read = readJson(path.join(root, files[0]));
    const invalid = read.error || validateBinding(read.data);
    if (invalid) return { code: 'MALFORMED', problem: `${files[0]}: ${invalid} — repair or remove it before registering` };
    existing = { file: files[0], binding: read.data };
  }
  // v0.5.0 replaced the binding here (deleting the other PRD's); several changes
  // are retained only by schema 2 records, so a second PRD needs the migration.
  if (replace) return { code: 'MIGRATION_REQUIRED', problem: `--replace would delete ${existing ? existing.file : 'the binding'}; change records are retained instead — migrate first: node scripts/pincer-runtime.cjs migrate --preview --prd ${existing ? existing.binding.prd : prd}, then register ${prd} and select the change to work on with change select (retire one with change supersede or change cancel)` };
  if (existing && (existing.binding.prd !== prd || existing.binding.change !== id)) {
    return { code: 'MIGRATION_REQUIRED', problem: `${existing.file} binds ${existing.binding.prd} as change "${existing.binding.change}"; one binding per worktree in migrated mode — migrate to change records first: node scripts/pincer-runtime.cjs migrate --preview --prd ${existing.binding.prd}, then register ${prd}` };
  }
  if (existing) {
    const current = existing.binding;
    if (current.prd_revision === revision) {
      if (authorization !== null && authorization !== current.authorization) {
        const binding = { ...current, authorization };
        return { binding, file: writeBinding(root, binding), action: 'updated', notes };
      }
      return { binding: current, file: existing.file, action: 'unchanged', notes };
    }
    if (!rebind) {
      return { code: 'REVISION_CHANGED', problem: `${prd} content changed since registration (revision ${current.prd_revision.slice(0, 12)} → ${revision.slice(0, 12)}); pass --rebind to bind the new revision — readiness recorded for the old revision no longer applies` };
    }
    const binding = { ...current, prd_revision: revision, registered: nowIso(), authorization: authorization ?? current.authorization };
    notes.push(`rebound to revision ${revision.slice(0, 12)}; attempts recorded for ${current.prd_revision.slice(0, 12)} no longer establish readiness`);
    return { binding, file: writeBinding(root, binding), action: 'rebound', notes };
  }
  const binding = { schema: 1, change: id, prd, prd_revision: revision, base, registered: nowIso(), authorization, runtime: RUNTIME, legacy_receipts: {} };
  return { binding, file: writeBinding(root, binding), action: 'registered', notes };
}

module.exports = { CHANGE_ID, RUNTIME, BINDING_KEYS, IGNORE_LINE, listBindings, validateBinding, loadBinding, register, writeBinding, head, gitignoreHas, ensureIgnored };
