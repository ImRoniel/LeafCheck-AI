'use strict';
// PINCER runtime — phase-specific coverage (docs/runtime-contracts.md, "Strict
// coverage" → "Phase-specific coverage"). One pure computation over the validated
// graph, consumed by `coverage`, `change complete`, `evidence export`, `ready`,
// status and resume: `structure` (every obligation linked or authorized as not
// delivered, nothing missing from the baseline), `implementation` (structure plus
// every ticket done and ready under the v5 rules) and `candidate` (the evaluated
// candidate's reconciled evidence). The three are separate fields; none implies
// another, and a linked check, a done ticket or a passing syntax check never
// becomes a delivery or adequacy verdict. A change without the capability is
// labeled `unverified`. Nothing here writes, launches or judges semantics.
const changes = require('./changes.cjs');
const routing = require('./routing.cjs');
const agreement = require('./agreement.cjs');
const authorization = require('./authorization.cjs');
const coverage = require('./coverage.cjs');
const dispositions = require('./dispositions.cjs');
const requirements = require('./requirements.cjs');
const locator = require('./locator.cjs');
const state = require('./state.cjs');
const fs = require('node:fs');
const path = require('node:path');

const STRUCTURE_ORDER = ['INPUT_INVALID', 'INVENTORY_INVALID', 'COVERAGE_INVALID', 'COVERAGE_INCOMPLETE', 'SCOPE_UNAUTHORIZED', 'OBLIGATION_MISSING'];
const byOrder = (a, b) => STRUCTURE_ORDER.indexOf(a.code) - STRUCTURE_ORDER.indexOf(b.code);

const unverified = reason => ({ strict: false, label: 'unverified', reason, inventory: null, map: null, graph: null, scope: [], structure: null, implementation: null, candidate: null, blockers: [] });

// compute(root, record, { gathered, verdict }) — `gathered` is status.render(...).gathered
// for the record (computed here when absent); `verdict` the authorization verdict.
function compute(root, record, { gathered = null, verdict = null } = {}) {
  if (!record) return unverified('no change record');
  if (!changes.isStrict(record)) return unverified(`strict coverage not adopted (node scripts/pincer-runtime.cjs coverage adopt --preview --change ${record.change})`);
  const out = { strict: true, label: 'strict', reason: null, inventory: null, map: null, graph: null, scope: [], structure: { complete: false, problems: [] }, implementation: { complete: false, scenarios: {}, problems: [] }, candidate: { evaluated: false, candidate: null, manifest: null, delivery: null, adequacy: null, scenarios: {}, problems: [] }, blockers: [] };
  const priorInventory = gid => agreement.inventoryOf(root, record, record.agreements.find(g => g.id === gid) || null);
  const cov = coverage.load(root, record, { priorInventory });
  out.inventory = cov.inventory ? { digest: cov.inventory.digest, requirements: Object.fromEntries(Object.entries(cov.inventory.requirements).map(([id, r]) => [id, { title: r.title, line: r.line, end: r.end, scenarios: r.scenarios }])), scenarios: Object.fromEntries(Object.entries(cov.inventory.scenarios).map(([id, s]) => [id, { requirement: s.requirement, line: s.line, end: s.end }])) } : null;
  out.map = cov.map ? { path: cov.map.file, digest: cov.map.digest, checks: Object.fromEntries(Object.entries(cov.map.map.checks).map(([id, c]) => [id, { kind: c.kind, required: c.required, declared: coverage.definitionDigest(c) }])) } : null;
  if (cov.code && cov.code !== 'COVERAGE_INCOMPLETE') {
    out.structure.problems = cov.problems.map(detail => ({ code: cov.code, detail, ids: [] }));
    out.blockers = out.structure.problems.map(p => ({ code: p.code, detail: p.detail }));
    return out;
  }
  out.graph = cov.graph;
  const v = verdict || authorization.verdict(root, record);
  const scope = dispositions.scopeProblems(record, cov.graph, v);
  out.scope = scope.resolved;
  const problems = [...cov.graph.problems, ...scope.problems, ...dispositions.obligationProblems(dispositions.baseline(root, record), cov.inventory, cov.map.map)].sort(byOrder);
  out.structure = { complete: problems.length === 0, problems };
  // Implementation: every in-scope scenario's tickets done and ready; every ticket of the change done and ready.
  const g = gathered || require('./status.cjs').render(root, { change: record.change }).gathered;
  // A fresh clone (no local attempt history) of a completed change validates the saved
  // candidate record only: a done ticket's missing local attempt is its stated limit, not
  // unfinished work. Before completion the v5 rule holds: a fresh clone must verify.
  const localUnavailable = !state.hasIndex(root) && record.lifecycle.state === 'completed';
  out.implementation.limitations = localUnavailable ? ['local verification history unavailable; done tickets rely on the saved candidate evidence until verified here'] : [];
  const ticketState = id => {
    const t = g && g.tickets ? g.tickets.find(x => x.fields.ticket === id) : null;
    if (!t) return { id, status: null, ready: false, code: 'EVIDENCE_MISSING', detail: 'no ticket file' };
    const r = g.computeReadiness(t);
    if (localUnavailable && t.fields.status === 'done' && !r.ready && r.reasons[0].code === 'EVIDENCE_MISSING') return { id, status: 'done', ready: true, code: null, detail: null, limitation: 'no local attempt history' };
    return { id, status: t.fields.status, ready: r.ready, code: r.ready ? null : r.reasons[0].code, detail: r.ready ? null : `${r.reasons[0].detail} — ${r.reasons[0].next}` };
  };
  const implProblems = [];
  const seen = new Set();
  for (const id of requirements.sortIds(Object.keys(cov.graph.scenarios))) {
    const s = cov.graph.scenarios[id];
    const tickets = s.tickets.map(ticketState);
    const unfinished = tickets.find(t => t.status !== 'done');
    const unverifiedT = tickets.find(t => t.status === 'done' && !t.ready);
    const state = unfinished ? 'unfinished' : unverifiedT ? 'unverified' : 'complete';
    const detail = unfinished ? `${unfinished.id} is ${unfinished.status || 'missing'}, not done` : unverifiedT ? `${unverifiedT.id} ${unverifiedT.code}: ${unverifiedT.detail}` : null;
    out.implementation.scenarios[id] = { scope: 'in-scope', requirement: s.requirement, implementation: state, tickets, checks: s.checks, detail };
    if (state !== 'complete' && !seen.has(detail)) { seen.add(detail); implProblems.push({ code: unfinished ? 'LIFECYCLE_BLOCKED' : unverifiedT.code, detail: `${id}: ${detail}`, ids: [id, (unfinished || unverifiedT).id] }); }
  }
  for (const id of requirements.sortIds(Object.keys(cov.graph.scope))) {
    const s = cov.graph.scope[id];
    out.implementation.scenarios[id] = { scope: s.disposition, requirement: s.requirement, implementation: 'not applicable', tickets: [], checks: [], detail: `${s.disposition} by decision ${s.decision}` };
  }
  // Enabling tickets and any other ticket of the change must be done and ready too.
  for (const id of Object.keys(cov.tickets || {})) {
    const t = ticketState(id);
    if (t.status === 'done' && t.ready) continue;
    const detail = t.status !== 'done' ? `${id} is ${t.status}, not done` : `${id} ${t.code}: ${t.detail}`;
    if (!implProblems.some(p => p.ids.includes(id))) implProblems.push({ code: t.status !== 'done' ? 'LIFECYCLE_BLOCKED' : t.code, detail, ids: [id] });
  }
  out.implementation.problems = implProblems;
  out.implementation.complete = out.structure.complete && implProblems.length === 0;
  candidateCoverage(root, record, out.candidate);
  // A missing or stale evaluation blocks only a completed change: before completion no candidate is expected.
  out.blockers = [...out.structure.problems, ...implProblems, ...(record.lifecycle.state === 'completed' ? out.candidate.problems : [])].map(p => ({ code: p.code, detail: p.detail }));
  return out;
}

// Candidate coverage: the change's latest evaluation (schema 3) reconciled by the
// locator, with per-scenario dispositions and the codes that block release.
function candidateCoverage(root, record, out) {
  const loc = locator.current(root, record);
  if (loc.state === 'missing') { out.problems = [{ code: 'EVIDENCE_MISSING', detail: 'candidate: not evaluated', ids: [] }]; return; }
  out.evaluated = true; out.candidate = loc.candidate || null; out.manifest = loc.manifest || null;
  let m = null;
  try { m = JSON.parse(fs.readFileSync(path.join(root, loc.manifest), 'utf8')); } catch { m = null; }
  const problems = [];
  if (loc.state === 'stale') problems.push({ code: 'CANDIDATE_STALE', detail: loc.text, ids: [] });
  if (!m || m.schema !== 3) { problems.push({ code: 'EVIDENCE_MISSING', detail: `candidate evidence is ${m && m.schema ? `schema ${m.schema}` : 'unreadable'}, not the strict schema 3; evaluate again`, ids: [] }); out.problems = problems; return; }
  const checkOf = Object.fromEntries((m.checks || []).filter(c => c && c.id).map(c => [c.id, c]));
  for (const row of m.scenarios || []) {
    if (!row || !row.id) continue;
    const checks = (row.checks || []).map(id => { const c = checkOf[id] || {}; return { id, kind: c.kind || null, required: c.required ?? null, result: c.result || null }; });
    const failing = checks.filter(c => c.required && c.result !== 'passed');
    out.scenarios[row.id] = { disposition: row.disposition, checks, detail: row.disposition === 'blocked' ? `blocked by ${failing.map(c => `${c.id} (${c.kind} ${c.result || 'missing'})`).join(', ') || 'a missing check'}` : row.disposition === 'delivered' ? 'every required check passed' : `${row.disposition} by decision ${row.decision} (${row.authorization || 'unauthorized'})` };
    for (const c of failing) problems.push({ code: c.kind === 'command' ? ({ failed: 'CHECK_FAILED', unverified: 'ATTEMPT_ERROR' }[c.result] || 'CHECK_FAILED') : 'REVIEW_MISSING', detail: `${row.id}: ${c.id} (${c.kind}) is ${c.result || 'missing'}`, ids: [row.id, c.id] });
  }
  out.delivery = m.delivery || null;
  out.adequacy = m.adequacy || null;
  if (!m.adequacy || m.adequacy.verdict !== 'adequate') problems.push({ code: 'ADEQUACY_REQUIRED', detail: m.adequacy ? `the reviewer judged the checks inadequate: ${m.adequacy.note}` : 'no adequacy judgment recorded', ids: [] });
  out.problems = problems;
}

// The first blocking problem for a phase, in the contract's order, or null.
function firstBlocker(report, phase) {
  if (!report.strict) return null;
  if (report.structure.problems.length) return report.structure.problems[0];
  if (phase === 'structure') return null;
  if (report.implementation.problems.length) return report.implementation.problems[0];
  if (phase === 'implementation') return null;
  return report.candidate.problems[0] || null;
}

// --- The coverage report (docs/runtime-contracts.md, "Coverage and impact commands") ------
const RUNTIME_CMD = 'node scripts/pincer-runtime.cjs';
// One ordered next action for a strict change: the first blocking code, else the
// phase that is due (verify/start/complete/evaluate/release), or nothing to do.
function nextAction(report, record, { verdict = null, running = [], selected = true } = {}) {
  const cmd = (action, command, extra = {}) => ({ action, command, ticket: null, check: null, decision: null, ...extra });
  if (!report.strict) return cmd('adopt strict coverage when wanted', `${RUNTIME_CMD} coverage adopt --preview --change ${record.change}`);
  const id = record.change;
  // Rules 2 and 3 outrank everything below, including the agreement verdict: a
  // historical change is never routed to execution or to authorization, and a
  // running attempt is waited for rather than raced.
  const ahead = routing.preface({ id, lifecycle: record.lifecycle, base: record.base, running });
  if (ahead) return { ...cmd(ahead.action, ahead.command), ...ahead };
  if (verdict && verdict.verdict !== 'current') {
    if (verdict.verdict === 'DECISION_REQUIRED') return cmd("record the user's decision", `${RUNTIME_CMD} change decide ${id} --resolve ${verdict.open[0]} --reference <text> --excerpt <text>`, { decision: verdict.open[0] });
    if (['AUTHORIZATION_REQUIRED', 'AGREEMENT_CHANGED'].includes(verdict.verdict)) return cmd("record the user's authorization of the current agreement", `${RUNTIME_CMD} change authorize ${id} --agreement ${verdict.current} --reference <text> --excerpt <text>`);
    if (verdict.verdict === 'COVERAGE_INVALID') return cmd('repair the coverage map', verdict.detail);
    if (verdict.verdict === 'INVENTORY_INVALID') return cmd('repair the PRD definitions', verdict.detail);
    return cmd('repair the agreement inputs', `${verdict.verdict}: ${verdict.detail}`);
  }
  const p = report.structure.problems[0];
  if (p) {
    if (p.code === 'INVENTORY_INVALID') return cmd('repair the PRD definitions', p.detail);
    if (p.code === 'COVERAGE_INVALID') return cmd('repair the coverage map', p.detail);
    if (p.code === 'COVERAGE_INCOMPLETE') return cmd('author the missing coverage rows, then authorize', `edit .prd/coverage/${id}.json: ${p.detail}; then ${RUNTIME_CMD} change authorize ${id} --agreement <digest> …`);
    if (p.code === 'SCOPE_UNAUTHORIZED') return cmd('record the scope decision and its user authorization', `${RUNTIME_CMD} change decide ${id} --summary <text> / --resolve D-NN …, then change authorize ${id} --agreement <digest> --decision D-NN …`, { decision: p.decision || null });
    if (p.code === 'OBLIGATION_MISSING') return cmd('restore the obligation, or record the decision and the removed tombstone', p.detail);
    return cmd('repair the coverage inputs', `${p.code}: ${p.detail}`);
  }
  const staged = routing.lifecycleAction({ id, lifecycle: record.lifecycle });
  if (staged) return { ...cmd(staged.action, staged.command), ...staged };
  const i = report.implementation.problems[0];
  if (i) {
    const ticket = i.ids.find(x => /^T-/.test(x)) || null;
    if (i.code === 'LIFECYCLE_BLOCKED' && ticket) return cmd(`finish ${ticket}`, `scripts/pincer-ticket.sh start ${ticket} → verify ${ticket} → done ${ticket}`, { ticket });
    if (ticket) return cmd(`re-verify ${ticket} (${i.code})`, `scripts/pincer-ticket.sh verify ${ticket}`, { ticket });
    return cmd('finish the mapped work', i.detail);
  }
  if (record.lifecycle.state === 'active') return cmd('complete the change', `${RUNTIME_CMD} change complete ${id}`);
  const c = report.candidate.problems[0];
  if (c) {
    const check = c.ids.find(x => /^C-/.test(x)) || null;
    if (c.code === 'EVIDENCE_MISSING' && !report.candidate.evaluated) return cmd('evaluate the candidate', '/pincer-evaluate (declare the candidate, run every declared check, record the reviews and the adequacy judgment, export)');
    if (['CHECK_FAILED', 'ATTEMPT_ERROR'].includes(c.code) && check) return cmd(`re-run ${check} and re-evaluate`, `${RUNTIME_CMD} check ${check} --candidate <sha>, then /pincer-evaluate`, { check });
    if (c.code === 'REVIEW_MISSING' && check) return cmd(`perform and record the review ${check}`, `record ${check} with its candidate-bound artifact in the draft, then /pincer-evaluate`, { check });
    if (c.code === 'ADEQUACY_REQUIRED') return cmd("record the reviewer's adequacy judgment", '/pincer-evaluate with adequacy { verdict, note } in the draft');
    return cmd('evaluate the candidate again', `${c.code}: ${c.detail}`);
  }
  return cmd('read-only release audit', '/pincer-release');
}

// report(root, record, { gathered, verdict, generated }) → coverage JSON schema 1.
function report(root, record, { gathered = null, verdict = null, generated = null, selected = true } = {}) {
  const authorization = require('./authorization.cjs');
  const running = record ? require('./transaction.cjs').runningAttempts(root, record.change) : [];
  const v = verdict || (record ? authorization.verdict(root, record) : null);
  const r = compute(root, record, { gathered, verdict: v });
  const reviewed = v && v.authorized && record ? (() => { const g = record.agreements.find(x => x.id === v.authorized.agreement); return g ? { agreement: g.id, authorization: v.authorized.id, digest: g.digest } : null; })() : null;
  const base = record && r.strict ? require('./dispositions.cjs').baseline(root, record) : null;
  const out = {
    schema: 1, runtime: changes.RUNTIME_STRICT, generated: generated || require('./fsutil.cjs').nowIso(), root, mode: 'changes', change: record ? record.change : null,
    strict: r.strict, label: r.label, reason: r.reason,
    inventory: r.inventory ? { digest: r.inventory.digest, requirements: Object.entries(r.inventory.requirements).map(([id, x]) => ({ id, title: x.title, line: x.line, end: x.end, scenarios: x.scenarios })), scenarios: Object.entries(r.inventory.scenarios).map(([id, x]) => ({ id, requirement: x.requirement, line: x.line, end: x.end })) } : null,
    map: r.map ? { path: r.map.path, digest: r.map.digest, checks: Object.entries(r.map.checks).map(([id, c]) => ({ id, ...c })) } : null,
    agreement: { current: v && v.current ? v.current : null, reviewed, verdict: v ? v.verdict : null },
    baseline: base ? { agreements: base.agreements, scenarios: Object.keys(base.scenarios) } : null,
    structure: r.structure, implementation: r.implementation, candidate: r.candidate, scope: r.scope,
    blockers: [
      ...(running.length ? [{ code: 'ATTEMPT_RUNNING', detail: `attempt ${running[0].id} of change ${record.change} is running${running[0].alive === false ? ' (its owner is no longer running)' : ''}` }] : []),
      ...(v && v.verdict !== 'current' ? [{ code: v.verdict, detail: v.detail }] : []), ...r.blockers],
    next: routing.qualify(nextAction(r, record, { verdict: v, running, selected }), { id: record ? record.change : null, selected }),
  };
  return out;
}

function render(j) {
  const lines = [];
  const short = s => (typeof s === 'string' ? s.slice(0, 12) : '—');
  lines.push(`PINCER coverage · ${j.generated} · ${j.root}`);
  lines.push(`Change     ${j.change || 'none'} · coverage ${j.label}${j.reason ? ` (${j.reason})` : ''}`);
  if (j.strict) {
    lines.push(`Agreement  current ${short(j.agreement.current)} · reviewed ${j.agreement.reviewed ? `${j.agreement.reviewed.agreement} (${j.agreement.reviewed.authorization}, ${short(j.agreement.reviewed.digest)})` : 'none'} · verdict ${j.agreement.verdict}`);
    lines.push(`Inventory  ${j.inventory ? `${j.inventory.requirements.length} requirement(s), ${j.inventory.scenarios.length} scenario(s) · ${short(j.inventory.digest)}` : 'unreadable'}`);
    lines.push(`Map        ${j.map ? `${j.map.path} · ${short(j.map.digest)} · checks ${j.map.checks.map(c => `${c.id} (${c.kind}${c.required ? ', required' : ''})`).join(', ')}` : 'unreadable'}`);
    lines.push(`Structure  ${j.structure.complete ? 'complete' : `incomplete: ${j.structure.problems.map(p => `${p.code} ${p.detail}`).join('; ')}`}`);
    const sc = Object.entries(j.implementation.scenarios);
    lines.push(`Implementation ${j.implementation.complete ? 'complete' : 'incomplete'} · ${sc.filter(([, s]) => s.implementation === 'complete').length}/${sc.filter(([, s]) => s.scope === 'in-scope').length} in-scope scenario(s) complete${sc.some(([, s]) => s.scope !== 'in-scope') ? ` · ${sc.filter(([, s]) => s.scope !== 'in-scope').map(([id, s]) => `${id} ${s.scope}`).join(', ')}` : ''}`);
    for (const [id, s] of sc) lines.push(`  ${id.padEnd(6)} ${s.scope === 'in-scope' ? s.implementation.padEnd(14) : s.scope.padEnd(14)} ${s.scope === 'in-scope' ? `tickets ${s.tickets.map(t => `${t.id} ${t.status || 'missing'}${t.ready ? '' : t.code ? ` (${t.code})` : ''}`).join(', ')} · checks ${s.checks.join(', ')}` : s.detail}${j.candidate.scenarios[id] ? ` · candidate ${j.candidate.scenarios[id].disposition}` : ''}`);
    const c = j.candidate;
    lines.push(`Candidate  ${c.evaluated ? `${c.candidate ? c.candidate.slice(0, 7) : '?'} · delivery original ${c.delivery ? c.delivery.original : '?'}, agreed ${c.delivery ? c.delivery.agreed : '?'} · adequacy ${c.adequacy ? `${c.adequacy.verdict} ("${c.adequacy.note}")` : 'not recorded'}` : 'not evaluated · adequacy: not recorded'}${c.problems.length ? ` · ${c.problems.map(p => `${p.code} ${p.detail}`).join('; ')}` : ''}`);
    if (j.scope.length) lines.push(`Scope      ${j.scope.map(s => `${s.id} ${s.disposition} by ${s.decision} (${s.authorization}; reviewer judgment: "${s.excerpt}" must support it)`).join('; ')}`);
  }
  lines.push(`Blockers   ${j.blockers.length ? j.blockers.map(b => `${b.code} ${b.detail}`).join('\n           ') : 'none'}`);
  lines.push(`Next       ${j.next.action}: ${j.next.command}`);
  return `${lines.join('\n')}\n`;
}

// A one-line summary for status and resume.
function summary(r) {
  if (!r.strict) return { strict: false, label: 'unverified', reason: r.reason, structure: null, implementation: null, candidate: null };
  const sc = Object.values(r.implementation.scenarios);
  return {
    strict: true, label: 'strict', reason: null,
    structure: { complete: r.structure.complete, problems: r.structure.problems.map(p => ({ code: p.code, detail: p.detail })) },
    implementation: { complete: r.implementation.complete, scenarios: { total: sc.length, complete: sc.filter(s => s.implementation === 'complete').length, unfinished: sc.filter(s => s.implementation === 'unfinished').length, unverified: sc.filter(s => s.implementation === 'unverified').length, dispositioned: sc.filter(s => s.scope !== 'in-scope').length } },
    candidate: r.candidate.evaluated ? { evaluated: true, delivery: r.candidate.delivery, adequacy: r.candidate.adequacy ? r.candidate.adequacy.verdict : null } : { evaluated: false, delivery: null, adequacy: null },
  };
}
function summaryLine(r, record) {
  if (!r.strict) return `Coverage unverified · ${r.reason}`;
  const s = summary(r);
  const reviewed = record && record.authorizations.length ? `${record.authorizations.at(-1).agreement} (${record.authorizations.at(-1).id})` : 'none';
  return `Coverage strict · agreement ${reviewed} · structure ${s.structure.complete ? 'complete' : `incomplete (${s.structure.problems[0].code})`} · implementation ${s.implementation.scenarios.complete}/${s.implementation.scenarios.total - s.implementation.scenarios.dispositioned} scenarios${s.implementation.scenarios.dispositioned ? ` (${s.implementation.scenarios.dispositioned} dispositioned)` : ''} · candidate ${s.candidate.evaluated ? `${s.candidate.delivery ? `delivery original ${s.candidate.delivery.original}, agreed ${s.candidate.delivery.agreed}` : 'delivery not recorded (evidence predates strict coverage)'}, adequacy ${s.candidate.adequacy || 'not recorded'}` : 'not evaluated'}`;
}

module.exports = { STRUCTURE_ORDER, compute, firstBlocker, nextAction, report, render, summary, summaryLine };
