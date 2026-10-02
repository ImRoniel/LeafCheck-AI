'use strict';
// PINCER runtime — structural impact (docs/runtime-contracts.md, "Strict coverage"
// → "Coverage and impact commands"). Compares the current authored inputs of a
// strict change with a retained agreement (`--from G-NN|A-NN`, else the latest
// authorization's agreement, else the latest agreement with an inventory) and
// reports added, removed, changed and unchanged requirements and scenarios, changed
// links, scope entries, declarations and tickets, the affected scenarios, tickets
// and checks with the reason each is included, dependency dependents separately,
// and unscoped PRD changes. History it cannot read is `unavailable`, never "no
// impact". Read-only and structural: it never judges semantics, approves, launches
// or rewrites anything, and it does not touch evidence freshness.
const changes = require('./changes.cjs');
const agreement = require('./agreement.cjs');
const coverage = require('./coverage.cjs');
const requirements = require('./requirements.cjs');
const parse = require('./parse.cjs');
const { nowIso } = require('./fsutil.cjs');

const SCHEMA = 1;
const FRESHNESS = 'a narrow impact is not permission to reuse evidence whose source identity changed';
const sortIds = requirements.sortIds;
const byNumber = (a, b) => Number(a.slice(2)) - Number(b.slice(2));
const setDiff = (before, after) => ({ added: sortIds(after.filter(x => !before.includes(x))), removed: sortIds(before.filter(x => !after.includes(x))) });

// Resolve the baseline entry. Returns { entry, authorization } or { reason }.
function baselineEntry(record, from) {
  const entryFor = gid => record.agreements.find(g => g.id === gid) || null;
  if (from) {
    if (/^A-[0-9]{2,6}$/.test(from)) {
      const a = record.authorizations.find(x => x.id === from);
      if (!a) return { reason: `no authorization ${from} on change ${record.change} (recorded: ${record.authorizations.map(x => x.id).join(', ') || 'none'})` };
      return { entry: entryFor(a.agreement), authorization: a.id };
    }
    if (/^G-[0-9]{2,6}$/.test(from)) {
      const g = entryFor(from);
      if (!g) return { reason: `no agreement ${from} on change ${record.change} (recorded: ${record.agreements.map(x => x.id).join(', ') || 'none'})` };
      const auth = record.authorizations.filter(a => a.agreement === g.id).map(a => a.id).pop() || null;
      return { entry: g, authorization: auth };
    }
    return { reason: `--from must name an agreement G-NN or an authorization A-NN (got ${from})` };
  }
  const latestAuth = record.authorizations.length ? record.authorizations[record.authorizations.length - 1] : null;
  if (latestAuth) return { entry: entryFor(latestAuth.agreement), authorization: latestAuth.id };
  for (let i = record.agreements.length - 1; i >= 0; i--) if (record.agreements[i].inventory) return { entry: record.agreements[i], authorization: null };
  return { reason: 'no retained agreement carries an inventory snapshot' };
}

// compute(root, record, { from }) → the impact report, or { code, problem } for invalid input.
function compute(root, record, { from = null } = {}) {
  const base = { schema: SCHEMA, runtime: changes.RUNTIME_STRICT, generated: nowIso(), root, change: record.change, baseline: null, current: null, verdict: 'unavailable', reason: null, requirements: null, scenarios: null, links: null, scope: null, checks: null, tickets: null, affected: null, unscoped: null, freshness: { note: FRESHNESS } };
  if (!changes.isStrict(record)) return { ...base, reason: `strict coverage not adopted by change ${record.change}; impact needs a retained inventory (node scripts/pincer-runtime.cjs coverage adopt --preview --change ${record.change})` };
  const now = agreement.compute(root, record);
  if (now.code) return { code: now.code, problem: now.problem };
  base.current = { digest: now.digest, inventory: now.inventory.digest, coverage: now.coverage.digest };
  const resolved = baselineEntry(record, from);
  if (resolved.reason) return { ...base, reason: resolved.reason };
  const entry = resolved.entry;
  if (!entry.inventory) return { ...base, baseline: { agreement: entry.id, authorization: resolved.authorization, recorded: entry.recorded, digest: entry.digest }, reason: `agreement ${entry.id} predates strict coverage (no inventory snapshot); the earliest comparable agreement is ${record.coverage.agreement}` };
  const snap = agreement.readSnapshot(root, record, entry);
  if (snap.code) return { ...base, baseline: { agreement: entry.id, authorization: resolved.authorization, recorded: entry.recorded, digest: entry.digest }, reason: `${snap.code}: ${snap.problem}` };
  const s = snap.snapshot;
  base.baseline = { agreement: entry.id, authorization: resolved.authorization, recorded: entry.recorded, digest: entry.digest };
  const baseMap = coverage.validateText(s.coverage.text, { change: record.change, prd: s.prd.path });
  if (baseMap.problem) return { ...base, reason: `the snapshot coverage map of ${entry.id} cannot be read: ${baseMap.problem}` };
  const curMap = now.graphInputs.map.map;
  const inv = requirements.difference(s.inventory, now.inventory);
  const scenarios = { added: inv.scenarios.added, removed: inv.scenarios.removed.map(id => ({ id, tombstone: Boolean(curMap.scope[id] && curMap.scope[id].disposition === 'removed') })), changed: inv.scenarios.changed, unchanged: inv.scenarios.unchanged };
  const reqs = inv.requirements;
  // Links: scenarios present in both maps whose tickets or checks changed.
  // Links: rows added or removed for a scenario, and scenarios present in both maps whose tickets or checks changed.
  const links = { added: sortIds(Object.keys(curMap.scenarios).filter(id => !baseMap.map.scenarios[id])), removed: sortIds(Object.keys(baseMap.map.scenarios).filter(id => !curMap.scenarios[id])), changed: [] };
  for (const id of sortIds(Object.keys(curMap.scenarios))) {
    const b = baseMap.map.scenarios[id];
    if (!b) continue;
    const t = setDiff(b.tickets, curMap.scenarios[id].tickets), c = setDiff(b.checks, curMap.scenarios[id].checks);
    if (t.added.length || t.removed.length || c.added.length || c.removed.length) links.changed.push({ id, tickets: t, checks: c });
  }
  const scope = { added: [], removed: [], changed: [] };
  for (const id of sortIds(Object.keys(curMap.scope))) { const b = baseMap.map.scope[id]; if (!b) scope.added.push({ id, disposition: curMap.scope[id].disposition }); else if (b.disposition !== curMap.scope[id].disposition || b.decision !== curMap.scope[id].decision || b.prior !== curMap.scope[id].prior) scope.changed.push({ id, from: b.disposition, to: curMap.scope[id].disposition }); }
  scope.removed = sortIds(Object.keys(baseMap.map.scope).filter(id => !curMap.scope[id]));
  const checks = { added: [], removed: [], changed: [] };
  for (const id of Object.keys(curMap.checks).sort()) {
    const b = baseMap.map.checks[id];
    if (!b) { checks.added.push(id); continue; }
    const parts = ['kind', 'command', 'timeout', 'cwd', 'obligation', 'required'].filter(k => b[k] !== curMap.checks[id][k]);
    if (parts.length) checks.changed.push({ id, parts });
  }
  checks.removed = Object.keys(baseMap.map.checks).filter(id => !curMap.checks[id]).sort();
  const tickets = { added: [], removed: [], changed: [] };
  const ticketDiff = agreement.difference(s, now);
  tickets.added = ticketDiff.tickets_added; tickets.removed = ticketDiff.tickets_removed;
  const changedTickets = new Map(ticketDiff.tickets_changed.map(t => [t.id, [...t.parts]]));
  for (const id of Object.keys(curMap.tickets).sort(byNumber)) {
    const b = baseMap.map.tickets[id];
    if (!b) { if (!tickets.added.includes(id)) changedTickets.set(id, [...(changedTickets.get(id) || []), 'classification']); continue; }
    if (b.role !== curMap.tickets[id].role || b.rationale !== curMap.tickets[id].rationale) changedTickets.set(id, [...(changedTickets.get(id) || []), 'classification']);
  }
  tickets.changed = [...changedTickets.entries()].sort(([a], [b]) => byNumber(a, b)).map(([id, parts]) => ({ id, parts }));
  // Affected: scenarios by text/owner change, link change, changed declaration or changed ticket, addition, or scope change.
  const affectedScenarios = new Map();
  const because = (id, why) => { if (!affectedScenarios.has(id)) affectedScenarios.set(id, []); if (!affectedScenarios.get(id).includes(why)) affectedScenarios.get(id).push(why); };
  for (const c of scenarios.changed) because(c.id, `scenario ${c.parts.join(' and ')} changed`);
  for (const id of scenarios.added) because(id, 'scenario added');
  for (const l of links.changed) because(l.id, 'links changed');
  for (const id of links.added) if (!scenarios.added.includes(id)) because(id, 'links added (a row the baseline lacked)');
  for (const id of links.removed) if (curMap.scenarios[id] || inv.scenarios.unchanged.includes(id) || inv.scenarios.changed.some(c => c.id === id)) because(id, 'links removed (the row is gone)');
  for (const e of [...scope.added, ...scope.changed]) because(e.id, `scope disposition ${e.to ? `changed to ${e.to}` : e.disposition}`);
  for (const id of scope.removed) if (curMap.scenarios[id]) because(id, 'scope disposition removed (back in scope)');
  for (const [id, row] of Object.entries(curMap.scenarios)) {
    for (const c of checks.changed) if (row.checks.includes(c.id)) because(id, `declaration of ${c.id} changed (${c.parts.join(', ')})`);
    for (const t of tickets.changed) if (row.tickets.includes(t.id)) because(id, `ticket ${t.id} changed (${t.parts.join(', ')})`);
  }
  const affectedTickets = new Map(), affectedChecks = new Map();
  const add = (map, id, why) => { if (!map.has(id)) map.set(id, []); if (!map.get(id).includes(why)) map.get(id).push(why); };
  for (const id of sortIds([...affectedScenarios.keys()])) {
    const row = curMap.scenarios[id];
    if (!row) continue;
    for (const t of row.tickets) add(affectedTickets, t, `linked from ${id}`);
    for (const c of row.checks) add(affectedChecks, c, `linked from ${id}`);
  }
  for (const t of tickets.changed) add(affectedTickets, t.id, `ticket ${t.parts.join(', ')} changed`);
  for (const c of checks.changed) add(affectedChecks, c.id, `declaration changed (${c.parts.join(', ')})`);
  // Dependents: tickets of the change that depend (transitively) on an affected ticket and are not affected themselves.
  const dependents = [];
  const fields = Object.fromEntries(Object.entries(now.graphInputs.tickets || {}).map(([id, t]) => [id, parse.dependencies(t.fields)]));
  const allTickets = Object.keys(now.tickets);
  const deps = id => (fields[id] || (now.tickets[id] ? parse.dependencies(parse.validateTicket(now.tickets[id].file, now.tickets[id].text).fields) : []));
  const affectedSet = new Set(affectedTickets.keys());
  let grew = true; const dependentVia = new Map();
  while (grew) {
    grew = false;
    for (const id of allTickets) {
      if (affectedSet.has(id) || dependentVia.has(id)) continue;
      const via = deps(id).find(d => affectedSet.has(d) || dependentVia.has(d));
      if (via) { dependentVia.set(id, via); grew = true; }
    }
  }
  for (const [id, via] of [...dependentVia.entries()].sort(([a], [b]) => byNumber(a, b))) dependents.push({ id, via, because: 'depends_on' });
  const definitionsUnchanged = inv.same;
  const unscoped = { prd: Boolean(ticketDiff.prd_changed && definitionsUnchanged), detail: ticketDiff.prd_changed && definitionsUnchanged ? 'unscoped PRD change requiring review: the PRD revision changed while every requirement and scenario definition is unchanged (a constraint, table or note outside the definitions)' : ticketDiff.prd_changed ? 'the PRD revision changed together with its definitions; review the prose outside the definitions too' : null };
  const same = entry.digest === now.digest;
  return {
    ...base, verdict: same ? 'unchanged' : 'changed', reason: same ? null : unscoped.prd && !links.changed.length && !checks.changed.length && !tickets.changed.length && !scope.added.length && !scope.changed.length && !scope.removed.length ? unscoped.detail : null,
    requirements: reqs, scenarios, links, scope, checks, tickets,
    affected: { scenarios: sortIds([...affectedScenarios.keys()]).map(id => ({ id, because: affectedScenarios.get(id) })), tickets: [...affectedTickets.keys()].sort(byNumber).map(id => ({ id, because: affectedTickets.get(id) })), checks: [...affectedChecks.keys()].sort().map(id => ({ id, because: affectedChecks.get(id) })), dependents },
    unscoped,
  };
}

function render(r) {
  const lines = [];
  lines.push(`PINCER impact · ${r.generated} · ${r.root}`);
  lines.push(`Change     ${r.change}${r.current ? ` · current agreement ${r.current.digest.slice(0, 12)} (inventory ${r.current.inventory.slice(0, 12)}, coverage ${r.current.coverage.slice(0, 12)})` : ''}`);
  lines.push(`Baseline   ${r.baseline ? `${r.baseline.agreement}${r.baseline.authorization ? ` (authorized by ${r.baseline.authorization})` : ' (not authorized)'} recorded ${r.baseline.recorded} · ${r.baseline.digest.slice(0, 12)}` : 'none'}`);
  lines.push(`Verdict    ${r.verdict}${r.reason ? ` — ${r.reason}` : ''}`);
  if (r.verdict === 'unavailable') { lines.push(`Freshness  ${r.freshness.note}`); return `${lines.join('\n')}\n`; }
  const list = (label, items, fmt = x => x) => { if (items.length) lines.push(`${label.padEnd(10)} ${items.map(fmt).join(', ')}`); };
  list('Requirements added', r.requirements.added); list('Requirements removed', r.requirements.removed);
  list('Requirements changed', r.requirements.changed, c => `${c.id} (${c.parts.join(', ')})`);
  list('Scenarios added', r.scenarios.added); list('Scenarios removed', r.scenarios.removed, s => `${s.id}${s.tombstone ? ' (tombstone)' : ' (no tombstone)'}`);
  list('Scenarios changed', r.scenarios.changed, c => `${c.id} (${c.parts.join(', ')})`);
  list('Links added', r.links.added); list('Links removed', r.links.removed);
  list('Links changed', r.links.changed, l => `${l.id} (tickets +${l.tickets.added.join(' ') || '—'} -${l.tickets.removed.join(' ') || '—'}; checks +${l.checks.added.join(' ') || '—'} -${l.checks.removed.join(' ') || '—'})`);
  list('Scope added', r.scope.added, s => `${s.id} (${s.disposition})`); list('Scope removed', r.scope.removed); list('Scope changed', r.scope.changed, s => `${s.id} (${s.from} → ${s.to})`);
  list('Checks added', r.checks.added); list('Checks removed', r.checks.removed); list('Checks changed', r.checks.changed, c => `${c.id} (${c.parts.join(', ')})`);
  list('Tickets added', r.tickets.added); list('Tickets removed', r.tickets.removed); list('Tickets changed', r.tickets.changed, t => `${t.id} (${t.parts.join(', ')})`);
  lines.push(`Unchanged  ${r.requirements.unchanged.length} requirement(s), ${r.scenarios.unchanged.length} scenario(s)${r.scenarios.unchanged.length ? `: ${r.scenarios.unchanged.join(', ')}` : ''}`);
  lines.push(`Affected   scenarios ${r.affected.scenarios.map(s => `${s.id} [${s.because.join('; ')}]`).join(', ') || 'none'}`);
  lines.push(`           tickets ${r.affected.tickets.map(t => `${t.id} [${t.because.join('; ')}]`).join(', ') || 'none'}`);
  lines.push(`           checks ${r.affected.checks.map(c => `${c.id} [${c.because.join('; ')}]`).join(', ') || 'none'}`);
  lines.push(`Dependents ${r.affected.dependents.map(d => `${d.id} (via ${d.via}, ${d.because})`).join(', ') || 'none'}`);
  lines.push(`Unscoped   ${r.unscoped.prd ? 'yes' : 'no'}${r.unscoped.detail ? ` — ${r.unscoped.detail}` : ''}`);
  lines.push(`Freshness  ${r.freshness.note}`);
  return `${lines.join('\n')}\n`;
}

module.exports = { SCHEMA, FRESHNESS, baselineEntry, compute, render };
