import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { checkFeasibility, main, wilson } from '../check-pre-scan-evidence.mjs';

// Synthetic fixtures test gate behavior only. They are never native/device evidence.
const labels = ['real', 'screen', 'printed_photo'];
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'leafcheck-evidence-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  function put(name, bytes) {
    writeFileSync(join(root, name), bytes);
    return { path: name, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  const manifest = {
    schema: 1, phase: 'feasibility', status: 'collected',
    model: { id: 'synthetic-test-only', source: 'test fixture', licenseId: 'test-only',
      preprocessing: 'test-only', exportProcedure: 'test-only', threshold: 0.9, classes: labels,
      license: put('license.txt', 'synthetic license fixture'),
      redistributionEvidence: put('redistribution.txt', 'synthetic permission fixture'),
      exports: { android: put('model.android', 'synthetic android weights'), ios: put('model.ios', 'synthetic ios weights') } },
    split: { subjects: ['training-subject'], sources: ['training-source'], sessions: ['calibration-session'] },
    samples: labels.flatMap(label => Array.from({ length: 100 }, (_, i) => ({
      id: `${label}-${i}`, label, subject: `${label}-subject-${i}`, source: `${label}-source-${i}`,
      session: `${label}-session-${i}`, image: put(`${label}-${i}.jpg`, `synthetic image ${label}-${i}`),
      width: 640, height: 480, jpegQuality: 0.25, rotation: 0,
      conditions: label === 'real' ? ['nearby_screen'] : ['borderless', 'glare', 'angled', 'varied_lighting'],
    }))),
    devices: [],
  };
  const outputs = {};
  for (const platform of ['android', 'ios']) {
    const device = { platform, physical: true, midRange: platform === 'android', id: `synthetic-${platform}`,
      os: 'synthetic', build: 'synthetic-build', sourceRevision: 'synthetic-revision', runtimeVersion: 'test-only',
      minimumOs: 'test-only', qualityVersion: 'test-only', nitroVersion: 'test-only', expoVersion: 'test-only',
      reactNativeVersion: 'test-only', coldInitializationMs: 300,
      buildLog: put(`${platform}.log`, 'synthetic build log') };
    const output = { schema: 1, platform, device: device.id, build: device.build, model: manifest.model.id,
      modelSha256: manifest.model.exports[platform].sha256, sourceRevision: device.sourceRevision,
      clock: 'monotonic', qualityExecuted: true,
      predictions: manifest.samples.map(sample => ({ sample: sample.id, predicted: sample.label,
        scores: Object.fromEntries(labels.map(label => [label, label === sample.label ? 0.98 : 0.01])) })),
      runs: ['ready', 'resumed'].flatMap((session, j) => Array.from({ length: 100 }, (_, i) => ({
        id: `${session}-${i}`, session, first: i === 0, sample: manifest.samples[i * 3].id,
        startMs: j * 50000 + i * 300, endMs: j * 50000 + i * 300 + 100,
        stages: { dispatch: 5, read_decode: 20, quality: 10, preprocess: 10, inference: 40, js_return: 5 },
      }))),
    };
    outputs[platform] = output;
    device.output = put(`${platform}.json`, JSON.stringify(output));
    manifest.devices.push(device);
  }
  function save(platform = 'android') {
    manifest.devices.find(device => device.platform === platform).output = put(`${platform}.json`, JSON.stringify(outputs[platform]));
  }
  return { root, manifest, outputs, save, put };
}

test('recomputes confusion matrices, Wilson intervals and end-to-end percentiles', t => {
  const f = fixture(t);
  const result = checkFeasibility(f.manifest, f.root);
  assert.equal(result.status, 'metrics_passed_review_required');
  assert.equal(result.reports.android.accuracy.matrix.screen.screen, 100);
  assert.equal(result.reports.ios.accuracy.rates.real.rate, 0);
  assert.ok(result.reports.android.accuracy.rates.screen.interval95[0] > 0.96);
  assert.deepEqual(result.reports.ios.timings.resumed, { count: 100, p50: 100, p95: 100, p99: 100, max: 100 });
});

const manifestFailures = [
  ['unverified evidence', f => { f.manifest.status = 'unverified'; }, /EVIDENCE_UNVERIFIED/],
  ['missing model', f => { delete f.manifest.model; }, /MODEL_CONTRACT_INVALID/],
  ['missing model license', f => { delete f.manifest.model.license; }, /ARTIFACT_INVALID/],
  ['missing export file', f => { f.manifest.model.exports.ios.path = 'absent'; }, /ARTIFACT_UNAVAILABLE/],
  ['wrong artifact hash', f => { f.manifest.samples[0].image.sha256 = '0'.repeat(64); }, /ARTIFACT_HASH_MISMATCH/],
  ['invalid truth label', f => { f.manifest.samples[0].label = 'plant'; }, /SAMPLE_INVALID/],
  ['duplicate sample ID', f => { f.manifest.samples[1].id = f.manifest.samples[0].id; }, /SAMPLE_INVALID/],
  ['duplicate image', f => { f.manifest.samples[1].image = f.manifest.samples[0].image; }, /SAMPLE_DUPLICATE_IMAGE/],
  ['correlated duplicate identity', f => {
    for (const key of ['subject', 'source', 'session']) f.manifest.samples[1][key] = f.manifest.samples[0][key];
  }, /SAMPLE_NOT_INDEPENDENT/],
  ...['subject', 'source', 'session'].map((field, i) => [`${field} split leakage`, f => {
    f.manifest.samples[0][field] = Object.values(f.manifest.split)[i][0];
  }, /SPLIT_LEAKAGE/]),
  ['missing capture condition', f => {
    f.manifest.samples.filter(s => s.label === 'screen').forEach(s => { s.conditions = ['glare']; });
  }, /SAMPLE_CONDITION_MISSING/],
  ['wrong compression', f => { f.manifest.samples[0].jpegQuality = 1; }, /SAMPLE_CAPTURE_INVALID/],
  ['missing physical device', f => { f.manifest.devices[0].physical = false; }, /DEVICE_INVALID/],
  ['duplicate platform', f => { f.manifest.devices[1].platform = 'android'; }, /DEVICE_INVALID/],
  ['non-mid-range Android', f => { f.manifest.devices[0].midRange = false; }, /DEVICE_NOT_MID_RANGE/],
  ['path traversal', f => { f.manifest.samples[0].image.path = '../outside'; }, /ARTIFACT_PATH_INVALID/],
];
for (const [name, mutate, error] of manifestFailures) test(`rejects ${name}`, t => {
  const f = fixture(t); mutate(f);
  assert.throws(() => checkFeasibility(f.manifest, f.root), error);
});

const outputFailures = [
  ['wrong model identity', o => { o.modelSha256 = '0'.repeat(64); }, /EXPORT_IDENTITY_MISMATCH/],
  ['wrong build identity', o => { o.build = 'different'; }, /EXPORT_IDENTITY_MISMATCH/],
  ['missing quality execution', o => { o.qualityExecuted = false; }, /EXPORT_IDENTITY_MISMATCH/],
  ['wall clock', o => { o.clock = 'wall'; }, /EXPORT_IDENTITY_MISMATCH/],
  ['nonfinite scores', o => { o.predictions[0].scores.real = null; }, /PREDICTION_SCORES_INVALID/],
  ['unknown class scores', o => { o.predictions[0].scores.other = 0; }, /PREDICTION_SCORES_INVALID/],
  ['unnormalized scores', o => { o.predictions[0].scores.real = 0.5; }, /PREDICTION_SCORES_INVALID/],
  ['missing predictions', o => { o.predictions.pop(); }, /PREDICTIONS_INCOMPLETE/],
  ['duplicate prediction', o => { o.predictions[1].sample = o.predictions[0].sample; }, /PREDICTION_SAMPLE_INVALID/],
  ['forged policy output', o => { o.predictions[0].predicted = 'screen'; }, /PREDICTION_POLICY_MISMATCH/],
  ['uncertain reproductions counted as successes', o => {
    o.predictions.filter(p => p.sample.startsWith('screen')).slice(0, 6).forEach(p => {
      p.scores = { real: 0.1, screen: 0.8, printed_photo: 0.1 }; p.predicted = 'real';
    });
  }, /ACCURACY_GATE_FAILED/],
  ['printed-photo recall failure', o => {
    o.predictions.filter(p => p.sample.startsWith('printed_photo')).slice(0, 6).forEach(p => {
      p.scores = { real: 0.98, screen: 0.01, printed_photo: 0.01 }; p.predicted = 'real';
    });
  }, /ACCURACY_GATE_FAILED/],
  ['excess real-plant rejection', o => {
    o.predictions.slice(0, 6).forEach(p => { p.scores = { real: 0.01, screen: 0.98, printed_photo: 0.01 }; p.predicted = 'screen'; });
  }, /ACCURACY_GATE_FAILED/],
  ['one slow run despite fast percentiles', o => { o.runs[90].endMs = o.runs[90].startMs + 200; }, /LATENCY_GATE_FAILED/],
  ['invalid clock order', o => { o.runs[0].endMs = o.runs[0].startMs; }, /TIMING_CLOCK_INVALID/],
  ['omitted native processing stage', o => { delete o.runs[0].stages.read_decode; }, /TIMING_STAGES_INVALID/],
  ['timing excludes declared stages', o => { o.runs[0].stages.inference = 500; }, /TIMING_STAGES_INVALID/],
  ['no resume timings', o => { o.runs = o.runs.filter(r => r.session === 'ready'); }, /TIMING_COVERAGE_INSUFFICIENT/],
  ['missing first run', o => { o.runs[0].first = false; }, /TIMING_COVERAGE_INSUFFICIENT/],
  ['insufficient timing count', o => { o.runs.pop(); }, /TIMING_COVERAGE_INSUFFICIENT/],
  ['duplicate run', o => { o.runs[1].id = o.runs[0].id; }, /TIMING_RUN_INVALID/],
  ['overlapping jobs', o => { o.runs[1].startMs = 50; o.runs[1].endMs = 150; }, /TIMING_COVERAGE_INSUFFICIENT/],
  ['altered aggregate', o => { o.summary = { passed: true }; }, /AGGREGATE_MISMATCH/],
];
for (const [name, mutate, error] of outputFailures) test(`rejects ${name}`, t => {
  const f = fixture(t); mutate(f.outputs.android); f.save();
  assert.throws(() => checkFeasibility(f.manifest, f.root), error);
});

test('rejects fewer than 100 independent captures in any class', t => {
  const f = fixture(t);
  const removed = f.manifest.samples.pop().id;
  for (const platform of ['android', 'ios']) {
    f.outputs[platform].predictions = f.outputs[platform].predictions.filter(p => p.sample !== removed);
    f.save(platform);
  }
  assert.throws(() => checkFeasibility(f.manifest, f.root), /CLASS_COUNT_INSUFFICIENT/);
});

test('artifact symlinks cannot escape the evidence directory', t => {
  const f = fixture(t);
  const outside = mkdtempSync(join(tmpdir(), 'leafcheck-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, 'secret.txt'), 'do not expose');
  symlinkSync(join(outside, 'secret.txt'), join(f.root, 'link'));
  f.manifest.model.license.path = 'link';
  assert.throws(() => checkFeasibility(f.manifest, f.root), /ARTIFACT_PATH_INVALID/);
});

test('CLI rejects missing, malformed and unsupported-phase manifests without diagnostics leakage', t => {
  const f = fixture(t);
  assert.throws(() => main(['--phase', 'final', '--input', 'missing']), /CLI_USAGE_INVALID/);
  const input = join(f.root, 'manifest.json');
  writeFileSync(input, '{ sensitive local input');
  const result = spawnSync(process.execPath, ['scripts/check-pre-scan-evidence.mjs', '--phase', 'feasibility', '--input', input], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.trim(), 'pre-scan evidence: MANIFEST_UNAVAILABLE_OR_INVALID');
  assert.ok(!result.stderr.includes(f.root));
  writeFileSync(input, JSON.stringify(f.manifest));
  assert.equal(main(['--phase', 'feasibility', '--input', input]).status, 'metrics_passed_review_required');
  assert.ok(readFileSync(input, 'utf8').includes('synthetic-test-only'));
});

test('Wilson intervals report uncertainty at both extremes', () => {
  const zero = wilson(0, 100);
  const all = wilson(100, 100);
  assert.ok(Math.abs(zero[0]) < 1e-12 && zero[1] > 0.03);
  assert.ok(all[0] < 0.97 && Math.abs(all[1] - 1) < 1e-12);
  assert.throws(() => wilson(0, 0), /INTERVAL_INPUT_INVALID/);
});
