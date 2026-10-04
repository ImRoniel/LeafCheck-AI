import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const CLASSES = ['real', 'screen', 'printed_photo'];
const CONDITIONS = ['borderless', 'glare', 'angled', 'varied_lighting', 'nearby_screen'];
const STAGES = ['dispatch', 'read_decode', 'quality', 'preprocess', 'inference', 'js_return'];
const fail = (code) => { throw new Error(code); };
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const requireThat = (condition, code) => { if (!condition) fail(code); };

// Evidence is local and read-only. Never print image contents, raw paths or native logs.
function artifact(root, ref) {
  requireThat(object(ref) && text(ref.path) && /^[a-f0-9]{64}$/.test(ref.sha256), 'ARTIFACT_INVALID');
  requireThat(!isAbsolute(ref.path) && !ref.path.split(/[\\/]/).includes('..'), 'ARTIFACT_PATH_INVALID');
  let bytes;
  try {
    const file = realpathSync(resolve(root, ref.path));
    const rel = relative(root, file);
    requireThat(rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel), 'ARTIFACT_PATH_INVALID');
    requireThat(statSync(file).isFile() && statSync(file).size <= 64 * 1024 * 1024, 'ARTIFACT_INVALID');
    bytes = readFileSync(file);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('ARTIFACT_')) throw error;
    fail('ARTIFACT_UNAVAILABLE');
  }
  requireThat(bytes.length > 0 && digest(bytes) === ref.sha256, 'ARTIFACT_HASH_MISMATCH');
  return bytes;
}

function jsonArtifact(root, ref) {
  const bytes = artifact(root, ref);
  try { return JSON.parse(bytes.toString('utf8')); } catch { fail('ARTIFACT_JSON_INVALID'); }
}

function unique(values, code) {
  requireThat(Array.isArray(values) && values.every(text) && new Set(values).size === values.length, code);
  return new Set(values);
}

export function wilson(successes, count) {
  requireThat(Number.isInteger(count) && count > 0 && Number.isInteger(successes)
    && successes >= 0 && successes <= count, 'INTERVAL_INPUT_INVALID');
  const z = 1.959963984540054;
  const p = successes / count;
  const denominator = 1 + z * z / count;
  const center = (p + z * z / (2 * count)) / denominator;
  const margin = z * Math.sqrt(p * (1 - p) / count + z * z / (4 * count * count)) / denominator;
  return [center - margin, center + margin];
}

function accuracy(predictions, samples, threshold) {
  requireThat(Array.isArray(predictions) && predictions.length === samples.size, 'PREDICTIONS_INCOMPLETE');
  const matrix = Object.fromEntries(CLASSES.map(label => [label,
    Object.fromEntries(CLASSES.map(predicted => [predicted, 0]))]));
  const seen = new Set();
  for (const row of predictions) {
    requireThat(object(row) && samples.has(row.sample) && !seen.has(row.sample), 'PREDICTION_SAMPLE_INVALID');
    seen.add(row.sample);
    requireThat(object(row.scores) && Object.keys(row.scores).length === CLASSES.length
      && CLASSES.every(label => finite(row.scores[label]) && row.scores[label] >= 0 && row.scores[label] <= 1), 'PREDICTION_SCORES_INVALID');
    requireThat(Math.abs(CLASSES.reduce((sum, label) => sum + row.scores[label], 0) - 1) < 1e-5, 'PREDICTION_SCORES_INVALID');
    const top = CLASSES.reduce((best, label) => row.scores[label] > row.scores[best] ? label : best, 'real');
    // Uncertain semantic results pass, so they count as misses on reproduction samples.
    const predicted = top !== 'real' && row.scores[top] >= threshold ? top : 'real';
    requireThat(row.predicted === predicted, 'PREDICTION_POLICY_MISMATCH');
    matrix[samples.get(row.sample).label][predicted] += 1;
  }
  const rates = Object.fromEntries(CLASSES.map(label => {
    const count = Object.values(matrix[label]).reduce((a, b) => a + b, 0);
    const successes = label === 'real' ? count - matrix.real.real : matrix[label][label];
    requireThat(count >= 100, 'CLASS_COUNT_INSUFFICIENT');
    return [label, { count, rate: successes / count, interval95: wilson(successes, count) }];
  }));
  requireThat(rates.screen.rate >= 0.95 && rates.printed_photo.rate >= 0.95
    && rates.real.rate <= 0.05, 'ACCURACY_GATE_FAILED');
  return { matrix, rates };
}

function timings(runs, samples) {
  requireThat(Array.isArray(runs), 'TIMINGS_INVALID');
  const ids = new Set();
  for (const run of runs) {
    requireThat(object(run) && text(run.id) && !ids.has(run.id) && samples.has(run.sample)
      && ['ready', 'resumed'].includes(run.session) && typeof run.first === 'boolean', 'TIMING_RUN_INVALID');
    ids.add(run.id);
    requireThat(finite(run.startMs) && run.startMs >= 0 && finite(run.endMs)
      && run.endMs > run.startMs, 'TIMING_CLOCK_INVALID');
    const duration = run.endMs - run.startMs;
    requireThat(duration < 200, 'LATENCY_GATE_FAILED');
    requireThat(object(run.stages) && STAGES.every(stage => finite(run.stages[stage])
      && run.stages[stage] >= 0) && Object.keys(run.stages).length === STAGES.length, 'TIMING_STAGES_INVALID');
    requireThat(STAGES.reduce((sum, stage) => sum + run.stages[stage], 0) <= duration + 0.001, 'TIMING_STAGES_INVALID');
  }
  const summary = {};
  for (const session of ['ready', 'resumed']) {
    const rows = runs.filter(row => row.session === session);
    requireThat(rows.length >= 100 && rows.filter(row => row.first).length === 1
      && rows[0].first && rows.every((row, i) => i === 0 || row.startMs >= rows[i - 1].endMs), 'TIMING_COVERAGE_INSUFFICIENT');
    requireThat(CLASSES.every(label => rows.some(row => samples.get(row.sample).label === label)), 'TIMING_CLASS_COVERAGE');
    const values = rows.map(row => row.endMs - row.startMs).sort((a, b) => a - b);
    const percentile = p => values[Math.ceil(values.length * p) - 1];
    summary[session] = { count: values.length, p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99), max: values.at(-1) };
  }
  return summary;
}

/** Integrity/metric check only: it cannot authenticate who collected native evidence. */
export function checkFeasibility(manifest, evidenceRoot) {
  requireThat(object(manifest) && manifest.schema === 1 && manifest.phase === 'feasibility', 'MANIFEST_INVALID');
  requireThat(manifest.status === 'collected', 'EVIDENCE_UNVERIFIED');
  const root = realpathSync(evidenceRoot);
  const model = manifest.model;
  requireThat(object(model) && text(model.id) && text(model.source) && text(model.licenseId)
    && text(model.preprocessing) && text(model.exportProcedure) && finite(model.threshold)
    && model.threshold > 0.5 && model.threshold <= 1
    && Array.isArray(model.classes) && JSON.stringify(model.classes) === JSON.stringify(CLASSES), 'MODEL_CONTRACT_INVALID');
  artifact(root, model.license);
  artifact(root, model.redistributionEvidence);
  for (const platform of ['android', 'ios']) artifact(root, model.exports?.[platform]);
  const split = manifest.split;
  requireThat(object(split), 'SPLIT_INVALID');
  const excluded = {};
  for (const key of ['subjects', 'sources', 'sessions']) excluded[key] = unique(split[key], 'SPLIT_INVALID');
  requireThat(Array.isArray(manifest.samples), 'SAMPLES_INVALID');
  const samples = new Map();
  const hashes = new Set();
  const identities = new Set();
  const coverage = new Set();
  for (const sample of manifest.samples) {
    requireThat(object(sample) && text(sample.id) && !samples.has(sample.id)
      && CLASSES.includes(sample.label), 'SAMPLE_INVALID');
    for (const [field, splitKey] of [['subject', 'subjects'], ['source', 'sources'], ['session', 'sessions']]) {
      requireThat(text(sample[field]) && !excluded[splitKey].has(sample[field]), 'SPLIT_LEAKAGE');
    }
    const identity = JSON.stringify([sample.subject, sample.source, sample.session]);
    requireThat(!identities.has(identity), 'SAMPLE_NOT_INDEPENDENT');
    identities.add(identity);
    artifact(root, sample.image);
    requireThat(!hashes.has(sample.image.sha256), 'SAMPLE_DUPLICATE_IMAGE');
    hashes.add(sample.image.sha256);
    requireThat(Number.isInteger(sample.width) && sample.width > 0 && Number.isInteger(sample.height)
      && sample.height > 0 && sample.jpegQuality === 0.25 && [0, 90, 180, 270].includes(sample.rotation), 'SAMPLE_CAPTURE_INVALID');
    requireThat(Array.isArray(sample.conditions) && sample.conditions.every(condition => CONDITIONS.includes(condition)), 'SAMPLE_CONDITION_INVALID');
    sample.conditions.forEach(condition => coverage.add(`${sample.label}:${condition}`));
    samples.set(sample.id, sample);
  }
  for (const label of ['screen', 'printed_photo']) {
    requireThat(CONDITIONS.filter(condition => condition !== 'nearby_screen')
      .every(condition => coverage.has(`${label}:${condition}`)), 'SAMPLE_CONDITION_MISSING');
  }
  requireThat(coverage.has('real:nearby_screen'), 'SAMPLE_CONDITION_MISSING');
  requireThat(Array.isArray(manifest.devices) && manifest.devices.length === 2, 'DEVICES_INVALID');
  const platforms = new Set();
  const reports = {};
  for (const device of manifest.devices) {
    requireThat(object(device) && ['android', 'ios'].includes(device.platform) && !platforms.has(device.platform)
      && device.physical === true && text(device.id) && text(device.os) && text(device.build)
      && text(device.sourceRevision) && text(device.runtimeVersion) && text(device.minimumOs)
      && text(device.qualityVersion) && text(device.nitroVersion) && text(device.expoVersion)
      && text(device.reactNativeVersion) && finite(device.coldInitializationMs)
      && device.coldInitializationMs >= 0, 'DEVICE_INVALID');
    requireThat(device.platform !== 'android' || device.midRange === true, 'DEVICE_NOT_MID_RANGE');
    platforms.add(device.platform);
    artifact(root, device.buildLog);
    const output = jsonArtifact(root, device.output);
    requireThat(object(output) && output.schema === 1 && output.platform === device.platform
      && output.device === device.id && output.build === device.build && output.model === model.id
      && output.modelSha256 === model.exports[device.platform].sha256
      && output.sourceRevision === device.sourceRevision && output.clock === 'monotonic'
      && output.qualityExecuted === true, 'EXPORT_IDENTITY_MISMATCH');
    const report = { accuracy: accuracy(output.predictions, samples, model.threshold), timings: timings(output.runs, samples) };
    // Aggregates are redundant and must agree when supplied, never used as evidence.
    if (output.summary !== undefined) requireThat(JSON.stringify(output.summary) === JSON.stringify(report), 'AGGREGATE_MISMATCH');
    reports[device.platform] = report;
  }
  return { status: 'metrics_passed_review_required', phase: 'feasibility', model: model.id, reports };
}

export function main(args) {
  requireThat(args.length === 4 && args[0] === '--phase' && args[1] === 'feasibility'
    && args[2] === '--input' && text(args[3]), 'CLI_USAGE_INVALID');
  let manifest;
  try { manifest = JSON.parse(readFileSync(args[3], 'utf8')); } catch { fail('MANIFEST_UNAVAILABLE_OR_INVALID'); }
  return checkFeasibility(manifest, dirname(resolve(args[3])));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(main(process.argv.slice(2)), null, 2)); }
  catch (error) {
    const message = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'EVIDENCE_CHECK_FAILED';
    console.error(`pre-scan evidence: ${message}`);
    process.exitCode = 1;
  }
}
