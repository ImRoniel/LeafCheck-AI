'use strict';
// PINCER runtime — the requirement inventory (docs/runtime-contracts.md, "Strict
// coverage" → "Requirement inventory"). Parses a PRD into the complete set of
// requirement and scenario definitions under the frozen, deliberately bounded
// grammar: ATX headings `### R-NN — Title` define requirements, bold list items
// `- **S-NN:** text` inside a requirement section define scenarios, fenced code,
// table rows and quotes are reference contexts, and anything that looks like a
// definition in another shape is refused. The PRD prose is authoritative: this
// module derives a view and never edits, renumbers or infers a definition. No
// partial inventory is returned for a PRD with a grammar problem.
const fs = require('node:fs');
const path = require('node:path');
const parse = require('./parse.cjs');

const PROJECTION_VERSION = 1;
const ID = '[A-Z][A-Z0-9]{0,7}-[0-9]{1,6}';
const ID_RE = new RegExp(`^${ID}$`);
const HEADING = /^(#{1,6})[ \t]+(.*?)[ \t]*$/;
const REQUIREMENT_DEF = new RegExp(`^(${ID})(?:[ \\t]+(?:—|–|-)[ \\t]+|:[ \\t]+)(.+)$`);
const STARTS_WITH_ID = new RegExp(`^(${ID})(?![A-Z0-9-])`);
const ITEM = /^([ \t]*)([-+*]|[0-9]+[.)])[ \t]+(.*)$/;
const SCENARIO_DEF = new RegExp(`^\\*\\*(${ID})(:?)\\*\\*(:?)(?:[ \\t]+(?:—|–|-)[ \\t]+|[ \\t]+|$)(.*)$`);
const SCENARIO_LIKE = new RegExp(`^(?:\\*\\*)?${ID}[:.]|^\\*\\*${ID}\\*\\*[ \\t]*$`);
const FENCE = /^[ \t]*`{3,}/;
const TILDE = /^[ \t]*~~~/;
const REFERENCE_CONTEXT = /^[ \t]*[|>]/;
const CONTINUATION = /^(?:[ ]{2,}|\t)(\S.*)$/;

// Prefix in byte order, then numerically: R-02 < R-10, AC-1 < R-01.
function compareIds(a, b) {
  const [pa, na] = split(a), [pb, nb] = split(b);
  if (pa !== pb) return pa < pb ? -1 : 1;
  return na - nb;
}
const split = id => { const i = id.lastIndexOf('-'); return [id.slice(0, i), Number(id.slice(i + 1))]; };
const sortIds = ids => [...ids].sort(compareIds);

const rtrim = s => s.replace(/[ \t]+$/, '');
// Right-trimmed lines, leading/trailing blank lines removed, blank runs collapsed.
function normalizeBlock(lines) {
  const out = [];
  for (const raw of lines) {
    const line = rtrim(raw);
    if (line === '' && (out.length === 0 || out[out.length - 1] === '')) continue;
    out.push(line);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n');
}

// Parse a PRD text. Returns { ok: true, inventory } or { ok: false, problems }
// (each problem a string; the code is always INVENTORY_INVALID). `prd` is the
// repository-relative PRD path recorded in the projection.
function parseInventory(text, { prd } = {}) {
  const rows = parse.lines(text);
  const problems = [];
  const defined = new Map(); // id -> { kind, line }
  const requirements = {}; // id -> { title, lines: [], digest, line, end, scenarios: [] }
  const scenarios = {}; // id -> { requirement, lines: [], digest, line, end }
  const order = [];
  let i = 0;
  if (rows[0] === '---') { i = 1; while (i < rows.length && rows[i] !== '---') i++; i++; }
  let fenceLine = null, current = null, lastScenario = null;
  // Blank lines seen while a scenario is still open. A blank line does not end a
  // list item, so they are held until the next line decides where they belong:
  // to the scenario, when an indented line follows and the item had a second
  // paragraph, or to the requirement, when anything else follows.
  const pending = [];
  const endScenario = () => {
    if (current) for (const blank of pending) requirements[current].lines.push(blank);
    pending.length = 0;
    lastScenario = null;
  };
  // Close the open section at the line before `boundary` (1-based; rows.length + 1 at
  // the end of the file): its span ends at its last nonblank line.
  const closeRequirement = boundary => {
    if (!current) return;
    const r = requirements[current];
    let end = boundary - 1;
    while (end > r.line && rows[end - 1].trim() === '') end--;
    r.end = end;
    if (!r.scenarios.length) problems.push(`requirement ${current} at line ${r.line} has no scenario`);
    endScenario(); current = null;
  };
  const define = (kind, id, line) => {
    const prior = defined.get(id);
    if (prior) { problems.push(`duplicate definition ${id} at line ${line}`); return false; }
    defined.set(id, { kind, line });
    return true;
  };
  for (; i < rows.length; i++) {
    const line = rows[i], n = i + 1;
    if (fenceLine !== null) {
      if (FENCE.test(line)) fenceLine = null;
      if (current) requirements[current].lines.push(line);
      continue;
    }
    if (TILDE.test(line)) { problems.push(`tilde fences are unsupported (line ${n})`); endScenario(); if (current) requirements[current].lines.push(line); continue; }
    if (FENCE.test(line)) { fenceLine = n; endScenario(); if (current) requirements[current].lines.push(line); continue; }
    if (REFERENCE_CONTEXT.test(line)) { endScenario(); if (current) requirements[current].lines.push(line); continue; }
    const heading = line.match(HEADING);
    if (heading) {
      endScenario();
      const level = heading[1].length, textOf = heading[2];
      const def = textOf.match(REQUIREMENT_DEF);
      if (def && level >= 2 && level <= 4 && def[2].trim() !== '') {
        closeRequirement(n);
        if (define('requirement', def[1], n)) {
          current = def[1];
          requirements[current] = { title: def[2].trim(), lines: [], line: n, end: n, level, scenarios: [] };
          order.push(current);
        }
        continue;
      }
      if (STARTS_WITH_ID.test(textOf)) { problems.push(`unsupported requirement definition syntax at line ${n}; use "### R-NN — Title"`); closeRequirement(n); continue; }
      if (current && level <= requirements[current].level) { closeRequirement(n); continue; }
      if (current) requirements[current].lines.push(line);
      continue;
    }
    const item = line.match(ITEM);
    if (item) {
      endScenario();
      const body = item[3].replace(/^\[[ xX]\][ \t]+/, '');
      const def = body.match(SCENARIO_DEF);
      const numbered = /^[0-9]/.test(item[2]);
      if (def && !numbered) {
        if (def[4].trim() === '') { problems.push(`empty definition ${def[1]} at line ${n}`); continue; }
        if (!current) { problems.push(`orphan scenario ${def[1]} at line ${n}`); continue; }
        if (define('scenario', def[1], n)) {
          scenarios[def[1]] = { requirement: current, lines: [def[4].trim()], line: n, end: n };
          requirements[current].scenarios.push(def[1]);
          lastScenario = def[1];
        }
        continue;
      }
      if (SCENARIO_LIKE.test(body) || (def && numbered)) { problems.push(`unsupported scenario definition syntax at line ${n}; use "- **S-NN:** text"`); continue; }
      if (current) requirements[current].lines.push(line);
      continue;
    }
    if (lastScenario && line.trim() === '') { pending.push(line); continue; }
    const cont = lastScenario ? line.match(CONTINUATION) : null;
    if (cont) {
      const s = scenarios[lastScenario];
      while (pending.length) { pending.pop(); s.lines.push(''); }
      s.lines.push(rtrim(cont[1])); s.end = n; continue;
    }
    endScenario();
    if (current) requirements[current].lines.push(line);
  }
  if (fenceLine !== null) problems.push(`unclosed fence opened at line ${fenceLine}`);
  closeRequirement(rows.length + 1);
  if (!order.length) problems.push('no requirement definitions');
  if (problems.length) return { ok: false, problems };
  const inventory = { prd: prd || null, requirements: {}, scenarios: {} };
  for (const id of sortIds(order)) {
    const r = requirements[id];
    const text = normalizeBlock([r.title, ...r.lines]);
    inventory.requirements[id] = { title: r.title, text, digest: parse.sha256(`requirement ${id}\n${text}\n`), line: r.line, end: r.end, scenarios: sortIds(r.scenarios) };
  }
  for (const id of sortIds(Object.keys(scenarios))) {
    const s = scenarios[id];
    const text = rtrim(s.lines.join('\n'));
    inventory.scenarios[id] = { requirement: s.requirement, text, digest: parse.sha256(`scenario ${id}\n${text}\n`), line: s.line, end: s.end };
  }
  inventory.projection = projectionText(inventory);
  inventory.digest = parse.sha256(inventory.projection);
  return { ok: true, inventory };
}

// The exact inventory projection (each line terminated by \n).
function projectionText(inventory) {
  const lines = [`pincer inventory ${PROJECTION_VERSION}`, `prd ${inventory.prd}`];
  for (const id of sortIds(Object.keys(inventory.requirements))) lines.push(`requirement ${id} ${inventory.requirements[id].digest}`);
  for (const id of sortIds(Object.keys(inventory.scenarios))) lines.push(`scenario ${id} ${inventory.scenarios[id].requirement} ${inventory.scenarios[id].digest}`);
  return `${lines.join('\n')}\n`;
}

// Read and parse a PRD of the repository. Returns { ok, inventory } or
// { ok: false, code: 'INPUT_INVALID' | 'INVENTORY_INVALID', problems }.
function readInventory(root, prdRef) {
  const v = parse.validatePrd(root, prdRef);
  if (!v.ok) return { ok: false, code: 'INPUT_INVALID', problems: v.problems.map(p => `${prdRef}: ${p}`) };
  const result = parseInventory(v.text, { prd: prdRef });
  if (!result.ok) return { ok: false, code: 'INVENTORY_INVALID', problems: result.problems.map(p => `${prdRef}: ${p}`), prdResult: v };
  return { ok: true, inventory: result.inventory, prdResult: v };
}

// Recompute a snapshot inventory's projection from its own digests (readSnapshot).
function projectionOf({ prd, requirements, scenarios }) {
  return projectionText({ prd, requirements, scenarios });
}

// The snapshot shape (agreement snapshot schema 2 and evidence coverage/inventory.json).
function snapshotOf(inventory) {
  const requirements = {}, scenarios = {};
  for (const id of Object.keys(inventory.requirements)) { const r = inventory.requirements[id]; requirements[id] = { title: r.title, text: r.text, digest: r.digest, line: r.line, end: r.end, scenarios: [...r.scenarios] }; }
  for (const id of Object.keys(inventory.scenarios)) { const s = inventory.scenarios[id]; scenarios[id] = { requirement: s.requirement, text: s.text, digest: s.digest, line: s.line, end: s.end }; }
  return { digest: inventory.digest, projection: inventory.projection, requirements, scenarios };
}

// Validate a snapshot inventory read from a file: shape, per-definition digests
// recompute from the texts, the projection recomputes and hashes to `digest`.
// Returns null or a problem string.
function validateSnapshot(snap, prd) {
  const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const SHA = /^[0-9a-f]{64}$/;
  if (!isObject(snap)) return 'inventory must be an object';
  for (const k of ['digest', 'projection', 'requirements', 'scenarios']) if (!(k in snap)) return `inventory.${k} is missing`;
  for (const k of Object.keys(snap)) if (!['digest', 'projection', 'requirements', 'scenarios'].includes(k)) return `inventory.${k} is not allowed`;
  if (!isObject(snap.requirements) || !isObject(snap.scenarios)) return 'inventory.requirements and inventory.scenarios must be objects';
  for (const [id, r] of Object.entries(snap.requirements)) {
    if (!ID_RE.test(id) || !isObject(r) || typeof r.title !== 'string' || typeof r.text !== 'string' || !SHA.test(r.digest || '') || !Number.isInteger(r.line) || !Number.isInteger(r.end) || !Array.isArray(r.scenarios)) return `inventory.requirements[${id}] is malformed`;
    if (parse.sha256(`requirement ${id}\n${r.text}\n`) !== r.digest) return `requirement ${id} text does not hash to its recorded digest`;
    for (const s of r.scenarios) if (!snap.scenarios[s] || snap.scenarios[s].requirement !== id) return `requirement ${id} lists scenario ${s}, which is not its scenario`;
  }
  for (const [id, s] of Object.entries(snap.scenarios)) {
    if (!ID_RE.test(id) || !isObject(s) || typeof s.text !== 'string' || !SHA.test(s.digest || '') || !Number.isInteger(s.line) || !Number.isInteger(s.end) || !snap.requirements[s.requirement]) return `inventory.scenarios[${id}] is malformed`;
    if (parse.sha256(`scenario ${id}\n${s.text}\n`) !== s.digest) return `scenario ${id} text does not hash to its recorded digest`;
    if (!snap.requirements[s.requirement].scenarios.includes(id)) return `scenario ${id} is not listed by its requirement ${s.requirement}`;
  }
  const projection = projectionText({ prd, requirements: snap.requirements, scenarios: snap.scenarios });
  if (projection !== snap.projection) return 'the inventory projection does not recompute from its definitions';
  if (parse.sha256(projection) !== snap.digest) return 'the inventory digest does not match its projection';
  return null;
}

// Structural difference between two inventories (snapshots or computed): what
// impact and deletion detection read. Never a semantic judgment.
function difference(from, to) {
  const reqBefore = Object.keys(from.requirements), reqAfter = Object.keys(to.requirements);
  const scBefore = Object.keys(from.scenarios), scAfter = Object.keys(to.scenarios);
  const requirements = { added: sortIds(reqAfter.filter(id => !from.requirements[id])), removed: sortIds(reqBefore.filter(id => !to.requirements[id])), changed: [], unchanged: [] };
  for (const id of sortIds(reqAfter.filter(id => from.requirements[id]))) {
    const a = from.requirements[id], b = to.requirements[id];
    const parts = [];
    if (a.title !== b.title) parts.push('title');
    if (a.digest !== b.digest && a.text !== b.text) parts.push('text');
    if (JSON.stringify(sortIds(a.scenarios)) !== JSON.stringify(sortIds(b.scenarios))) parts.push('scenarios');
    if (parts.length) requirements.changed.push({ id, parts }); else requirements.unchanged.push(id);
  }
  const scenarios = { added: sortIds(scAfter.filter(id => !from.scenarios[id])), removed: sortIds(scBefore.filter(id => !to.scenarios[id])), changed: [], unchanged: [] };
  for (const id of sortIds(scAfter.filter(id => from.scenarios[id]))) {
    const a = from.scenarios[id], b = to.scenarios[id];
    const parts = [];
    if (a.digest !== b.digest) parts.push('text');
    if (a.requirement !== b.requirement) parts.push('requirement');
    if (parts.length) scenarios.changed.push({ id, parts }); else scenarios.unchanged.push(id);
  }
  return { same: from.digest === to.digest, requirements, scenarios };
}

module.exports = { PROJECTION_VERSION, ID, ID_RE, compareIds, sortIds, parseInventory, projectionText, projectionOf, readInventory, snapshotOf, validateSnapshot, difference, normalizeBlock };

// Convenience for callers that hold a file path rather than a repository.
module.exports.parseFile = (file, prd) => parseInventory(fs.readFileSync(file, 'utf8'), { prd: prd || path.basename(file) });
