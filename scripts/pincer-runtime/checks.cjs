'use strict';
// PINCER runtime — declared candidate checks (docs/runtime-contracts.md, "Strict
// coverage" → "Declared candidate checks"). In a strict change `check C-NN` runs the
// map's declaration (command, timeout, cwd) and nothing else: a supplied command or
// timeout, an undeclared ID and a review obligation are CHECK_UNDECLARED before
// anything is prepared, and the declaration is recomputed under the attempt lock.
// Review obligations are recorded in the evaluation draft with a candidate-bound
// artifact and an explicit result; a required one that is missing, unverified,
// failed or artifact-less is REVIEW_MISSING for export and release. Nothing here
// launches, writes or judges adequacy.
const fs = require('node:fs');
const path = require('node:path');
const coverage = require('./coverage.cjs');
const evidence = require('./evidence.cjs');

// The declaration of a check for a strict binding. Returns { check, digest, commands,
// timeout, cwd, file } or { code, problem }.
function declaration(root, binding, checkId) {
  const m = coverage.readMap(root, { change: binding.change, prd: binding.prd });
  if (!m.ok) return { code: m.code, problem: m.problems[0] };
  const c = m.map.checks[checkId];
  if (!c) return { code: 'CHECK_UNDECLARED', problem: `${checkId} is not declared in ${m.file} (declared: ${Object.keys(m.map.checks).sort().join(', ') || 'none'}); declare it there and authorize the agreement` };
  if (c.kind !== 'command') return { code: 'CHECK_UNDECLARED', problem: `${checkId} is a ${c.kind} obligation ("${c.obligation}"); it is recorded in the evaluation draft with its candidate-bound artifact and result, never run as a command` };
  return { check: c, digest: coverage.definitionDigest(c), commands: c.command.split('\n'), timeout: c.timeout, cwd: c.cwd, file: m.file };
}

// Problems of the review obligations for a candidate: `drafts` maps check IDs to the
// draft entries ({ result, artifacts, ... }); `dirRel` is the candidate's evidence
// directory. Returns [{ code: 'REVIEW_MISSING', detail, ids }] for required
// obligations that are not passed with an existing candidate-bound artifact, plus
// { code: 'COVERAGE_INCOMPLETE' } for declared obligations absent from the draft.
function reviewProblems(map, drafts, { dirRel, root }) {
  const problems = [];
  for (const [id, c] of Object.entries(map.checks)) {
    if (c.kind === 'command') continue;
    const entry = drafts[id];
    const label = `${id} (${c.required ? 'required' : 'optional'} ${c.kind} obligation: ${c.obligation})`;
    if (!entry) { problems.push({ code: c.required ? 'REVIEW_MISSING' : 'COVERAGE_INCOMPLETE', detail: `${label} is not recorded in the evaluation draft`, ids: [id] }); continue; }
    const artifacts = Array.isArray(entry.artifacts) ? entry.artifacts.filter(p => typeof p === 'string') : [];
    const bound = artifacts.filter(p => !evidence.unsafePath(p) && p.startsWith(`${dirRel}/`) && (!root || fs.existsSync(path.join(root, p))));
    if (!c.required) continue;
    if (entry.result !== 'passed') { problems.push({ code: 'REVIEW_MISSING', detail: `${label} is ${entry.result || 'without a result'}; a required review must pass on this candidate`, ids: [id] }); continue; }
    if (!bound.length) { problems.push({ code: 'REVIEW_MISSING', detail: `${label} has no candidate-bound artifact under ${dirRel}/ (${artifacts.length ? `listed: ${artifacts.join(', ')}` : 'none listed'})`, ids: [id] }); continue; }
  }
  return problems;
}

module.exports = { declaration, reviewProblems };
