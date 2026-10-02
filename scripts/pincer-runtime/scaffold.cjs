'use strict';
// PINCER runtime — the coverage draft (docs/runtime-contracts.md, "Coverage draft").
// `coverage scaffold --change <id>` projects the validated PRD inventory, the change's
// tickets and any authored map into one reviewable draft. It exists because authoring
// `.prd/coverage/<id>.json` means transcribing every live scenario, every ticket role
// and every check declaration out of documents the runtime has already parsed; that
// transcription is the measured cost this removes (docs/prd-v7-pilots.md).
//
// What it must never do is decide. The draft carries no semantic judgment: an
// unresolved scenario stays unresolved, a check command is never invented, a ticket
// role is never guessed, and a scope disposition is never chosen. Candidate tickets
// and their existing verification text are listed as *material to read*, with their
// file provenance, never promoted into a link or a declaration.
//
// The envelope is `draft: 1` with no `schema` key, so `coverage.validateMap` refuses
// it: a draft written to disk is not a coverage map and cannot become one by being
// saved. The real map is authored by hand, validated by `coverage`, adopted by
// `coverage adopt` and authorized by `change authorize`, exactly as before.
//
// Pure and read-only: nothing here writes a file, launches a check, changes a
// selection or records an approval. The draft body carries no timestamp, so two calls
// on identical authored inputs produce byte-identical output.
const fs = require('node:fs');
const path = require('node:path');
const parse = require('./parse.cjs');
const requirements = require('./requirements.cjs');
const coverage = require('./coverage.cjs');

const DRAFT = 1;
const KIND = 'coverage-draft';
const RUNTIME = 'node scripts/pincer-runtime.cjs';
// Unresolved codes, in report order. These describe the draft, not the runtime state:
// they say what a human still has to author, never what a gate will refuse.
const UNRESOLVED_ORDER = ['SCENARIO_UNLINKED', 'CHECK_UNDECLARED', 'TICKET_UNCLASSIFIED', 'SCENARIO_STALE', 'TICKET_FOREIGN'];

const AUTHORED = 'authored';
const UNRESOLVED = 'unresolved';

// The first line under a ticket heading, used as the objective a reviewer reads.
function firstLine(text, heading) {
  const rows = parse.lines(text);
  const i = rows.findIndex(l => l.trim() === heading);
  if (i === -1) return null;
  const next = rows.slice(i + 1).find(l => l.trim() !== '');
  return next ? next.trim() : null;
}
// The IDs a ticket's own Context section claims ("- Implements: R-04." and
// "- Scenarios: S-10, S-11."). Classified against the live inventory rather than by
// prefix, because tickets name other tickets on the same lines — T-03 of the strict
// fixture says "Implements: none (enables T-01, T-02)", and reading that as two
// scenario claims would be the draft inventing a link out of prose. An ID the
// inventory does not define is not reported at all.
const CLAIM_LINE = /^[ \t]*[-+*][ \t]+(?:Implements|Scenarios|Requirements):/;
function claimsOf(text, inventory) {
  const ids = new Set();
  for (const row of parse.lines(text)) {
    if (!CLAIM_LINE.test(row)) continue;
    for (const id of row.match(new RegExp(requirements.ID, 'g')) || []) ids.add(id);
  }
  const claimed = [...ids];
  return {
    requirements: requirements.sortIds(claimed.filter(id => inventory.requirements[id])),
    scenarios: requirements.sortIds(claimed.filter(id => inventory.scenarios[id])),
  };
}
// The ticket's own Verification fence, verbatim, as provenance for a reviewer. It is
// quoted, never turned into a check declaration: whether it proves the scenario is a
// judgment the draft does not make.
function verificationOf(text) {
  const commands = parse.verificationCommands(text);
  return commands && commands.length ? commands.join('\n') : null;
}

// build(root, record) → { ok, code, problems, draft }
// `code` is set only when the inputs cannot be read; a missing map is the normal case
// this command exists for, not an error.
function build(root, record) {
  const fail = (code, problems) => ({ ok: false, code, problems, draft: null });
  const inv = requirements.readInventory(root, record.prd);
  if (!inv.ok) return fail(inv.code, inv.problems);
  const inventory = inv.inventory;

  // An absent map is expected; an unreadable one is not — silently dropping authored
  // content would be the one way this command could destroy work.
  const rel = coverage.file(record.change);
  const real = coverage.realFile(root, rel);
  let authored = null;
  if (!real) {
    const m = coverage.readMap(root, record);
    if (!m.ok) return fail(m.code, m.problems);
    authored = m;
  } else if (!real.endsWith(': missing')) {
    return fail('COVERAGE_INVALID', [`${rel}: ${real.slice(rel.length + 2)}`]);
  }

  const t = coverage.ticketsOf(root, record);
  if (!t.ok) return fail(t.code, t.problems);

  const map = authored ? authored.map : null;
  const unresolved = [];
  const note = (code, id, detail) => unresolved.push({ code, id, detail });

  // --- scenarios: every live scenario exactly once, authored rows preserved ----------
  const scenarios = {};
  const scope = {};
  for (const id of requirements.sortIds(Object.keys(inventory.scenarios))) {
    const live = inventory.scenarios[id];
    const authoredScope = map && map.scope ? map.scope[id] : null;
    if (authoredScope) {
      scope[id] = { ...authoredScope, state: AUTHORED };
      continue;
    }
    const row = map && map.scenarios ? map.scenarios[id] : null;
    const tickets = row ? [...row.tickets] : [];
    const checks = row ? [...row.checks] : [];
    const resolved = Boolean(row) && tickets.length > 0 && checks.length > 0;
    scenarios[id] = { requirement: live.requirement, state: resolved ? AUTHORED : UNRESOLVED, tickets, checks };
    if (!row) note('SCENARIO_UNLINKED', id, `${id} (${live.requirement}) has no row in scenarios or scope`);
    else if (!tickets.length) note('SCENARIO_UNLINKED', id, `${id} is linked to no ticket`);
    else if (!checks.length) note('CHECK_UNDECLARED', id, `${id} is linked to no check`);
  }
  // A map row naming a scenario the inventory no longer defines is authored content:
  // it is preserved and flagged, never deleted, because removing an obligation is a
  // decision with its own disposition and authorization.
  if (map) {
    for (const id of requirements.sortIds(Object.keys(map.scenarios))) {
      if (scenarios[id] || scope[id]) continue;
      scenarios[id] = { requirement: null, state: UNRESOLVED, tickets: [...map.scenarios[id].tickets], checks: [...map.scenarios[id].checks] };
      note('SCENARIO_STALE', id, `${id} has a row but is not a scenario of ${record.prd}`);
    }
    for (const id of requirements.sortIds(Object.keys(map.scope))) {
      if (scope[id] || inventory.scenarios[id]) continue;
      scope[id] = { ...map.scope[id], state: UNRESOLVED };
      note('SCENARIO_STALE', id, `${id} has a scope row but is not a scenario of ${record.prd}`);
    }
  }

  // --- tickets: authored roles preserved; unclassified tickets named, not classified --
  const tickets = {};
  for (const id of requirements.sortIds(Object.keys(t.tickets))) {
    const row = map && map.tickets ? map.tickets[id] : null;
    if (row) tickets[id] = { role: row.role, rationale: row.rationale, state: AUTHORED };
    else {
      tickets[id] = { role: null, rationale: null, state: UNRESOLVED };
      note('TICKET_UNCLASSIFIED', id, `${id} has no role; classify it as implements or enables (an enabling ticket needs a rationale)`);
    }
  }
  if (map) {
    for (const id of requirements.sortIds(Object.keys(map.tickets))) {
      if (tickets[id]) continue;
      tickets[id] = { role: map.tickets[id].role, rationale: map.tickets[id].rationale, state: UNRESOLVED };
      note(t.others[id] ? 'TICKET_FOREIGN' : 'SCENARIO_STALE', id,
        t.others[id] ? `${id} is a ticket of ${t.others[id]}, not of ${record.prd}` : `${id} has a row but no ticket file is associated with ${record.prd}`);
    }
  }

  // --- checks: authored declarations preserved verbatim; none invented ---------------
  const checks = {};
  if (map) for (const id of Object.keys(map.checks).sort()) checks[id] = { ...map.checks[id], state: AUTHORED };
  // Every check a scenario links to must be declared; an undeclared one is named.
  for (const [sid, row] of Object.entries(scenarios)) {
    for (const c of row.checks) {
      if (checks[c]) continue;
      note('CHECK_UNDECLARED', c, `${c} is linked from ${sid} but has no declaration`);
    }
  }

  // --- candidates: material to read, with provenance. Never a link. -----------------
  const candidates = { tickets: {} };
  for (const id of requirements.sortIds(Object.keys(t.tickets))) {
    const entry = t.tickets[id];
    const claims = claimsOf(entry.text, inventory);
    candidates.tickets[id] = {
      file: entry.file,
      objective: firstLine(entry.text, '## Objective'),
      implements: claims.requirements,
      scenarios: claims.scenarios,
      verification: verificationOf(entry.text),
    };
  }

  unresolved.sort((a, b) => (UNRESOLVED_ORDER.indexOf(a.code) - UNRESOLVED_ORDER.indexOf(b.code)) || requirements.compareIds(a.id, b.id));
  const draft = {
    draft: DRAFT,
    kind: KIND,
    change: record.change,
    prd: record.prd,
    inventory: { digest: inventory.digest, requirements: Object.keys(inventory.requirements).length, scenarios: Object.keys(inventory.scenarios).length },
    authored: { map: authored ? authored.file : null, digest: authored ? authored.digest : null },
    scenarios, scope, tickets, checks, candidates, unresolved,
    next: nextAction(record, unresolved, authored),
  };
  return { ok: true, code: null, problems: [], draft };
}

// What the reader does next. A complete draft does not adopt anything: it says the map
// is ready to be reviewed and validated, which is a different claim from "correct".
function nextAction(record, unresolved, authored) {
  if (unresolved.length) {
    const first = unresolved[0];
    return { action: `author the unresolved entries (${unresolved.length}), starting with ${first.id}`, command: `edit ${coverage.file(record.change)} — ${first.detail}` };
  }
  if (!authored) return { action: 'author the map from this draft, then validate it', command: `edit ${coverage.file(record.change)}, then ${RUNTIME} coverage --change ${record.change}` };
  return { action: 'review the authored map, then preview adoption', command: `${RUNTIME} coverage adopt --preview --change ${record.change}` };
}

function render(d) {
  const lines = [];
  const count = o => Object.keys(o).length;
  lines.push(`PINCER coverage draft · change ${d.change} · ${d.prd}`);
  lines.push(`Inventory  ${d.inventory.requirements} requirement(s), ${d.inventory.scenarios} scenario(s) · digest ${d.inventory.digest.slice(0, 12)}`);
  lines.push(`Authored   ${d.authored.map ? `${d.authored.map} · digest ${d.authored.digest.slice(0, 12)}` : 'no map yet'}`);
  lines.push('');
  lines.push(`Scenarios  ${count(d.scenarios)} linked row(s), ${count(d.scope)} scope row(s)`);
  for (const [id, s] of Object.entries(d.scenarios)) {
    const marker = s.state === AUTHORED ? ' ' : '?';
    lines.push(`  ${marker} ${id}  ${s.requirement || '(not in the inventory)'}  tickets ${s.tickets.length ? s.tickets.join(', ') : '—'}  checks ${s.checks.length ? s.checks.join(', ') : '—'}`);
  }
  for (const [id, s] of Object.entries(d.scope)) {
    lines.push(`  ${s.state === AUTHORED ? ' ' : '?'} ${id}  scope: ${s.disposition}${s.decision ? ` (${s.decision})` : ''}${s.note ? ` — ${s.note}` : ''}`);
  }
  lines.push('');
  lines.push(`Tickets    ${count(d.tickets)}`);
  for (const [id, t] of Object.entries(d.tickets)) {
    const c = d.candidates.tickets[id];
    lines.push(`  ${t.state === AUTHORED ? ' ' : '?'} ${id}  role ${t.role || '—'}${t.rationale ? ` (${t.rationale})` : ''}${c && c.objective ? `  · ${c.objective}` : ''}`);
    if (t.state !== AUTHORED && c) {
      const claimed = [...c.implements, ...c.scenarios];
      if (claimed.length) lines.push(`      the ticket says it implements ${claimed.join(', ')} (${c.file}) — a statement to check, not a link`);
      if (c.verification) lines.push(`      its Verification block runs: ${c.verification.split('\n')[0]}${c.verification.includes('\n') ? ' …' : ''}`);
    }
  }
  lines.push('');
  lines.push(`Checks     ${count(d.checks)}`);
  for (const [id, c] of Object.entries(d.checks)) {
    lines.push(`  ${c.state === AUTHORED ? ' ' : '?'} ${id}  ${c.kind}${c.required ? ', required' : ''}  ${c.kind === 'command' ? c.command : c.obligation}`);
  }
  if (!count(d.checks)) lines.push('    none declared — a check is authored, never derived from a ticket');
  lines.push('');
  if (d.unresolved.length) {
    lines.push(`Unresolved ${d.unresolved.length}`);
    for (const u of d.unresolved) lines.push(`  ${u.code}  ${u.detail}`);
  } else {
    lines.push('Unresolved none — every scenario has a row, every ticket a role, every linked check a declaration');
  }
  lines.push('');
  lines.push('This is a draft, not a coverage map: it carries no schema, and `coverage`,');
  lines.push('`coverage adopt` and the agreement digest do not accept it. Author');
  lines.push(`${coverage.file(d.change)} yourself, review the links, then validate and adopt it.`);
  lines.push(`Next       ${d.next.action}: ${d.next.command}`);
  return `${lines.join('\n')}\n`;
}

module.exports = { DRAFT, KIND, UNRESOLVED_ORDER, AUTHORED, UNRESOLVED, build, render, nextAction };
