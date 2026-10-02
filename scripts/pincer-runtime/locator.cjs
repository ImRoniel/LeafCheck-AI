'use strict';
// PINCER runtime — evaluation locators (docs/runtime-contracts.md, "Evaluation
// locator"). In changes mode the evaluations of a change are located by
// `.prd/evidence/changes/<change-id>.json`, tracked in git, appended only by
// `evidence export` through a transaction. It lives under the fixed source
// exclusion, is listed in no manifest (no digest refers to itself), and is one
// of the paths allowed to follow the candidate. Root NOTES.md stays a human
// summary of whichever change was evaluated last; the locator is the identity.
const fs = require('node:fs');
const path = require('node:path');
const parse = require('./parse.cjs');
const evidence = require('./evidence.cjs');
const transaction = require('./transaction.cjs');
const { readJson, tryGit } = require('./fsutil.cjs');

const SCHEMA = 1;
const DIR = '.prd/evidence/changes';
const KEYS = ['schema', 'change', 'evaluations'];
const ENTRY_KEYS = ['candidate', 'base', 'prd', 'prd_revision', 'agreement', 'manifest', 'recorded'];
const SHA256 = /^[0-9a-f]{64}$/;
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const file = id => `${DIR}/${id}.json`;

function validate(doc, id) {
  const bad = p => ({ code: 'MALFORMED', problem: `${file(id)}: ${p}` });
  if (!isObject(doc)) return bad('locator must be a JSON object');
  if (doc.schema !== SCHEMA) return { code: 'UNSUPPORTED_SCHEMA', problem: `${file(id)}: unsupported evaluation locator schema ${JSON.stringify(doc.schema)}` };
  for (const k of Object.keys(doc)) if (!KEYS.includes(k)) return bad(`unknown key "${k}"`);
  for (const k of KEYS) if (!(k in doc)) return bad(`missing key "${k}"`);
  if (doc.change !== id) return bad(`locator names change "${doc.change}", not ${id}`);
  if (!Array.isArray(doc.evaluations)) return bad('evaluations must be an array');
  for (const [i, e] of doc.evaluations.entries()) {
    if (!isObject(e)) return bad(`evaluations[${i}] must be an object`);
    for (const k of Object.keys(e)) if (!ENTRY_KEYS.includes(k)) return bad(`evaluations[${i}].${k} is not allowed`);
    for (const k of ENTRY_KEYS) if (!(k in e)) return bad(`evaluations[${i}].${k} is missing`);
    if (!parse.HEX40.test(e.candidate) || !parse.HEX40.test(e.base)) return bad(`evaluations[${i}]: candidate and base must be full 40-hex commit IDs`);
    if (!parse.PRD_REF.test(e.prd)) return bad(`evaluations[${i}]: prd must be .prd/prd-vN.md`);
    if (!SHA256.test(e.prd_revision) || !SHA256.test(e.agreement)) return bad(`evaluations[${i}]: prd_revision and agreement must be 64-hex digests`);
    if (e.manifest !== `.prd/evidence/prd-v${e.prd.match(parse.PRD_REF)[1]}/${e.candidate}/manifest.json`) return bad(`evaluations[${i}]: manifest must be .prd/evidence/prd-v<N>/${e.candidate}/manifest.json for ${e.prd}`);
    if (!parse.TIMESTAMP.test(e.recorded)) return bad(`evaluations[${i}]: recorded must be an ISO UTC timestamp`);
  }
  return null;
}
// { locator } (possibly empty), or { code, problem }. A missing file is an empty locator.
function read(root, id) {
  const r = readJson(path.join(root, file(id)));
  if (r.error === 'missing') return { locator: { schema: SCHEMA, change: id, evaluations: [] }, missing: true };
  if (r.error) return { code: 'MALFORMED', problem: `${file(id)}: ${r.error}` };
  const invalid = validate(r.data, id);
  if (invalid) return invalid;
  return { locator: r.data };
}
const latest = locator => (locator.evaluations.length ? locator.evaluations[locator.evaluations.length - 1] : null);

// Append an evaluation reference (after the manifest was written and validated).
function append(root, id, entry) {
  try {
    const out = transaction.run(root, { command: `evidence export ${id}` }, ctx => {
      const r = read(root, id);
      if (r.code) ctx.refuse(r.code, r.problem);
      const doc = r.locator;
      const same = doc.evaluations.find(e => e.candidate === entry.candidate && e.manifest === entry.manifest && e.agreement === entry.agreement && e.prd_revision === entry.prd_revision && e.base === entry.base);
      if (same) return { action: 'unchanged', entry: same };
      doc.evaluations.push(entry);
      const invalid = validate(doc, id);
      if (invalid) ctx.refuse(invalid.code, invalid.problem);
      ctx.write(file(id), doc);
      return { action: 'recorded', entry };
    });
    return out.result;
  } catch (error) {
    if (error.refusal) return { code: error.code, problem: error.message };
    if (error.code === 'STATE_BUSY') return { code: 'STATE_BUSY', problem: error.message };
    throw error;
  }
}

// The paths that may differ from `candidate` (docs/runtime-contracts.md,
// "Evaluation locator"): NOTES.md, every locator under .prd/evidence/changes/ that
// parses and validates for its own id, and, for each of their entries naming this
// candidate whose manifest validates with file digests for its candidate, base and
// PRD, that manifest and the files it lists. The set is computed from validated
// content, never from a directory or filename pattern: an unlisted file inside an
// evidence directory, an altered listed artifact and an unreadable or misnamed
// locator are candidate changes. Returns a Set of repository-relative paths.
function followers(root, candidate) {
  const allowed = new Set(['NOTES.md']);
  let names = [];
  try { names = fs.readdirSync(path.join(root, DIR)).filter(n => n.endsWith('.json')); } catch { names = []; }
  for (const name of names.sort()) {
    const id = name.slice(0, -'.json'.length);
    const r = read(root, id);
    if (r.code || r.missing) continue;
    allowed.add(file(id));
    for (const e of r.locator.evaluations) {
      if (e.candidate !== candidate) continue;
      const opts = { files: true, candidate: e.candidate, base: e.base, prd: e.prd };
      const problems = evidence.validate(path.resolve(root, e.manifest), opts, root);
      if (problems.length || !Array.isArray(opts.list)) continue;
      for (const listed of opts.list) allowed.add(listed);
    }
  }
  return allowed;
}

// The candidate of a change from its locator, in the shape status reports for
// NOTES.md: { text, state: 'current' | 'stale' | 'missing', candidate, base,
// manifest, entry }. Current means: the latest entry's manifest validates for its
// candidate, base and PRD, the candidate is an ancestor of HEAD, and the diff
// from the candidate to HEAD plus the dirty tree contain nothing but the
// candidate's followers (NOTES.md, valid locators, validated listed artifacts).
function current(root, record) {
  const r = read(root, record.change);
  if (r.code) return { text: `stale: ${r.problem}`, state: 'stale', problem: r };
  const entry = latest(r.locator);
  if (!entry) return { text: `missing (no evaluation recorded in ${file(record.change)})`, state: 'missing' };
  const base = { candidate: entry.candidate, base: entry.base, manifest: entry.manifest, entry, fields: { prd: entry.prd, candidate: entry.candidate, base: entry.base, evidence: entry.manifest } };
  if (entry.prd !== record.prd) return { ...base, text: `stale: the evaluation is for ${entry.prd}, not ${record.prd}`, state: 'stale' };
  const ok = args => !tryGit(root, args).error;
  if (!ok(['rev-parse', '--verify', `${entry.candidate}^{commit}`]) || !ok(['rev-parse', '--verify', `${entry.base}^{commit}`]) ||
      !ok(['merge-base', '--is-ancestor', entry.base, entry.candidate]) || !ok(['merge-base', '--is-ancestor', entry.candidate, 'HEAD'])) {
    return { ...base, text: 'stale: evaluation commits or ancestry unavailable', state: 'stale' };
  }
  const opts = { files: true, candidate: entry.candidate, base: entry.base, prd: entry.prd };
  const problems = evidence.validate(path.resolve(root, entry.manifest), opts, root);
  if (problems.length) return { ...base, text: `stale: evidence invalid: ${problems[0]}`, state: 'stale' };
  let manifestDoc = null;
  try { manifestDoc = JSON.parse(fs.readFileSync(path.resolve(root, entry.manifest), 'utf8')); } catch { manifestDoc = null; }
  if (!manifestDoc || !manifestDoc.change || manifestDoc.change.id !== record.change) return { ...base, text: `stale: ${entry.manifest} records change ${manifestDoc && manifestDoc.change ? manifestDoc.change.id : 'none'}, not ${record.change}`, state: 'stale' };
  for (const f of opts.list) {
    const tracked = tryGit(root, ['ls-files', '--error-unmatch', '--', f]);
    if (tracked.error || !tracked.out.trim()) return { ...base, text: `stale: evidence not tracked: ${f}`, state: 'stale' };
  }
  const set = followers(root, entry.candidate);
  const allowed = p => set.has(p);
  const diff = tryGit(root, ['diff', '--name-only', '--relative', entry.candidate, 'HEAD']);
  if (diff.error) return { ...base, text: 'stale: evaluation commits or ancestry unavailable', state: 'stale' };
  const offending = diff.out.split('\n').filter(l => l && !allowed(l))[0];
  if (offending) return { ...base, text: `stale: candidate changed after evaluation: ${offending}`, state: 'stale' };
  const dirty = tryGit(root, ['status', '--porcelain', '--untracked-files=all']);
  if (dirty.error) return { ...base, text: 'stale: git status failed', state: 'stale' };
  const dirtyPath = dirty.out.split('\n').filter(Boolean).map(l => l.slice(3).replace(/^"(.*)"$/, '$1')).filter(p => !allowed(p))[0];
  if (dirtyPath) return { ...base, text: `stale: working tree has changes outside the candidate's evidence: ${dirtyPath}`, state: 'stale' };
  return { ...base, text: `current (${entry.candidate})`, state: 'current' };
}
// The Evidence line for the locator's latest manifest, independent of currency.
function evidenceLine(root, record) {
  const r = read(root, record.change);
  if (r.code) return { manifest: file(record.change), ok: false, reason: r.problem, schema: null };
  const entry = latest(r.locator);
  if (!entry) return null;
  const problems = evidence.validate(path.resolve(root, entry.manifest), { candidate: entry.candidate, base: entry.base, prd: entry.prd }, root);
  let schema = null;
  try { schema = JSON.parse(fs.readFileSync(path.resolve(root, entry.manifest), 'utf8')).schema; } catch { schema = null; }
  return { manifest: entry.manifest, ok: problems.length === 0, reason: problems[0] || null, schema };
}

module.exports = { SCHEMA, DIR, file, validate, read, latest, append, followers, current, evidenceLine };
