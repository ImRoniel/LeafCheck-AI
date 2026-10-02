'use strict';
// PINCER runtime — candidate evidence (docs/runtime-contracts.md, "Evidence
// schema 2"). Schema 1 validation lives here unchanged from v0.4.1 so status,
// release and the pincer-evidence.cjs entry point share one implementation.
//
// What validation establishes: that the locally authored record is internally
// consistent — schema, references, candidate association, required results,
// artifact existence and digests, repository containment. It is NOT independent
// attestation that the recorded commands ran or that images depict the stated
// application; that judgment stays with the reviewer.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { validateAttempt, contextKey } = require('./state.cjs');
const requirements = require('./requirements.cjs');
const coverage = require('./coverage.cjs');
const { tryGit } = require('./fsutil.cjs');

const SCHEMA = 1;
const HEX40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const PRD_REF = /^\.prd\/prd-v([1-9][0-9]{0,8})\.md$/;
const MANIFEST_AT = /^\.prd\/evidence\/prd-v([1-9][0-9]{0,8})\/([0-9a-f]{40})\/manifest\.json$/;
// Requirement IDs are the PRD's own: R-01 from the template, or a supplied PRD's
// REQ-1 / AC-12 style, kept verbatim rather than renamed.
const REQ_ID = /^[A-Z][A-Z0-9]{0,7}-[0-9]{1,6}$/;
const TICKET_ID = /^T-[0-9]{2,6}$/;
const CHECK_ID = /^C-[0-9]{2,6}$/;
const IMAGE = /\.(png|jpe?g|webp)$/i;
const MAX_TEXT = 2000; // guard against pasted environment dumps
const TOP_KEYS = ['schema', 'prd', 'base', 'candidate', 'created', 'environment', 'coverage_review', 'requirements', 'checks', 'visual_review', 'artifacts'];
const ENV_KEYS = ['os', 'node', 'tools', 'limitations'];
const REQ_KEYS = ['id', 'disposition', 'tickets', 'checks', 'note', 'authorized_by'];
const CHECK_KEYS = ['id', 'kind', 'required', 'result', 'command', 'timestamp', 'artifacts', 'scenario', 'viewport', 'observed', 'note'];
const DISPOSITIONS = ['delivered', 'blocked', 'deferred'];
const KINDS = ['command', 'visual', 'review'];
const RESULTS = ['passed', 'failed', 'unverified'];
// Schema 2 (docs/runtime-contracts.md, "Evidence schema 2"): a change binding,
// provenance per check, and attempt provenance on runtime command checks.
// Schema 3 (docs/runtime-contracts.md, "Evidence schema 3"): the complete reconciled
// coverage of the candidate — inventory and map snapshots, scenario rows, derived
// dispositions, the adequacy judgment and the delivery summary.
const SCHEMAS = [1, 2, 3];
const TOP_KEYS_2 = [...TOP_KEYS, 'change'];
const TOP_KEYS_3 = [...TOP_KEYS_2, 'coverage', 'scenarios', 'adequacy', 'delivery'];
const REQ_KEYS_3 = ['id', 'disposition', 'tickets', 'checks', 'scenarios', 'decision', 'authorization', 'note'];
const SCENARIO_KEYS = ['id', 'requirement', 'disposition', 'tickets', 'checks', 'decision', 'authorization', 'note'];
const DISPOSITIONS_3 = ['delivered', 'deferred', 'removed', 'blocked'];
const COVERAGE_KEYS = ['agreement', 'authorization', 'inventory', 'map', 'snapshots'];
const ADEQUACY = ['adequate', 'inadequate'];
const CHECK_KEYS_2 = [...CHECK_KEYS, 'provenance', 'attempt'];
const CHECK_KEYS_3 = [...CHECK_KEYS_2, 'declared'];
const PROVENANCE = ['runtime', 'authored'];
const ATTEMPT_KEYS = ['id', 'sequence', 'outcome', 'exit_code', 'started', 'finished', 'source_before', 'source_after', 'check_digest', 'runner', 'cwd', 'log_sha256', 'truncated'];
const OUTCOMES = ['passed', 'failed', 'timed_out', 'interrupted', 'error'];
const CHANGE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const resultFor = outcome => (outcome === 'passed' ? 'passed' : outcome === 'error' ? 'unverified' : 'failed');

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const shortText = v => typeof v === 'string' && v.length <= MAX_TEXT;
const nonempty = v => shortText(v) && v.trim() !== '';
const toPosix = p => p.split(path.sep).join('/');

function repoRoot() {
  if (process.env.CLAUDE_PROJECT_DIR) return path.resolve(process.env.CLAUDE_PROJECT_DIR);
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return process.cwd();
  }
}

// Resolve through symlinks above the repository (macOS /var -> /private/var)
// without requiring the leaf to exist yet.
function realpathDeep(p) {
  try { return fs.realpathSync(p); } catch {
    const parent = path.dirname(p);
    return parent === p ? p : path.join(realpathDeep(parent), path.basename(p));
  }
}

function digestFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// Why a repository-relative path is unsafe, or null when it is acceptable.
function unsafePath(p) {
  if (p.startsWith('/')) return 'absolute paths are not allowed';
  if (/^[A-Za-z]:/.test(p)) return 'drive-letter paths are not allowed';
  if (p.includes('\\')) return 'backslashes are not allowed; use repository-relative POSIX paths';
  if (p.split('/').some(s => s === '' || s === '.' || s === '..')) return 'path must be normalized and repository-relative (no "..", "." or empty segments)';
  return null;
}

function validate(manifestArg, opts, rootArg) {
  const root = realpathDeep(rootArg || repoRoot());
  const abs = realpathDeep(path.resolve(manifestArg));
  const rel = toPosix(path.relative(root, abs));
  const at = rel.match(MANIFEST_AT);
  if (!at) return [`manifest must live at .prd/evidence/prd-vN/<candidate>/manifest.json inside the repository (got ${rel})`];
  const [, dirVersion, dirCandidate] = at;
  const dirRel = path.posix.dirname(rel);

  let raw;
  try { raw = fs.readFileSync(abs, 'utf8'); } catch { return ['missing — run /pincer-evaluate to write evidence for this candidate']; }
  let doc;
  try { doc = JSON.parse(raw); } catch (error) { return [`malformed JSON (${error.message})`]; }
  if (!isObject(doc)) return ['malformed: the manifest must be a JSON object'];
  if (!SCHEMAS.includes(doc.schema)) return [`unknown evidence schema ${JSON.stringify(doc.schema)} — this runtime validates schemas ${SCHEMAS.slice(0, -1).join(', ')} and ${SCHEMAS.at(-1)}`];
  const schema2 = doc.schema >= 2;
  const schema3 = doc.schema === 3;
  const topKeys = schema3 ? TOP_KEYS_3 : schema2 ? TOP_KEYS_2 : TOP_KEYS;
  const checkKeys = schema3 ? CHECK_KEYS_3 : schema2 ? CHECK_KEYS_2 : CHECK_KEYS;
  const reqKeys = schema3 ? REQ_KEYS_3 : REQ_KEYS;
  const dispositions = schema3 ? DISPOSITIONS_3 : DISPOSITIONS;
  opts.limitations = [];

  const problems = [];
  const problem = message => problems.push(message);
  for (const key of Object.keys(doc)) if (!topKeys.includes(key)) problem(`unknown top-level key "${key}"`);
  for (const key of topKeys) if (!(key in doc)) problem(`missing "${key}"`);
  if (schema2) {
    const change = doc.change;
    if (!isObject(change)) problem('change must be an object {id, prd_revision, base}');
    else {
      for (const key of Object.keys(change)) if (!['id', 'prd_revision', 'base'].includes(key)) problem(`change.${key} is not allowed`);
      if (typeof change.id !== 'string' || !CHANGE_ID.test(change.id)) problem('change.id must be a change ID ([a-z0-9][a-z0-9-]{0,63})');
      if (typeof change.prd_revision !== 'string' || !SHA256.test(change.prd_revision)) problem('change.prd_revision must be a 64-hex SHA-256 digest');
      if (typeof change.base !== 'string' || !HEX40.test(change.base)) problem('change.base must be a full 40-hex commit ID');
    }
  }

  const prd = typeof doc.prd === 'string' ? doc.prd.match(PRD_REF) : null;
  if (!prd) problem('prd must be a reference of the form .prd/prd-vN.md');
  else if (prd[1] !== dirVersion) problem(`wrong PRD: manifest names ${doc.prd} but lives under prd-v${dirVersion}`);
  if (opts.prd && doc.prd !== opts.prd) problem(`wrong PRD: manifest is for ${doc.prd}, expected ${opts.prd}`);

  for (const key of ['base', 'candidate']) {
    if (typeof doc[key] !== 'string' || !HEX40.test(doc[key])) problem(`${key} must be a full 40-hex commit ID`);
  }
  if (typeof doc.candidate === 'string' && HEX40.test(doc.candidate) && doc.candidate !== dirCandidate) {
    problem(`wrong candidate: manifest names ${doc.candidate} but lives under ${dirCandidate}`);
  }
  if (opts.candidate && doc.candidate !== opts.candidate) problem(`wrong candidate: manifest is for ${doc.candidate}, expected ${opts.candidate}`);
  if (opts.base && doc.base !== opts.base) problem(`wrong base: manifest records ${doc.base}, expected ${opts.base}`);
  if (typeof doc.created !== 'string' || !ISO_UTC.test(doc.created)) problem('created must be an ISO-8601 UTC timestamp (YYYY-MM-DDTHH:MM:SSZ)');

  const env = doc.environment;
  if (!isObject(env)) problem('environment must be an object with os, node, tools and limitations');
  else {
    for (const key of ['os', 'node']) if (!nonempty(env[key])) problem(`environment.${key} must be a short nonempty string (redacted summary, not a dump)`);
    for (const key of ['tools', 'limitations']) {
      if (!Array.isArray(env[key]) || !env[key].every(nonempty)) problem(`environment.${key} must be an array of short strings`);
    }
    for (const key of Object.keys(env)) if (!ENV_KEYS.includes(key)) problem(`environment.${key} is not allowed — persist redacted summaries only`);
  }
  if (!nonempty(doc.coverage_review)) problem('coverage_review must be a nonempty string recording the reviewer judgment on requirement coverage');

  // Artifacts: repository-contained regular files with matching digests.
  const artifacts = new Map();
  if (!Array.isArray(doc.artifacts)) problem('artifacts must be an array of {path, sha256}');
  else doc.artifacts.forEach((entry, index) => {
    const label = `artifacts[${index}]`;
    if (!isObject(entry)) { problem(`${label} must be an object {path, sha256}`); return; }
    for (const key of Object.keys(entry)) if (!['path', 'sha256'].includes(key)) problem(`${label}.${key} is not allowed`);
    const p = entry.path;
    if (typeof p !== 'string' || p === '') { problem(`${label}.path must be a nonempty string`); return; }
    if (artifacts.has(p)) problem(`duplicate artifact path ${p}`);
    artifacts.set(p, false);
    const why = unsafePath(p);
    if (why) { problem(`artifact ${p}: ${why}`); return; }
    if (!p.startsWith(`${dirRel}/`)) { problem(`artifact ${p}: outside the evidence directory ${dirRel}/`); return; }
    const digestOk = typeof entry.sha256 === 'string' && SHA256.test(entry.sha256);
    if (!digestOk) problem(`artifact ${p}: sha256 must be a full 64-hex digest`);
    const segments = p.split('/');
    let current = root;
    for (let i = 0; i < segments.length; i++) {
      current = path.join(current, segments[i]);
      let stat;
      try { stat = fs.lstatSync(current); } catch { problem(`artifact ${p}: missing`); return; }
      const last = i === segments.length - 1;
      if (stat.isSymbolicLink()) {
        problem(last ? `artifact ${p}: is a symlink (only regular files inside the repository are accepted)` : `artifact ${p}: path component ${segments.slice(0, i + 1).join('/')} is a symlink`);
        return;
      }
      if (!last && !stat.isDirectory()) { problem(`artifact ${p}: ${segments.slice(0, i + 1).join('/')} is not a directory`); return; }
      if (last && !stat.isFile()) { problem(`artifact ${p}: not a regular file`); return; }
    }
    if (digestOk && digestFile(current) !== entry.sha256) problem(`artifact ${p}: digest mismatch — the file changed after the evidence was recorded`);
  });

  // Checks: what was run or judged, with results and artifact references.
  const checks = new Map();
  let visualChecks = 0;
  if (!Array.isArray(doc.checks)) problem('checks must be an array');
  else doc.checks.forEach((check, index) => {
    const label = `checks[${index}]`;
    if (!isObject(check)) { problem(`${label} must be an object`); return; }
    const id = typeof check.id === 'string' && CHECK_ID.test(check.id) ? check.id : null;
    if (!id) problem(`${label}.id must be a check ID such as C-01`);
    else if (checks.has(id)) problem(`duplicate check ID ${id}`);
    else checks.set(id, check);
    const name = id || label;
    for (const key of Object.keys(check)) if (!checkKeys.includes(key)) problem(`check ${name}: unknown key "${key}"`);
    if (!KINDS.includes(check.kind)) problem(`check ${name}: kind must be one of ${KINDS.join(', ')}`);
    if (schema2) validateProvenance(check, name, doc, problem);
    if (schema3 && !(typeof check.declared === 'string' && SHA256.test(check.declared))) problem(`check ${name}: declared must be the 64-hex definition digest from the coverage map`);
    if (schema3 && (check.kind === 'review' || check.kind === 'visual') && Array.isArray(check.artifacts) && check.artifacts.length === 0) problem(`check ${name}: a ${check.kind} obligation needs at least one candidate-bound artifact`);
    if (typeof check.required !== 'boolean') problem(`check ${name}: required must be true or false`);
    if (!RESULTS.includes(check.result)) problem(`check ${name}: result must be one of ${RESULTS.join(', ')}`);
    if (typeof check.timestamp !== 'string' || !ISO_UTC.test(check.timestamp)) problem(`check ${name}: timestamp must be an ISO-8601 UTC timestamp`);
    if (check.kind === 'command' && !nonempty(check.command)) problem(`check ${name}: command kind requires the command that was run`);
    for (const key of ['command', 'scenario', 'viewport', 'observed', 'note']) {
      if (key in check && !shortText(check[key])) problem(`check ${name}: ${key} must be a short string`);
    }
    let images = 0;
    if (!Array.isArray(check.artifacts)) problem(`check ${name}: artifacts must be an array of repository-relative paths`);
    else for (const p of check.artifacts) {
      if (typeof p !== 'string') { problem(`check ${name}: artifact reference must be a string`); continue; }
      if (!artifacts.has(p)) problem(`check ${name}: references unlisted artifact ${p} (dangling reference)`);
      else artifacts.set(p, true);
      if (IMAGE.test(p)) images++;
    }
    if (check.kind === 'visual') {
      visualChecks++;
      for (const key of ['scenario', 'viewport', 'observed']) if (!nonempty(check[key])) problem(`check ${name}: visual check requires ${key}`);
      // A passed visual check must show its image; an unverified one (tool
      // unavailable) is recorded honestly without one and, when required, blocks.
      if (check.result === 'passed' && images === 0) problem(`check ${name}: a passed visual check requires a saved image artifact (.png, .jpg or .webp)`);
    }
    if (check.required === true && check.result !== 'passed') {
      problem(`required check ${name} is ${check.result} — readiness is blocked until it passes on a new candidate or the requirement is deferred with authorization`);
    }
  });
  const strictSnapshots = schema3 && isObject(doc.coverage) && isObject(doc.coverage.snapshots) ? Object.values(doc.coverage.snapshots).filter(p => typeof p === 'string') : [];
  for (const [p, referenced] of artifacts) if (!referenced && !strictSnapshots.includes(p)) problem(`artifact ${p}: not referenced by any check`);

  // Requirements: every ID dispositioned; deferrals authorized; checks resolve.
  const requirements = new Set();
  if (!Array.isArray(doc.requirements) || doc.requirements.length === 0) problem('requirements must be a nonempty array — every PRD requirement needs a disposition');
  else doc.requirements.forEach((req, index) => {
    const label = `requirements[${index}]`;
    if (!isObject(req)) { problem(`${label} must be an object`); return; }
    const id = typeof req.id === 'string' && REQ_ID.test(req.id) ? req.id : null;
    if (!id) problem(`${label}.id must be a requirement ID such as R-01 or the PRD's own REQ-1 (uppercase prefix, dash, digits)`);
    else if (requirements.has(id)) problem(`duplicate requirement ID ${id}`);
    else requirements.add(id);
    const name = id || label;
    for (const key of Object.keys(req)) if (!reqKeys.includes(key)) problem(`requirement ${name}: unknown key "${key}"`);
    if (!dispositions.includes(req.disposition)) problem(`requirement ${name}: disposition must be one of ${dispositions.join(', ')}`);
    if (!Array.isArray(req.tickets) || !req.tickets.every(t => typeof t === 'string' && TICKET_ID.test(t))) problem(`requirement ${name}: tickets must be an array of ticket IDs such as T-01`);
    if (!Array.isArray(req.checks)) problem(`requirement ${name}: checks must be an array of check IDs`);
    else for (const c of req.checks) {
      if (typeof c !== 'string' || !checks.has(c)) problem(`requirement ${name}: references unknown check ${JSON.stringify(c)} (dangling reference)`);
    }
    for (const key of ['note', 'authorized_by']) if (key in req && req[key] !== null && !shortText(req[key])) problem(`requirement ${name}: ${key} must be a short string`);
    if (!schema3 && req.disposition === 'deferred' && !nonempty(req.authorized_by)) problem(`requirement ${name}: deferred requires authorized_by naming the explicit user authorization`);
    if (!schema3 && req.disposition === 'delivered' && Array.isArray(req.checks) && req.checks.length === 0) problem(`requirement ${name}: delivered requires at least one check`);
    if (req.disposition === 'blocked') problem(`requirement ${name} is blocked — readiness is blocked until it is delivered on a new candidate or deferred with authorization`);
  });

  const visual = doc.visual_review;
  if (!isObject(visual) || typeof visual.applicable !== 'boolean') problem('visual_review must be {applicable: boolean, reason?: string}');
  else {
    for (const key of Object.keys(visual)) if (!['applicable', 'reason'].includes(key)) problem(`visual_review.${key} is not allowed`);
    if (visual.applicable === false && !nonempty(visual.reason)) problem('visual_review.reason is required when visual review is not applicable (say why)');
    if (visual.applicable === true && visualChecks === 0) problem('visual_review.applicable is true but no visual check is recorded');
    if ('reason' in visual && !shortText(visual.reason)) problem('visual_review.reason must be a short string');
  }

  if (schema3) validateStrict(doc, { root, rel, dirRel, checks, requirements: requirementsSeen(doc), opts }, problem);

  if (problems.length === 0 && opts.files) {
    opts.list = [rel, ...doc.artifacts.map(a => a.path)];
  }
  return problems;
}
const requirementsSeen = doc => new Map((Array.isArray(doc.requirements) ? doc.requirements : []).filter(r => isObject(r) && typeof r.id === 'string').map(r => [r.id, r]));

// --- Schema 3: reconciled candidate coverage --------------------------------------
// The manifest cannot choose its own obligations: the scenario and requirement rows
// are exactly the inventory snapshot's set plus tombstones, the links are the map
// snapshot's, every declared check appears with its declaration digest, dispositions
// are derived from the outcomes, and (inside a repository) the snapshots recompute
// from the committed candidate's own PRD, map and change record.
function validateStrict(doc, { root, dirRel, checks, requirements: reqRows, opts }, problem) {
  const cov = doc.coverage;
  if (!isObject(cov)) { problem('coverage must be an object { agreement, authorization, inventory, map, snapshots }'); return; }
  for (const k of Object.keys(cov)) if (!COVERAGE_KEYS.includes(k)) problem(`coverage.${k} is not allowed`);
  for (const k of COVERAGE_KEYS) if (!(k in cov)) problem(`coverage.${k} is missing`);
  for (const k of ['agreement', 'inventory', 'map']) if (typeof cov[k] !== 'string' || !SHA256.test(cov[k])) problem(`coverage.${k} must be a 64-hex digest`);
  if (typeof cov.authorization !== 'string' || !/^A-[0-9]{2,6}$/.test(cov.authorization)) problem('coverage.authorization must name the authorization A-NN that covered the evaluation');
  const changeId = isObject(doc.change) && typeof doc.change.id === 'string' ? doc.change.id : null;
  const expectedSnapshots = { inventory: `${dirRel}/coverage/inventory.json`, map: `${dirRel}/coverage/map.json` };
  if (!isObject(cov.snapshots)) { problem('coverage.snapshots must be { inventory, map }'); return; }
  for (const k of ['inventory', 'map']) if (cov.snapshots[k] !== expectedSnapshots[k]) problem(`coverage.snapshots.${k} must be ${expectedSnapshots[k]}`);
  for (const k of Object.keys(cov.snapshots)) if (!['inventory', 'map'].includes(k)) problem(`coverage.snapshots.${k} is not allowed`);
  const listed = new Set((Array.isArray(doc.artifacts) ? doc.artifacts : []).filter(isObject).map(a => a.path));
  for (const k of ['inventory', 'map']) if (!listed.has(expectedSnapshots[k])) problem(`coverage snapshot ${expectedSnapshots[k]} must be a listed artifact`);
  // Snapshots: the inventory recomputes from its definitions; the map normalizes to its digest.
  let inv = null, mapDoc = null, mapNormalized = null;
  const readSnap = k => { try { return JSON.parse(fs.readFileSync(path.join(root, expectedSnapshots[k]), 'utf8')); } catch (error) { problem(`coverage snapshot ${expectedSnapshots[k]}: ${error.code === 'ENOENT' ? 'missing' : `malformed JSON (${error.message})`}`); return null; } };
  const invSnap = readSnap('inventory'), mapSnap = readSnap('map');
  if (invSnap) {
    if (!isObject(invSnap) || invSnap.schema !== 1 || invSnap.prd !== doc.prd) problem(`coverage snapshot ${expectedSnapshots.inventory}: must be schema 1 for ${doc.prd}`);
    else {
      const bad = requirements.validateSnapshot({ digest: invSnap.digest, projection: invSnap.projection, requirements: invSnap.requirements, scenarios: invSnap.scenarios }, doc.prd);
      if (bad) problem(`coverage snapshot ${expectedSnapshots.inventory}: ${bad}`);
      else if (invSnap.digest !== cov.inventory) problem(`coverage.inventory ${String(cov.inventory).slice(0, 12)} does not equal the inventory snapshot digest ${invSnap.digest.slice(0, 12)}`);
      else inv = invSnap;
    }
  }
  if (mapSnap) {
    if (!isObject(mapSnap) || mapSnap.schema !== 1 || !isObject(mapSnap.map)) problem(`coverage snapshot ${expectedSnapshots.map}: must be schema 1 with the map object`);
    else {
      const why = changeId ? coverage.validateMap(mapSnap.map, { change: changeId, prd: doc.prd, root: null }) : 'no change id';
      if (why) problem(`coverage snapshot ${expectedSnapshots.map}: ${why}`);
      else {
        mapNormalized = coverage.normalize(mapSnap.map);
        if (coverage.digestOf(mapNormalized) !== cov.map || mapSnap.digest !== cov.map) problem(`coverage.map ${String(cov.map).slice(0, 12)} does not equal the map snapshot digest`);
        else if (mapSnap.path !== coverage.file(changeId)) problem(`coverage snapshot ${expectedSnapshots.map}: path must be ${coverage.file(changeId)}`);
        else mapDoc = mapSnap.map;
      }
    }
  }
  // Adequacy and delivery shape.
  const adequacy = doc.adequacy;
  if (!isObject(adequacy) || !ADEQUACY.includes(adequacy.verdict) || !nonempty(adequacy.note) || Object.keys(adequacy).some(k => !['verdict', 'note'].includes(k))) problem('adequacy must be { verdict: "adequate" | "inadequate", note } with a nonempty note (the reviewer\'s judgment)');
  else if (adequacy.verdict === 'inadequate') problem(`adequacy verdict is inadequate ("${adequacy.note}") — readiness is blocked until the reviewer judges the checks adequate on a new evaluation`);
  const delivery = doc.delivery;
  if (!isObject(delivery) || typeof delivery.original !== 'boolean' || typeof delivery.agreed !== 'boolean' || Object.keys(delivery).some(k => !['original', 'agreed'].includes(k))) problem('delivery must be { original: boolean, agreed: boolean }');
  if (!inv || !mapDoc) return;
  // Declared checks: every one appears, with its kind, required flag and definition digest; nothing undeclared.
  for (const [id, c] of Object.entries(mapDoc.checks)) {
    const row = checks.get(id);
    if (!row) { problem(`declared check ${id} (${c.required ? 'required' : 'optional'} ${c.kind}) is missing from checks — an unused failing required check cannot be omitted`); continue; }
    if (row.kind !== c.kind) problem(`check ${id}: kind ${row.kind} disagrees with the declaration (${c.kind})`);
    if (row.required !== c.required) problem(`check ${id}: required ${row.required} disagrees with the declaration (${c.required})`);
    const declared = coverage.definitionDigest(c);
    if (row.declared !== declared) problem(`check ${id}: declared ${String(row.declared).slice(0, 12)} is not the declaration's digest ${declared.slice(0, 12)}`);
    if (c.kind === 'command' && isObject(row.attempt) && row.attempt.check_digest !== declared) problem(`check ${id}: the attempt ran ${String(row.attempt.check_digest).slice(0, 12)}, not the declared command and timeout (${declared.slice(0, 12)}) — a substituted command is not evidence for the declaration`);
  }
  for (const id of checks.keys()) if (!mapDoc.checks[id]) problem(`check ${id} is not declared in the coverage map snapshot`);
  // Scenario rows: exactly the inventory's scenarios plus removed tombstones, once each, with the map's links.
  const tombstones = Object.keys(mapDoc.scope).filter(id => mapDoc.scope[id].disposition === 'removed' && !inv.scenarios[id]);
  const expectedRows = new Set([...Object.keys(inv.scenarios), ...tombstones]);
  const rows = new Map();
  if (!Array.isArray(doc.scenarios)) { problem('scenarios must be an array with one row per scenario of the inventory snapshot'); return; }
  const passed = id => { const c = checks.get(id); return Boolean(c) && c.result === 'passed'; };
  for (const [sid, srow] of Object.entries(mapDoc.scenarios || {}))
    for (const c of (srow && Array.isArray(srow.checks) ? srow.checks : []))
      if (!mapDoc.checks[c]) problem(`the coverage snapshot links ${sid} to ${c}, which it does not declare`);
  const derive = (id, row) => {
    const scope = mapDoc.scope[id];
    if (scope) return scope.disposition;
    const linked = mapDoc.scenarios[id] ? mapDoc.scenarios[id].checks : [];
    // A link to a check the map snapshot does not declare is not a satisfied
    // obligation: it is an obligation nothing can have verified.
    return linked.length && linked.every(c => mapDoc.checks[c] && (!mapDoc.checks[c].required || passed(c))) ? 'delivered' : 'blocked';
  };
  doc.scenarios.forEach((row, index) => {
    const label = `scenarios[${index}]`;
    if (!isObject(row)) { problem(`${label} must be an object`); return; }
    for (const k of Object.keys(row)) if (!SCENARIO_KEYS.includes(k)) problem(`${label}: unknown key "${k}"`);
    for (const k of SCENARIO_KEYS) if (!(k in row)) problem(`${label}: missing key "${k}"`);
    const id = typeof row.id === 'string' ? row.id : null;
    if (!id) { problem(`${label}.id must be a scenario ID`); return; }
    if (rows.has(id)) { problem(`duplicate scenario row ${id}`); return; }
    rows.set(id, row);
    if (!expectedRows.has(id)) { problem(`scenario ${id} is not a scenario of the inventory snapshot (an invented row)`); return; }
    const live = inv.scenarios[id];
    if (live && row.requirement !== live.requirement) problem(`scenario ${id}: requirement ${row.requirement} disagrees with the inventory (${live.requirement})`);
    if (!DISPOSITIONS_3.includes(row.disposition)) problem(`scenario ${id}: disposition must be one of ${DISPOSITIONS_3.join(', ')}`);
    const expected = derive(id, row);
    if (row.disposition !== expected) problem(`scenario ${id}: disposition ${row.disposition} is not what the map and the outcomes give (${expected})`);
    const mapRow = mapDoc.scenarios[id];
    const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
    if (mapRow) {
      if (!Array.isArray(row.tickets) || !same(row.tickets, mapRow.tickets)) problem(`scenario ${id}: tickets disagree with the map (${mapRow.tickets.join(', ')})`);
      if (!Array.isArray(row.checks) || !same(row.checks, mapRow.checks)) problem(`scenario ${id}: checks disagree with the map (${mapRow.checks.join(', ')})`);
      if (row.decision !== null || row.authorization !== null) problem(`scenario ${id}: an in-scope row carries null decision and authorization`);
    } else {
      if (!Array.isArray(row.tickets) || row.tickets.length || !Array.isArray(row.checks) || row.checks.length) problem(`scenario ${id}: a dispositioned row carries no tickets or checks`);
      if (typeof row.decision !== 'string' || !/^D-[0-9]{2,6}$/.test(row.decision) || row.decision !== mapDoc.scope[id].decision) problem(`scenario ${id}: decision must be the map's ${mapDoc.scope[id].decision}`);
      if (typeof row.authorization !== 'string' || !/^A-[0-9]{2,6}$/.test(row.authorization)) problem(`scenario ${id}: a ${row.disposition} row names the user authorization A-NN that covers its decision`);
    }
    if (row.note !== null && !shortText(row.note)) problem(`scenario ${id}: note must be null or a short string`);
    if (row.disposition === 'blocked') problem(`scenario ${id} is blocked — readiness is blocked until every required check it links passes on a new candidate or the scenario is dispositioned with authorization`);
  });
  for (const id of expectedRows) if (!rows.has(id)) problem(`scenario ${id} of the inventory snapshot has no row (an omitted obligation)`);
  // Requirement rows: exactly the inventory's requirements; rolled up from their scenarios.
  for (const id of Object.keys(inv.requirements)) {
    const req = reqRows.get(id);
    if (!req) { problem(`requirement ${id} of the inventory snapshot has no row`); continue; }
    const expectedScenarios = inv.requirements[id].scenarios;
    if (!Array.isArray(req.scenarios) || JSON.stringify([...req.scenarios].sort()) !== JSON.stringify([...expectedScenarios].sort())) problem(`requirement ${id}: scenarios disagree with the inventory (${expectedScenarios.join(', ')})`);
    const states = expectedScenarios.map(sid => (rows.get(sid) || {}).disposition);
    const roll = states.every(x => x === 'delivered') ? 'delivered' : states.every(x => x === 'removed') ? 'removed' : states.every(x => ['delivered', 'deferred', 'removed'].includes(x)) ? 'deferred' : 'blocked';
    if (req.disposition !== roll) problem(`requirement ${id}: disposition ${req.disposition} is not the roll-up of its scenarios (${roll})`);
  }
  for (const id of reqRows.keys()) if (!inv.requirements[id]) problem(`requirement ${id} is not a requirement of the inventory snapshot (an invented row)`);
  const original = [...expectedRows].every(id => inv.scenarios[id] && (rows.get(id) || {}).disposition === 'delivered');
  const agreed = [...expectedRows].every(id => ['delivered', 'deferred', 'removed'].includes((rows.get(id) || {}).disposition));
  if (isObject(delivery) && (delivery.original !== original || delivery.agreed !== agreed)) problem(`delivery { original: ${original}, agreed: ${agreed} } is what the rows give, not { original: ${delivery.original}, agreed: ${delivery.agreed} }`);
  // Independent reconciliation with the committed candidate, when the repository is available.
  if (typeof doc.candidate !== 'string' || !HEX40.test(doc.candidate) || !changeId) return;
  const show = rel => tryGit(root, ['show', `${doc.candidate}:${rel}`]);
  // Only a commit that does not resolve is "not available": a commit that is present
  // but missing a blob is a problem with the evidence, and the map and the change
  // record must still be reconciled against it.
  if (tryGit(root, ['rev-parse', '--verify', `${doc.candidate}^{commit}`]).error) {
    opts.limitations.push(`the candidate ${doc.candidate.slice(0, 7)} is not available in this repository; the snapshots were validated against themselves only`);
    return;
  }
  const prdShown = show(doc.prd);
  const parsed = prdShown.error ? null : requirements.parseInventory(prdShown.out, { prd: doc.prd });
  if (prdShown.error) problem(`the candidate carries no ${doc.prd}`);
  else if (!parsed.ok) problem(`the candidate's PRD does not parse strictly (${parsed.problems[0]})`);
  else if (parsed.inventory.digest !== cov.inventory) {
    const d = requirements.difference(inv, requirements.snapshotOf(parsed.inventory));
    const extra = d.scenarios.added.length ? `the candidate's PRD defines ${d.scenarios.added.join(', ')}, which the manifest omits` : d.scenarios.removed.length ? `the manifest lists ${d.scenarios.removed.join(', ')}, which the candidate's PRD does not define` : d.scenarios.changed.length ? `${d.scenarios.changed.map(c => c.id).join(', ')} differ from the candidate's PRD` : 'the inventory differs';
    problem(`coverage.inventory does not equal the inventory of the candidate's PRD: ${extra}`);
  }
  const mapShown = show(coverage.file(changeId));
  if (mapShown.error) problem(`the candidate carries no ${coverage.file(changeId)}`);
  else {
    const v = coverage.validateText(mapShown.out, { change: changeId, prd: doc.prd });
    if (v.problem) problem(`the candidate's coverage map cannot be read (${v.problem})`);
    else if (v.digest !== cov.map) problem(`coverage.map does not equal the digest of the candidate's ${coverage.file(changeId)} (a substituted map)`);
  }
  const recShown = show(`.prd/changes/${changeId}.json`);
  if (recShown.error) problem(`the candidate carries no change record .prd/changes/${changeId}.json`);
  else {
    let rec = null;
    try { rec = JSON.parse(recShown.out); } catch { rec = null; }
    if (!rec || rec.schema !== 3) problem(`the candidate's change record is not a strict (schema 3) record`);
    else {
      const entry = (rec.agreements || []).find(g => g.digest === cov.agreement);
      if (!entry) problem(`coverage.agreement ${cov.agreement.slice(0, 12)} is not an agreement of the candidate's change record`);
      else if (entry.inventory !== cov.inventory || entry.coverage !== cov.map) problem(`agreement ${entry.id} binds inventory ${String(entry.inventory).slice(0, 12)} and map ${String(entry.coverage).slice(0, 12)}, not the manifest's`);
      const auth = (rec.authorizations || []).find(a => a.id === cov.authorization);
      if (!auth || auth.digest !== cov.agreement) problem(`coverage.authorization ${cov.authorization} does not bind agreement ${cov.agreement.slice(0, 12)} in the candidate's change record`);
      // A non-delivered row is only as good as the decision and the user authorization
      // the candidate's own record carries — the same rule the local report applies.
      const dispositions = require('./dispositions.cjs');
      for (const [id, row] of rows) {
        if (row.disposition !== 'deferred' && row.disposition !== 'removed') continue;
        const decision = (rec.decisions || []).find(d => d.id === row.decision);
        if (!decision) { problem(`scenario ${id}: decision ${row.decision} is not a decision of the candidate's change record`); continue; }
        if (decision.status !== 'resolved') { problem(`scenario ${id}: decision ${row.decision} is ${decision.status} in the candidate's change record, not resolved`); continue; }
        if (!dispositions.namesId(decision, id)) { problem(`scenario ${id}: decision ${row.decision} does not name ${id}`); continue; }
        const named = (rec.authorizations || []).find(a => a.id === row.authorization);
        if (!named) { problem(`scenario ${id}: authorization ${row.authorization} is not an authorization of the candidate's change record`); continue; }
        const applicable = dispositions.applicableUserAuthorization(rec, named, row.decision);
        if (!applicable.authorization) problem(`scenario ${id}: authorization ${row.authorization} does not carry a user decision for ${row.decision} (${applicable.reason})`);
      }
    }
  }
}

// Schema 2: every check declares its provenance; a passed or failed command
// result exists only as a runtime attempt whose log digest the manifest carries.
function validateProvenance(check, name, doc, problem) {
  if (!PROVENANCE.includes(check.provenance)) { problem(`check ${name}: provenance must be runtime or authored`); return; }
  const artifactDigest = p => { const entry = Array.isArray(doc.artifacts) ? doc.artifacts.find(a => isObject(a) && a.path === p) : null; return entry ? entry.sha256 : null; };
  if (check.provenance === 'authored') {
    if ('attempt' in check) problem(`check ${name}: an authored check carries no attempt`);
    if (check.kind === 'command' && ['passed', 'failed'].includes(check.result)) problem(`check ${name}: a ${check.result} command check must have runtime provenance (run it through pincer-runtime.cjs check)`);
    return;
  }
  if (check.kind !== 'command') problem(`check ${name}: runtime provenance applies to command checks only`);
  const a = check.attempt;
  if (!isObject(a)) { problem(`check ${name}: runtime provenance requires an attempt object`); return; }
  for (const key of Object.keys(a)) if (!ATTEMPT_KEYS.includes(key)) problem(`check ${name}: attempt.${key} is not allowed`);
  for (const key of ATTEMPT_KEYS) if (!(key in a)) problem(`check ${name}: attempt.${key} is missing`);
  if (!nonempty(a.id)) problem(`check ${name}: attempt.id must be a nonempty string`);
  if (!Number.isInteger(a.sequence) || a.sequence < 1) problem(`check ${name}: attempt.sequence must be a positive integer`);
  if (!OUTCOMES.includes(a.outcome)) problem(`check ${name}: attempt.outcome must be one of ${OUTCOMES.join(', ')}`);
  else if (check.result !== resultFor(a.outcome)) problem(`check ${name}: result ${check.result} disagrees with attempt outcome ${a.outcome} (expected ${resultFor(a.outcome)})`);
  if (a.exit_code !== null && !Number.isInteger(a.exit_code)) problem(`check ${name}: attempt.exit_code must be an integer or null`);
  for (const key of ['started', 'finished']) if (typeof a[key] !== 'string' || !ISO_UTC.test(a[key])) problem(`check ${name}: attempt.${key} must be an ISO-8601 UTC timestamp`);
  for (const key of ['source_before', 'source_after']) if (a[key] !== null && (typeof a[key] !== 'string' || !SHA256.test(a[key]))) problem(`check ${name}: attempt.${key} must be a 64-hex digest or null`);
  if (typeof a.check_digest !== 'string' || !SHA256.test(a.check_digest)) problem(`check ${name}: attempt.check_digest must be a 64-hex digest`);
  if (!isObject(a.runner) || !nonempty(a.runner.shell) || !Array.isArray(a.runner.args) || !nonempty(a.runner.version)) problem(`check ${name}: attempt.runner must be {shell, args, version}`);
  if (!shortText(a.cwd)) problem(`check ${name}: attempt.cwd must be a short string`);
  if (typeof a.truncated !== 'boolean') problem(`check ${name}: attempt.truncated must be true or false`);
  if (typeof a.log_sha256 !== 'string' || !SHA256.test(a.log_sha256)) problem(`check ${name}: attempt.log_sha256 must be a 64-hex digest`);
  else if (Array.isArray(check.artifacts)) {
    const logs = check.artifacts.filter(p => typeof p === 'string' && /\.log$/.test(p));
    if (logs.length !== 1) problem(`check ${name}: a runtime check references exactly one .log artifact`);
    else if (artifactDigest(logs[0]) !== a.log_sha256) problem(`check ${name}: log artifact ${logs[0]} digest does not equal attempt.log_sha256`);
  }
}

// --- Export (schema 2) ---------------------------------------------------------
// Build the candidate evidence set from a draft of authored fields and the
// runtime's attempts for the candidate. Never invents a review transcript and
// never converts a review judgment into a command result.
// `strict` (schema 3): { inventory, map, mapDigest, graph, scope: [{ id, disposition,
// decision, authorization }], agreement, authorization } — the draft then carries
// no requirements (dispositions are derived), every declared check appears once,
// command entries are populated from the declaration, and the inventory and map
// snapshots are written as listed artifacts.
function exportEvidence(root, { candidate, base, prd, draft, binding, attemptsFor, environment, now, atomicWrite, strict = null }) {
  const version = prd.match(PRD_REF)[1];
  const dirRel = `.prd/evidence/prd-v${version}/${candidate}`;
  const dirAbs = path.join(root, dirRel);
  const problems = [];
  if (!isObject(draft)) return { problems: ['draft must be a JSON object'] };
  const allowed = strict ? ['environment', 'coverage_review', 'adequacy', 'checks', 'visual_review'] : ['environment', 'coverage_review', 'requirements', 'checks', 'visual_review'];
  for (const key of Object.keys(draft)) if (!allowed.includes(key)) problems.push(`draft: unknown key "${key}" (allowed: ${allowed.join(', ')})${strict && key === 'requirements' ? ' — dispositions are derived from the map and the outcomes in a strict change' : ''}`);
  if (!Array.isArray(draft.checks)) problems.push('draft.checks must be an array');
  if (strict && (!isObject(draft.adequacy) || !ADEQUACY.includes(draft.adequacy.verdict) || !nonempty(draft.adequacy.note))) problems.push('draft.adequacy must be { verdict: "adequate" | "inadequate", note } — the reviewer\'s judgment that the checks establish their scenarios');
  if (problems.length) return { problems };
  if (strict) {
    // Every declared check exactly once; nothing undeclared; command entries come from the declaration.
    const ids = draft.checks.filter(isObject).map(s => s.id);
    for (const [id, c] of Object.entries(strict.map.checks)) if (!ids.includes(id)) problems.push(`draft check ${id} (${c.required ? 'required' : 'optional'} ${c.kind}) is missing: every declared check appears in the draft — an unused failing required check cannot be omitted`);
    for (const id of ids) if (!strict.map.checks[id]) problems.push(`draft check ${id} is not declared in the coverage map`);
    if (new Set(ids).size !== ids.length) problems.push('draft checks name a declared check twice');
    if (problems.length) return { problems };
    draft = { ...draft, checks: draft.checks.map(s => {
      const c = strict.map.checks[s.id];
      if (c.kind === 'command') {
        if ('kind' in s && s.kind !== 'command') problems.push(`draft check ${s.id}: kind ${s.kind} disagrees with the declaration (command)`);
        if ('required' in s && s.required !== c.required) problems.push(`draft check ${s.id}: required ${s.required} disagrees with the declaration (${c.required})`);
        if ('command' in s && s.command !== c.command) problems.push(`draft check ${s.id}: the command text disagrees with the declaration`);
        if ('result' in s) problems.push(`draft check ${s.id}: a command result cannot be authored; it is populated from the runtime attempt`);
        return { id: s.id, kind: 'command', required: c.required, ...(s.note ? { note: s.note } : {}), ...(Array.isArray(s.artifacts) ? { artifacts: s.artifacts } : {}) };
      }
      if ('required' in s && s.required !== c.required) problems.push(`draft check ${s.id}: required ${s.required} disagrees with the declaration (${c.required})`);
      if ('kind' in s && s.kind !== c.kind) problems.push(`draft check ${s.id}: kind ${s.kind} disagrees with the declaration (${c.kind})`);
      return { ...s, kind: c.kind, required: c.required };
    }) };
    const reviews = require('./checks.cjs').reviewProblems(strict.map, Object.fromEntries(draft.checks.map(s => [s.id, s])), { dirRel, root });
    for (const p of reviews) problems.push(`${p.code}: ${p.detail}`);
    if (problems.length) return { problems };
  }
  const env = isObject(draft.environment) ? draft.environment : {};
  const checks = [];
  const artifactPaths = new Set();
  for (const stub of draft.checks) {
    if (!isObject(stub) || typeof stub.id !== 'string' || !CHECK_ID.test(stub.id)) { problems.push(`draft.checks entries must be objects with a check ID such as C-01 (got ${JSON.stringify(isObject(stub) ? stub.id : stub)})`); continue; }
    // Authored artifact paths are validated before anything is written: no
    // traversal, no absolute paths, and inside this candidate's evidence directory.
    for (const p of Array.isArray(stub.artifacts) ? stub.artifacts : []) {
      if (typeof p !== 'string') { problems.push(`draft check ${stub.id}: artifact references must be strings`); continue; }
      const why = unsafePath(p);
      if (why) problems.push(`draft check ${stub.id}: artifact ${p}: ${why}`);
      else if (!p.startsWith(`${dirRel}/`)) problems.push(`draft check ${stub.id}: artifact ${p}: outside the evidence directory ${dirRel}/`);
    }
    const isStub = stub.kind === 'command' && !('result' in stub);
    if (!isStub) {
      if (stub.kind === 'command' && ['passed', 'failed'].includes(stub.result)) { problems.push(`draft check ${stub.id}: a ${stub.result} command result cannot be authored; omit result to populate it from the runtime attempt`); continue; }
      const authored = { ...stub, provenance: 'authored' };
      delete authored.attempt;
      for (const p of authored.artifacts || []) artifactPaths.add(p);
      checks.push(authored);
      continue;
    }
    const { attempt, pointed } = attemptsFor(stub.id);
    if (!attempt) { problems.push(`draft check ${stub.id}: no runtime attempt for candidate ${candidate}; run: node scripts/pincer-runtime.cjs check ${stub.id} --candidate ${candidate} -- <command>`); continue; }
    // The record must be complete, written for this check, and its captured
    // logs must still match the digests it recorded; anything else is refused.
    const changesMode = binding.mode === 'changes';
    const invalid = validateAttempt(attempt, contextKey({ kind: 'candidate', change: binding.change, candidate, check: stub.id, mode: binding.mode }), pointed || null);
    if (invalid) { problems.push(`draft check ${stub.id}: attempt ${typeof attempt.id === 'string' ? attempt.id : '?'} ${invalid}; run the check again`); continue; }
    const wanted = changesMode ? (binding.strict ? 3 : 2) : 1;
    if (changesMode && attempt.schema !== wanted) { problems.push(`draft check ${stub.id}: attempt ${attempt.id} was recorded under schema ${attempt.schema} (${attempt.schema < wanted ? (wanted === 3 ? 'before this change adopted strict coverage' : 'before this project used change records') : 'for a strict change; this change has not adopted strict coverage'}) and is history; run the check again`); continue; }
    if (changesMode && attempt.context.change !== binding.change) { problems.push(`draft check ${stub.id}: attempt ${attempt.id} belongs to change ${attempt.context.change}, not ${binding.change}; run the check again`); continue; }
    if (attempt.outcome === 'running') { problems.push(`draft check ${stub.id}: attempt ${attempt.id} is still running`); continue; }
    const logRel = `${dirRel}/checks/${stub.id}.log`;
    const pieces = [`$ ${(attempt.check && attempt.check.display) || ''}`.replace(/\n$/, ''), ''];
    let missing = false, altered = null;
    for (const stream of ['stdout', 'stderr']) {
      const info = attempt.artifacts[stream];
      const file = path.join(root, info.path);
      let text = '';
      if (fs.existsSync(file)) {
        const data = fs.readFileSync(file);
        if (info.sha256 === null) { altered = altered || `captured ${stream} log ${info.path} has no recorded digest (the attempt was finalized by recover)`; }
        else if (crypto.createHash('sha256').update(data).digest('hex') !== info.sha256) { altered = altered || `captured ${stream} log ${info.path} does not match the digest the attempt recorded`; }
        text = data.toString('utf8');
      } else { missing = true; text = '[pincer: captured log missing from local state]'; }
      pieces.push(`--- ${stream}${info.truncated ? ' (truncated by the runtime)' : ''}${info.redactions ? ` (${info.redactions} redaction(s))` : ''} ---`);
      pieces.push(text.replace(/\n$/, ''));
    }
    if (missing) { problems.push(`draft check ${stub.id}: attempt ${attempt.id} has no captured log; run the check again`); continue; }
    if (altered) { problems.push(`draft check ${stub.id}: attempt ${attempt.id}: ${altered}; run the check again`); continue; }
    pieces.push(`--- outcome ${attempt.outcome}${attempt.exit_code !== null && attempt.exit_code !== undefined ? ` (exit ${attempt.exit_code})` : ''} ---`);
    const content = `${pieces.join('\n')}\n`;
    atomicWrite(path.join(dirAbs, 'checks', `${stub.id}.log`), content);
    artifactPaths.add(logRel);
    checks.push({
      id: stub.id, kind: 'command', required: Boolean(stub.required), result: resultFor(attempt.outcome),
      command: (attempt.check && attempt.check.display || '').replace(/\n$/, ''), timestamp: attempt.finished || attempt.started,
      artifacts: [logRel, ...(stub.artifacts || [])], provenance: 'runtime',
      attempt: {
        id: attempt.id, sequence: attempt.sequence, outcome: attempt.outcome, exit_code: attempt.exit_code ?? null,
        started: attempt.started, finished: attempt.finished, source_before: attempt.source ? attempt.source.before : null, source_after: attempt.source ? attempt.source.after : null,
        check_digest: attempt.check.digest, runner: attempt.runner, cwd: attempt.cwd || '.', log_sha256: crypto.createHash('sha256').update(content).digest('hex'), truncated: Boolean((attempt.artifacts.stdout && attempt.artifacts.stdout.truncated) || (attempt.artifacts.stderr && attempt.artifacts.stderr.truncated)),
      },
      ...(stub.note ? { note: stub.note } : {}), ...(attempt.outcome === 'error' ? { note: `${stub.note ? `${stub.note}; ` : ''}attempt error: ${attempt.error}` } : {}),
    });
  }
  if (problems.length) return { problems };
  // Strict: the declaration digest per check, the inventory and map snapshots as listed artifacts.
  let strictParts = null;
  if (strict) {
    for (const c of checks) c.declared = coverage.definitionDigest(strict.map.checks[c.id]);
    const invSnap = requirements.snapshotOf(strict.inventory);
    const inventoryRel = `${dirRel}/coverage/inventory.json`, mapRel = `${dirRel}/coverage/map.json`;
    atomicWrite(path.join(root, inventoryRel), `${JSON.stringify({ schema: 1, prd, digest: invSnap.digest, projection: invSnap.projection, requirements: invSnap.requirements, scenarios: invSnap.scenarios }, null, 2)}\n`);
    atomicWrite(path.join(root, mapRel), `${JSON.stringify({ schema: 1, path: coverage.file(binding.change), digest: strict.mapDigest, map: strict.map }, null, 2)}\n`);
    artifactPaths.add(inventoryRel); artifactPaths.add(mapRel);
    strictParts = { inventoryRel, mapRel, invSnap };
  }
  const artifacts = [];
  for (const p of [...artifactPaths].sort()) {
    const abs = path.join(root, p);
    if (!fs.existsSync(abs)) { problems.push(`artifact ${p}: missing (authored artifacts must be saved before export)`); continue; }
    artifacts.push({ path: p, sha256: digestFile(abs) });
  }
  if (problems.length) return { problems };
  const manifest = {
    schema: strict ? 3 : 2, prd, base, candidate, created: now,
    environment: { os: environment.os, node: environment.node, tools: env.tools || [], limitations: env.limitations || [] },
    coverage_review: draft.coverage_review, requirements: draft.requirements, checks, visual_review: draft.visual_review, artifacts,
    change: { id: binding.change, prd_revision: binding.prd_revision, base: binding.base },
  };
  if (strict) {
    // Rows are derived: a scenario is delivered when every required check it links passed;
    // a dispositioned one names its decision and the user authorization covering it.
    const passed = new Set(checks.filter(c => c.result === 'passed').map(c => c.id));
    const inv = strictParts.invSnap;
    const scopeAuth = Object.fromEntries((strict.scope || []).map(s => [s.id, s]));
    const scenarioRows = [];
    const ids = requirements.sortIds([...new Set([...Object.keys(inv.scenarios), ...Object.keys(strict.map.scope).filter(id => strict.map.scope[id].disposition === 'removed')])]);
    for (const id of ids) {
      const scope = strict.map.scope[id];
      if (scope) {
        const g = strict.graph.scope[id] || {};
        scenarioRows.push({ id, requirement: inv.scenarios[id] ? inv.scenarios[id].requirement : g.requirement || null, disposition: scope.disposition, tickets: [], checks: [], decision: scope.decision, authorization: scopeAuth[id] ? scopeAuth[id].authorization : null, note: scope.note });
        continue;
      }
      const row = strict.map.scenarios[id];
      const delivered = row.checks.every(c => !strict.map.checks[c].required || passed.has(c));
      scenarioRows.push({ id, requirement: inv.scenarios[id].requirement, disposition: delivered ? 'delivered' : 'blocked', tickets: requirements.sortIds(row.tickets), checks: requirements.sortIds(row.checks), decision: null, authorization: null, note: null });
    }
    const rowOf = Object.fromEntries(scenarioRows.map(r => [r.id, r]));
    const requirementRows = requirements.sortIds(Object.keys(inv.requirements)).map(id => {
      const scen = inv.requirements[id].scenarios;
      const states = scen.map(sid => rowOf[sid].disposition);
      const disposition = states.every(x => x === 'delivered') ? 'delivered' : states.every(x => x === 'removed') ? 'removed' : states.every(x => ['delivered', 'deferred', 'removed'].includes(x)) ? 'deferred' : 'blocked';
      const tickets = requirements.sortIds([...new Set(scen.flatMap(sid => rowOf[sid].tickets))]);
      const checkIds = requirements.sortIds([...new Set(scen.flatMap(sid => rowOf[sid].checks))]);
      const decisions = [...new Set(scen.map(sid => rowOf[sid].decision).filter(Boolean))];
      return { id, disposition, tickets, checks: checkIds, scenarios: [...scen], decision: decisions.length === 1 && disposition !== 'delivered' && disposition !== 'blocked' ? decisions[0] : null, authorization: decisions.length === 1 && disposition !== 'delivered' && disposition !== 'blocked' ? (scen.map(sid => rowOf[sid].authorization).find(Boolean) || null) : null, note: null };
    });
    manifest.requirements = requirementRows;
    manifest.coverage = { agreement: strict.agreement, authorization: strict.authorization, inventory: inv.digest, map: strict.mapDigest, snapshots: { inventory: strictParts.inventoryRel, map: strictParts.mapRel } };
    manifest.scenarios = scenarioRows;
    manifest.adequacy = { verdict: draft.adequacy.verdict, note: draft.adequacy.note };
    manifest.delivery = { original: scenarioRows.every(r => inv.scenarios[r.id] && r.disposition === 'delivered'), agreed: scenarioRows.every(r => ['delivered', 'deferred', 'removed'].includes(r.disposition)) };
  }
  const manifestRel = `${dirRel}/manifest.json`;
  atomicWrite(path.join(root, manifestRel), `${JSON.stringify(manifest, null, 2)}\n`);
  const validationOpts = { candidate, base, prd };
  const validation = validate(path.join(root, manifestRel), validationOpts, root);
  return { manifest: manifestRel, problems: validation, limitations: validationOpts.limitations || [], schema: manifest.schema, delivery: manifest.delivery || null };
}


module.exports = { SCHEMA, SCHEMAS, HEX40, PRD_REF, CHECK_ID, validate, exportEvidence, resultFor, digestFile, repoRoot, realpathDeep, unsafePath };
