'use strict';
// PINCER runtime — the source manifest (docs/runtime-contracts.md, "Source
// manifest"): a versioned SHA-256 identity of the inputs a verification ran
// against. Tracked plus untracked non-ignored files, modes, deletions; tickets
// and PRDs normalized; fixed and configured exclusions; secret paths, symlinks
// and submodules refused rather than silently omitted.
const fs = require('node:fs');
const path = require('node:path');
const parse = require('./parse.cjs');
const { atomicWrite, tryGit } = require('./fsutil.cjs');

const SCHEMA = 1;
const FIXED_EXCLUDES = ['.git/', '.pincer/', 'NOTES.md', '.prd/evidence/', '.prd/changes/'];
const EXCLUDE_FILE = '.prd/source-exclude';
const PROTECTED_PREFIXES = ['tickets/'];
const NUL = String.fromCharCode(0);

const isTicket = p => /^tickets\/T-[0-9]+.*\.md$/.test(p);
const isPrd = p => parse.PRD_REF.test(p);
const isSecret = p => { const b = path.posix.basename(p); return b === '.env' || (b.startsWith('.env.') && b !== '.env.example'); };
const fixedExcluded = p => FIXED_EXCLUDES.some(rule => (rule.endsWith('/') ? p.startsWith(rule) : p === rule));

// Glob -> RegExp: `**` spans directories, `*` stays within a segment, `?` is one
// character; a pattern without `/` matches a basename anywhere; a trailing `/`
// matches a directory prefix.
function compilePattern(pattern) {
  const escape = s => s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const glob = s => escape(s).replace(/\*\*/g, 'DOUBLESTAR').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/DOUBLESTAR/g, '.*');
  if (pattern.endsWith('/')) return new RegExp(`^${glob(pattern.slice(0, -1))}/`);
  if (!pattern.includes('/')) return new RegExp(`(^|/)${glob(pattern)}$`);
  return new RegExp(`^${glob(pattern.replace(/^\//, ''))}$`);
}
function readExcludeFile(root) {
  const file = path.join(root, EXCLUDE_FILE);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
}

const splitZ = buffer => (buffer ? buffer.toString('utf8').split(NUL).filter(Boolean) : []);

// Compute the manifest. Returns { schema, digest, files, excluded, limitations, problems }.
function snapshot(root) {
  const problems = [];
  const limitations = [];
  const excluded = [];
  const toplevel = tryGit(root, ['rev-parse', '--show-toplevel']);
  if (toplevel.error) {
    return { schema: SCHEMA, digest: null, files: [], excluded, limitations, problems: [{ code: 'UNSUPPORTED_INPUT', detail: 'not inside a git repository; the source identity needs git' }] };
  }
  const tracked = new Map(); // path -> mode from the index
  const staged = tryGit(root, ['ls-files', '-z', '-s'], { buffer: true });
  if (staged.error) problems.push({ code: 'UNSUPPORTED_INPUT', detail: `git ls-files failed: ${staged.error}` });
  else {
    for (const entry of splitZ(staged.out)) {
      const match = entry.match(/^(\d{6}) [0-9a-f]{40} \d\t([\s\S]*)$/);
      if (match) tracked.set(match[2], match[1]);
    }
  }
  const listed = tryGit(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { buffer: true });
  const paths = listed.error ? [] : [...new Set(splitZ(listed.out))];
  const deleted = new Set(splitZ(tryGit(root, ['ls-files', '-z', '--deleted'], { buffer: true }).out));
  const ignoredDirs = splitZ(tryGit(root, ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory'], { buffer: true }).out)
    .filter(p => !p.startsWith('.pincer/') && p !== '.pincer/');
  if (ignoredDirs.length) {
    const shown = ignoredDirs.slice(0, 10).join(', ') + (ignoredDirs.length > 10 ? `, ... (${ignoredDirs.length} ignored paths)` : '');
    limitations.push(`ignored paths are not part of the source identity: ${shown}`);
  }
  limitations.push('external services and installed toolchains are not part of the source identity');

  const patterns = readExcludeFile(root).map(pattern => ({ pattern, regex: compilePattern(pattern) }));
  const entries = [];
  for (const p of paths) {
    if (fixedExcluded(p)) { excluded.push(p); continue; }
    if (isSecret(p)) { problems.push({ code: 'SECRET_PATH', detail: `${p}: secret file in the source view; remove it or ignore it (its contents were not read)` }); continue; }
    const mode = tracked.get(p);
    if (mode === '160000') { problems.push({ code: 'UNSUPPORTED_INPUT', detail: `${p}: submodules are not supported` }); continue; }
    const abs = path.join(root, p);
    let stat = null;
    try { stat = fs.lstatSync(abs); } catch { stat = null; }
    if (mode === '120000' || (stat && stat.isSymbolicLink())) { problems.push({ code: 'UNSUPPORTED_INPUT', detail: `${p}: symbolic links are not supported` }); continue; }
    const rule = patterns.find(({ regex }) => regex.test(p));
    if (rule) {
      if (PROTECTED_PREFIXES.some(prefix => p.startsWith(prefix)) || isPrd(p) || p === EXCLUDE_FILE) problems.push({ code: 'UNSUPPORTED_INPUT', detail: `${EXCLUDE_FILE}: pattern "${rule.pattern}" matches protected path ${p}` });
      else if (tracked.has(p)) problems.push({ code: 'UNSUPPORTED_INPUT', detail: `${EXCLUDE_FILE}: pattern "${rule.pattern}" matches tracked file ${p}; exclusions may cover untracked paths only` });
      else excluded.push(p);
      continue;
    }
    if (deleted.has(p) || !stat) { entries.push({ path: p, deleted: true }); continue; }
    if (stat.isDirectory()) continue;
    let content;
    try { content = fs.readFileSync(abs); } catch (error) { problems.push({ code: 'UNSUPPORTED_INPUT', detail: `${p}: cannot read (${error.code || error.message})` }); continue; }
    let sha;
    if (isTicket(p)) sha = parse.sha256(parse.normalizeTicket(content.toString('utf8')));
    else if (isPrd(p)) sha = parse.sha256(parse.normalizePrd(content.toString('utf8')));
    else sha = parse.sha256(content);
    entries.push({ path: p, sha256: sha, mode: (stat.mode & 0o111) ? '100755' : '100644' });
  }
  entries.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  const digestInput = entries.map(e => `${e.deleted ? 'deleted' : e.mode} ${e.deleted ? '-' : e.sha256} ${e.path}\n`).join('');
  const digest = problems.length ? null : parse.sha256(digestInput);
  return { schema: SCHEMA, digest, files: entries, excluded, limitations, problems };
}

function storeManifest(root, manifest) {
  if (!manifest.digest) throw new Error('cannot store a manifest with problems');
  const file = path.join(root, '.pincer', 'runtime', 'manifests', `${manifest.digest}.json`);
  if (!fs.existsSync(file)) atomicWrite(file, `${JSON.stringify(manifest, null, 2)}\n`, { journalDir: path.join(root, '.pincer', 'runtime', 'journal') });
  return `.pincer/runtime/manifests/${manifest.digest}.json`;
}
function readManifest(root, digest) {
  const file = path.join(root, '.pincer', 'runtime', 'manifests', `${digest}.json`);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// Paths that differ between two manifests, for diagnostics.
function diffManifests(before, after) {
  const a = new Map(before.files.map(e => [e.path, e]));
  const b = new Map(after.files.map(e => [e.path, e]));
  const changed = [];
  for (const [p, e] of b) {
    const prior = a.get(p);
    if (!prior) changed.push(`${p} (added)`);
    else if (JSON.stringify(prior) !== JSON.stringify(e)) changed.push(`${p}${e.deleted ? ' (deleted)' : prior.mode !== e.mode ? ' (mode)' : ''}`);
  }
  for (const p of a.keys()) if (!b.has(p)) changed.push(`${p} (removed)`);
  return changed;
}

module.exports = { SCHEMA, FIXED_EXCLUDES, EXCLUDE_FILE, snapshot, storeManifest, readManifest, diffManifests, compilePattern, isSecret };
