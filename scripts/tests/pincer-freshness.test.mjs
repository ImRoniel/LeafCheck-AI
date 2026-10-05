import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const status = require('../pincer-runtime/status.cjs');
const locator = require('../pincer-runtime/locator.cjs');
const evidence = require('../pincer-runtime/evidence.cjs');
const parse = require('../pincer-runtime/parse.cjs');
const runtime = resolve('scripts/pincer-runtime.cjs');
const prd = '.prd/prd-v1.md';
const stamp = '2026-01-01T00:00:00Z';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

// All history and evidence below are synthetic and stay in disposable repositories.
function fixture(t, mode = 'changes') {
  const root = mkdtempSync(join(tmpdir(), 'pincer-freshness-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (file, bytes) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), bytes);
  };
  const json = (file, value) => put(file, `${JSON.stringify(value, null, 2)}\n`);
  const git = (...args) => {
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr || String(r.error));
    return r.stdout.trim();
  };
  const cli = (...args) => spawnSync(process.execPath, [runtime, ...args], {
    cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root }, encoding: 'utf8',
  });
  const run = (...args) => { const r = cli(...args); assert.equal(r.status, 0, r.stdout + r.stderr); return r; };
  const commit = () => { git('add', '.'); git('commit', '--allow-empty', '-qm', 'synthetic fixture'); return git('rev-parse', 'HEAD'); };
  git('init', '-q'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'user.name', 'Fixture');
  put('.gitignore', '.pincer/\n');
  const prdText = '---\nversion: 1\nstatus: built\n---\n# Synthetic workflow\n\nR-01: Review workflow freshness.\n';
  put(prd, prdText);
  for (const file of ['src/app.js', 'test/app.test.js', 'package.json']) put(file, file === 'package.json' ? '{}\n' : '// synthetic\n');
  if (mode === 'changes') put('tickets/T-01-fixture.md', '---\nticket: T-01\nstatus: open\nsize: S\nprd: .prd/prd-v1.md\ndepends_on: []\n---\n## Acceptance Criteria\n- [x] Synthetic fixture check passes.\n\n## Verification\n```bash\ntrue\n```\n');
  const base = commit();
  if (mode === 'changes') {
    run('register', '--prd', prd, '--change', 'fixture');
    const shown = JSON.parse(run('change', 'show', 'fixture', '--json').stdout);
    const digest = shown.agreement?.current || status.render(root, { change: 'fixture' }).json.change.agreement.current;
    run('change', 'authorize', 'fixture', '--agreement', digest, '--reference', 'synthetic fixture', '--excerpt', 'Authorize fixture workflow only.');
    run('change', 'select', 'fixture');
    commit();
    run('change', 'activate', 'fixture');
    commit();
    run('start', 'T-01');
    run('verify', 'T-01');
    run('done', 'T-01');
    commit();
    run('change', 'complete', 'fixture');
    // Model a fresh clone: readiness must use portable saved evidence, not local attempts.
    rmSync(join(root, '.pincer/runtime/index.json'), { force: true });
  } else if (mode === 'migrated') {
    json('.prd/changes/fixture.json', { schema: 1, runtime: 1, change: 'fixture', prd,
      prd_revision: parse.prdDigest(prdText), base, registered: stamp, authorization: null, legacy_receipts: {} });
  }
  const candidate = commit();
  const dir = `.prd/evidence/prd-v1/${candidate}`;
  const artifact = `${dir}/review.txt`, manifest = `${dir}/manifest.json`;
  const bytes = 'Synthetic semantic review, not execution attestation.\n';
  put(artifact, bytes);
  const doc = {
    schema: mode === 'changes' ? 2 : 1, prd, candidate, base, created: stamp,
    environment: { os: 'synthetic', node: process.version, tools: [], limitations: [] },
    coverage_review: 'Synthetic workflow characterization review.',
    requirements: [{ id: 'R-01', disposition: 'delivered', tickets: [], checks: ['C-01'] }],
    checks: [{ id: 'C-01', kind: 'review', required: true, result: 'passed', timestamp: stamp,
      artifacts: [artifact], ...(mode === 'changes' ? { provenance: 'authored' } : {}) }],
    visual_review: { applicable: false, reason: 'Workflow tooling has no visual interface.' },
    artifacts: [{ path: artifact, sha256: sha(bytes) }],
    ...(mode === 'changes' ? { change: { id: 'fixture', prd_revision: parse.prdDigest(prdText), base } } : {}),
  };
  json(manifest, doc);
  const entry = { candidate, base, prd, prd_revision: parse.prdDigest(prdText), agreement: 'a'.repeat(64), manifest, recorded: stamp };
  const locatorFile = locator.file('fixture');
  if (mode === 'changes') json(locatorFile, { schema: 1, change: 'fixture', evaluations: [entry] });
  const notes = () => put('NOTES.md', `---\nprd: ${prd}\ncandidate: ${candidate}\nbase: ${base}\nevidence: ${manifest}\n---\nSynthetic handover.\n`);
  notes(); commit();
  assert.deepEqual(evidence.validate(join(root, manifest), { files: true, candidate, base, prd }, root), []);
  const report = () => status.render(root, mode === 'changes' ? { change: 'fixture' } : {});
  const ready = () => cli('ready', ...(mode === 'changes' ? ['--change', 'fixture'] : []));
  assert.equal(report().json.candidate.notes, 'current');
  const baselineReady = ready();
  assert.equal(baselineReady.status, 0, baselineReady.stdout + baselineReady.stderr);
  return { root, mode, put, json, git, cli, commit, base, candidate, artifact, manifest, doc, entry, locatorFile, notes, report, ready };
}

function rejected(f, pattern) {
  const report = f.report();
  assert.equal(report.json.candidate.notes, 'stale');
  assert.match(report.json.candidate.reason, pattern);
  if (f.mode === 'changes') {
    assert.notEqual(status.notesCurrent(f.root, prd, { changesMode: true }).state, 'current');
  }
  const r = f.ready();
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /CANDIDATE_STALE/);
}

for (const file of ['src/app.js', 'test/app.test.js', 'package.json', prd]) {
  for (const committed of [false, true]) test(`characterization: ${committed ? 'committed' : 'dirty'} mutation of ${file} blocks candidate readiness`, t => {
    const f = fixture(t); f.put(file, `${readFileSync(join(f.root, file), 'utf8')}\n// mutation\n`);
    if (committed) f.commit();
    rejected(f, committed ? /candidate changed after evaluation/ : /working tree has changes/);
  });
}

for (const [name, mutate, pattern] of [
  ['malformed locator', f => f.put(f.locatorFile, '{'), /stale:/],
  ['misnamed selected locator', f => f.json(f.locatorFile, { schema: 1, change: 'other', evaluations: [f.entry] }), /locator names change/],
  ['altered artifact digest', f => f.put(f.artifact, 'altered'), /digest mismatch/],
  ['unlisted committed evidence file', f => { f.put(`${dirname(f.manifest)}/extra.txt`, 'extra'); f.commit(); }, /candidate changed after evaluation/],
  ['unlisted dirty evidence file', f => f.put(`${dirname(f.manifest)}/extra.txt`, 'extra'), /working tree has changes/],
  ['missing artifact', f => rmSync(join(f.root, f.artifact)), /missing/],
  ['untracked artifact', f => f.git('rm', '--cached', '--', f.artifact), /evidence not tracked/],
  ['missing manifest', f => rmSync(join(f.root, f.manifest)), /missing/],
  ['untracked manifest', f => f.git('rm', '--cached', '--', f.manifest), /evidence not tracked/],
  ['invalid evidence metadata', f => { f.doc.created = 'invalid'; f.json(f.manifest, f.doc); }, /created must/],
  ['unavailable candidate', f => { f.entry.candidate = 'f'.repeat(40); f.entry.manifest = `.prd/evidence/prd-v1/${f.entry.candidate}/manifest.json`; f.json(f.locatorFile, { schema: 1, change: 'fixture', evaluations: [f.entry] }); }, /ancestry unavailable/],
  ['wrong selected change evidence', f => { f.doc.change.id = 'other'; f.json(f.manifest, f.doc); }, /records change other/],
  ['wrong selected PRD evidence', f => { f.entry.prd = '.prd/prd-v2.md'; f.entry.manifest = f.entry.manifest.replace('prd-v1', 'prd-v2'); f.json(f.locatorFile, { schema: 1, change: 'fixture', evaluations: [f.entry] }); }, /evaluation is for/],
]) test(`characterization: rejects ${name}`, t => {
  const f = fixture(t); mutate(f); rejected(f, pattern);
});

for (const mode of ['legacy', 'migrated']) test(`characterization: ${mode} Notes remains authoritative and rejects locator follow-up commits`, t => {
  const f = fixture(t, mode);
  f.json(f.locatorFile, { schema: 1, change: 'fixture', evaluations: [f.entry] }); f.commit();
  rejected(f, /candidate changed after evaluation/);
  f.put('NOTES.md', 'invalid metadata');
  rejected(f, /invalid or missing evaluation metadata/);
});

for (const action of ['missing', 'overwritten']) test(`characterization: changes Evaluation stays authoritative with ${action} root Notes`, t => {
  const f = fixture(t);
  if (action === 'missing') rmSync(join(f.root, 'NOTES.md'));
  else f.put('NOTES.md', 'unrelated handover');
  assert.equal(f.report().json.candidate.notes, 'current');
  assert.equal(f.ready().status, 0);
  f.put(f.artifact, 'corrupt selected evidence');
  rejected(f, /digest mismatch/);
});

for (const input of ['malformed', 'misnamed']) test(`characterization: ${input} other locator cannot become an allowed follower`, t => {
  const f = fixture(t), file = locator.file('other');
  if (input === 'malformed') f.put(file, '{');
  else f.json(file, { schema: 1, change: 'fixture', evaluations: [] });
  f.commit(); rejected(f, /candidate changed after evaluation/);
  assert.equal(locator.followers(f.root, f.candidate).has(file), false);
});

for (const identity of ['base', 'candidate']) test(`characterization: rejects nonancestor ${identity} commits`, t => {
  const f = fixture(t);
  const unrelated = f.git('commit-tree', f.git('rev-parse', 'HEAD^{tree}'), '-m', 'unrelated synthetic history');
  f.entry[identity] = unrelated;
  if (identity === 'candidate') f.entry.manifest = `.prd/evidence/prd-v1/${unrelated}/manifest.json`;
  f.json(f.locatorFile, { schema: 1, change: 'fixture', evaluations: [f.entry] });
  rejected(f, /ancestry unavailable/);
});

for (const [name, mutate, pattern] of [
  ['missing metadata', f => f.put('NOTES.md', 'no frontmatter'), /invalid or missing evaluation metadata/],
  ['wrong PRD metadata', f => f.put('NOTES.md', `---\nprd: .prd/prd-v2.md\ncandidate: ${f.candidate}\nbase: ${f.base}\nevidence: ${f.manifest}\n---\n`), /evaluation PRD does not match/],
  ['short commit metadata', f => f.put('NOTES.md', `---\nprd: ${prd}\ncandidate: abc\nbase: ${f.base}\nevidence: ${f.manifest}\n---\n`), /full 40-hex/],
  ['missing manifest metadata', f => f.put('NOTES.md', `---\nprd: ${prd}\ncandidate: ${f.candidate}\nbase: ${f.base}\n---\n`), /without evidence manifest/],
  ['unavailable ancestry metadata', f => f.put('NOTES.md', `---\nprd: ${prd}\ncandidate: ${f.candidate}\nbase: ${'f'.repeat(40)}\nevidence: ${f.manifest}\n---\n`), /ancestry unavailable/],
]) test(`characterization: legacy Notes rejects ${name}`, t => {
  const f = fixture(t, 'legacy'); mutate(f); rejected(f, pattern);
});

test('changes mode: valid locator evidence commit keeps Notes, Evaluation and Evidence current', t => {
  const f = fixture(t);
  const report = f.report();
  assert.match(report.text, /^Notes    NOTES\.md: current \(.*\) \(compatibility summary; the evaluation locator decides\)$/m);
  assert.match(report.text, /^Evaluation .*: current \(/m);
  assert.match(report.text, /^Evidence .* · ok$/m);
  assert.equal(f.ready().status, 0);
  assert.equal(f.git('status', '--porcelain', '--untracked-files=all'), '');
});

test('changes mode: another structurally valid locator follows the same existing policy', t => {
  const f = fixture(t);
  f.json(locator.file('other'), { schema: 1, change: 'other', evaluations: [] });
  f.commit();
  assert.equal(status.notesCurrent(f.root, prd, { changesMode: true }).state, 'current');
  assert.match(f.report().text, /^Notes    NOTES\.md: current /m);
  assert.equal(f.ready().status, 0);
});

test('changes mode: dirty Notes cannot satisfy the separate clean-tree release condition', t => {
  const f = fixture(t);
  f.put('NOTES.md', `${readFileSync(join(f.root, 'NOTES.md'), 'utf8')}Uncommitted handover edit.\n`);
  assert.equal(f.report().json.candidate.notes, 'current');
  assert.equal(f.ready().status, 0); // Readiness permits evidence followers; release also requires a clean tree.
  assert.notEqual(f.git('status', '--porcelain', '--untracked-files=all'), '');
});
