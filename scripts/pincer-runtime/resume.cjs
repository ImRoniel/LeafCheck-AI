'use strict';
// PINCER runtime — the resume report (docs/runtime-contracts.md, "Resume
// report"). Read-only inspection of the selected (or named) change for a fresh
// session: identity, lifecycle, repository view, agreement and authorization,
// decisions, references to the authored artifacts, tickets and attempts, the
// candidate, the authored handoff (labeled, never an input), the blockers in
// gate order and one next action chosen by the documented precedence. Distinct
// from `change resume`, the lifecycle operation. Launches nothing, writes nothing.
const fs = require('node:fs');
const path = require('node:path');
const parse = require('./parse.cjs');
const changes = require('./changes.cjs');
const agreement = require('./agreement.cjs');
const status = require('./status.cjs');
const state = require('./state.cjs');
const transaction = require('./transaction.cjs');
const gates = require('./gates.cjs');

// Resume JSON schema 2 (PRD v6): schema 1 plus the strict coverage summary; the
// coverage codes join rule 4 of the next-action precedence.
const SCHEMA = 2;
const STATE_CODES = ['INPUT_INVALID', 'MALFORMED', 'UNSUPPORTED_SCHEMA', 'HISTORY_INVALID', 'STATE_INCOMPLETE'];
const COVERAGE_CODES = ['INVENTORY_INVALID', 'COVERAGE_INVALID', 'COVERAGE_INCOMPLETE', 'OBLIGATION_MISSING', 'SCOPE_UNAUTHORIZED'];
const CANDIDATE_COVERAGE_CODES = ['REVIEW_MISSING', 'ADEQUACY_REQUIRED'];
const phases = require('./phases.cjs');
const routing = require('./routing.cjs');
const SELECTION_CODES = ['SELECTION_REQUIRED', 'SELECTION_INVALID'];
const AGREEMENT_CODES = ['DECISION_REQUIRED', 'AUTHORIZATION_REQUIRED', 'AGREEMENT_CHANGED'];
const RUNTIME = 'node scripts/pincer-runtime.cjs';

const firstLine = (text, heading) => {
  const rows = parse.lines(text);
  const i = rows.findIndex(l => l.trim() === heading);
  if (i === -1) return null;
  const next = rows.slice(i + 1).find(l => l.trim() !== '');
  return next ? next.trim() : null;
};
const title = text => { const m = parse.lines(text).find(l => /^# /.test(l)); return m ? m.replace(/^# /, '').trim() : null; };

// build(root, { change }) → { json, blockers, next, gathered } — the whole report.
function build(root, { change = null } = {}) {
  const st = status.render(root, { change });
  const j = st.json;
  const generated = j.generated;
  const report = { schema: SCHEMA, runtime: changes.RUNTIME_STRICT, generated, root, mode: j.mode, selection: null, change: null, agreement: null, references: null, tickets: [], attempts: [], candidate: null, coverage: j.coverage || { strict: false, label: 'unverified', reason: null, structure: null, implementation: null, candidate: null, next: null }, handoff: null, blockers: [], next: null };
  const blockers = [];
  const push = (code, detail) => { if (!blockers.some(b => b.code === code && b.detail === detail)) blockers.push({ code, detail }); };
  if (j.mode !== 'changes') {
    report.selection = { change: null, problem: { code: j.mode === 'invalid' ? 'INPUT_INVALID' : 'CHANGE_REQUIRED', detail: j.mode === 'legacy' ? 'this project keeps no change records; register with: node scripts/pincer-runtime.cjs register --prd .prd/prd-vN.md' : j.mode === 'migrated' ? 'this project keeps a v0.5.0 binding; migrate it with: node scripts/pincer-runtime.cjs migrate --preview --prd <prd>' : (j.reasons[0] ? j.reasons[0].detail : 'unreadable change records') } };
    push(report.selection.problem.code, report.selection.problem.detail);
    report.blockers = blockers;
    report.next = { action: 'repair or migrate', command: report.selection.problem.detail.replace(/^.*?: /, ''), ticket: null, check: null, rule: 1 };
    return { json: report, text: render(report), exit: st.exit };
  }
  report.selection = j.selection;
  // Rule 1: invalid or missing state, or no usable selection.
  for (const r of j.reasons) if (STATE_CODES.includes(r.code)) push(r.code, r.detail);
  if (!j.change) {
    const problem = j.selection.problem || (j.reasons[0] ? j.reasons[0] : { code: 'SELECTION_REQUIRED', detail: 'no change selected' });
    push(problem.code, problem.detail);
    report.blockers = blockers;
    const first = blockers[0];
    report.next = STATE_CODES.includes(first.code)
      ? { action: first.code === 'STATE_INCOMPLETE' ? 'complete the interrupted transaction' : 'repair the change records by hand', command: first.code === 'STATE_INCOMPLETE' ? `${RUNTIME} recover` : `${RUNTIME} change list`, ticket: null, check: null, rule: 1 }
      : { action: 'select the change to work on', command: `${RUNTIME} change select <id>`, ticket: null, check: null, rule: 1 };
    return { json: report, text: render(report), exit: st.exit };
  }
  const id = j.change.id;
  const resolved = changes.resolveSelected(root, { change: id });
  const record = resolved.record;
  report.change = { id, prd: j.change.prd, prd_revision: j.change.prd_revision, base: j.change.base, registered: record ? record.registered : null, sequence: j.change.sequence, lifecycle: j.change.lifecycle, view: j.change.view };
  const ag = j.change.agreement;
  report.agreement = {
    current: ag.current,
    authorized: ag.authorized ? { ...ag.authorized, reference: (record.authorizations.find(a => a.id === ag.authorized.id) || {}).reference || null, excerpt: (record.authorizations.find(a => a.id === ag.authorized.id) || {}).excerpt || null, constraints: (record.authorizations.find(a => a.id === ag.authorized.id) || {}).constraints || null } : null,
    verdict: ag.verdict, difference: ag.difference,
    decisions: { open: record.decisions.filter(d => d.status === 'open').map(d => ({ id: d.id, summary: d.summary, raised: d.raised })), resolved: record.decisions.filter(d => d.status === 'resolved').map(d => ({ id: d.id, summary: d.summary, reference: d.reference, resolved: d.resolved })) },
  };
  // References: the authored artifacts the agreement is read from (titles and first lines only).
  let prdText = null;
  try { prdText = fs.readFileSync(path.join(root, record.prd), 'utf8'); } catch { prdText = null; }
  const authorizedEntry = ag.authorized ? record.agreements.find(g => g.id === ag.authorized.agreement) : null;
  report.references = {
    prd: { path: record.prd, title: prdText ? title(prdText) : null },
    snapshot: authorizedEntry ? authorizedEntry.snapshot : null,
    tickets: (st.gathered && st.gathered.tickets ? st.gathered.tickets : []).map(t => ({ id: t.fields.ticket, file: t.file, objective: firstLine(t.text, '## Objective') })),
  };
  report.tickets = j.tickets;
  const idx = state.exists(root) ? state.readIndex(root) : { index: null };
  if (idx.index) {
    for (const t of j.tickets) {
      const key = state.contextKey({ kind: 'ticket', change: id, ticket: t.id });
      for (const a of state.listAttempts(root, key)) report.attempts.push({ ticket: t.id, check: null, id: a.id, outcome: a.outcome, started: a.started, finished: a.finished, current: idx.index.current[key] === a.id });
    }
    if (j.candidate && j.candidate.evaluation) {
      for (const a of state.listAttempts(root)) {
        if (a.context && a.context.kind === 'candidate' && a.context.change === id && a.context.candidate === j.candidate.evaluation.candidate) {
          const key = state.contextKey({ ...a.context, mode: 'changes' });
          report.attempts.push({ ticket: null, check: a.context.check, id: a.id, outcome: a.outcome, started: a.started, finished: a.finished, current: idx.index.current[key] === a.id });
        }
      }
    }
  }
  report.candidate = j.candidate;
  const lc = record.lifecycle;
  report.handoff = lc.reason || lc.note ? { kind: record.events.filter(e => ['pause', 'reopen'].includes(e.kind)).at(-1)?.kind || null, reason: lc.reason, note: lc.note, since: lc.since, authored: true } : null;
  // Blockers in gate order, then the readiness and candidate reasons.
  const running = transaction.runningAttempts(root, id);
  const viewProblems = j.reasons.filter(r => r.code === 'BASE_MISMATCH');
  for (const r of viewProblems) push(r.code, r.detail);
  if (running.length) push('ATTEMPT_RUNNING', `attempt ${running[0].id} of change ${id} is running${running[0].alive === false ? ' (its owner is no longer running)' : ''}`);
  if (changes.TERMINAL.includes(lc.state)) push('LIFECYCLE_BLOCKED', `change ${id} is ${lc.state}${lc.superseded_by ? ` by ${lc.superseded_by}` : ''}; it cannot execute`);
  if (ag.verdict && ag.verdict !== 'current') push(ag.verdict, ag.verdict_detail || ag.verdict);
  // Rule 4 also covers the structural coverage gaps of a strict change.
  const selected = !resolved.selection || resolved.selection.change === id;
  const cov = changes.isStrict(record) ? phases.report(root, record, { gathered: st.gathered, generated, selected }) : null;
  if (cov) for (const p of cov.structure.problems) push(p.code, p.detail);
  for (const t of j.tickets) for (const r of t.readiness.reasons) if (t.status === 'done' || t.status === 'in_progress') push(r.code, `${t.id}: ${r.detail}`);
  // A missing or stale evaluation blocks only a completed change: before completion no candidate is expected.
  if (j.candidate && lc.state === 'completed') for (const r of j.candidate.reasons) push(r.code, r.detail);
  if (cov && lc.state === 'completed') for (const p of cov.candidate.problems) if (p.code !== 'EVIDENCE_MISSING' || !cov.candidate.evaluated) push(p.code, p.detail);
  report.blockers = blockers;
  report.next = routing.qualify(decide({ id, lc, ag, j, running, viewProblems, gathered: st.gathered, record, cov, selected }), { id, selected });
  return { json: report, text: render(report), exit: st.exit };
}

// The documented next-action precedence (rules 1..8); rule 1 is handled by the caller.
function decide({ id, lc, ag, j, running, viewProblems, gathered, record, cov = null, selected = true }) {
  const cmd = (action, command, extra = {}) => ({ action, command, ticket: null, check: null, ...extra });
  const change = sub => `${RUNTIME} change ${sub} ${id}`;
  // Rules 2 and 3 are shared with the coverage report (routing.cjs) so the two
  // cannot drift apart again.
  const ahead = routing.preface({ id, lifecycle: lc, base: record.base, running, viewProblems });
  if (ahead) return ahead;
  const gap = ag.verdict && ag.verdict !== 'current';
  if (gap) {
    if (ag.verdict === 'DECISION_REQUIRED') return cmd('record the user\'s decision', `${change('decide')} --resolve ${ag.open_decisions[0]} --reference <text> --excerpt <text>`, { rule: 4 });
    if (ag.verdict === 'AUTHORIZATION_REQUIRED') return cmd('record the user\'s authorization', `${change('authorize')} --agreement ${ag.current} --reference <text> --excerpt <text>`, { rule: 4 });
    if (ag.verdict === 'AGREEMENT_CHANGED') return cmd('record the disposition of the changed agreement', `${change('authorize')} --agreement ${ag.current} --reference <text> --excerpt <text> (user) or --delegated --basis ${ag.authorized ? ag.authorized.id : (record.authorizations.at(-1) || {}).id || 'A-NN'} --explanation <text>`, { rule: 4 });
    return cmd('repair the agreement inputs', `${ag.verdict}: ${ag.verdict_detail}`, { rule: 4 });
  }
  // Rule 4 (strict coverage): a structural coverage gap precedes any verification work.
  if (cov && cov.structure.problems.length) return { ...cov.next, rule: 4 };
  const staged = routing.lifecycleAction({ id, lifecycle: lc });
  if (staged) return staged;
  const tickets = j.tickets;
  const inProgress = tickets.find(t => t.status === 'in_progress');
  // A fresh clone without local attempt history relies on the saved candidate record (as `ready` does): a done
  // ticket whose only reason is EVIDENCE_MISSING is that stated limit, not stale work.
  const localUnavailable = Boolean(j.candidate && j.candidate.local_attempts === 'unavailable');
  const stale = tickets.find(t => t.status === 'done' && !t.readiness.ready && !(localUnavailable && t.readiness.reasons.every(r => r.code === 'EVIDENCE_MISSING')));
  const open = tickets.filter(t => t.status === 'open');
  const blocked = t => t.readiness.reasons.some(x => x.code === 'DEPENDENCY_BLOCKED');
  const nextOpen = open.find(t => !blocked(t)) || null;
  if (lc.state === 'active') {
    if (inProgress) return cmd(`finish ${inProgress.id}`, `scripts/pincer-ticket.sh verify ${inProgress.id} → done ${inProgress.id}`, { ticket: inProgress.id, rule: 5 });
    if (stale) return cmd(`re-verify ${stale.id} (${stale.readiness.reasons[0].code})`, `scripts/pincer-ticket.sh verify ${stale.id}`, { ticket: stale.id, rule: 5 });
    if (nextOpen) return cmd(`start ${nextOpen.id}`, `scripts/pincer-ticket.sh start ${nextOpen.id}`, { ticket: nextOpen.id, rule: 5 });
    if (open.length) return cmd('unblock the remaining tickets', `${open.map(t => `${t.id}: ${t.readiness.reasons[0] ? t.readiness.reasons[0].detail : 'blocked'}`).join('; ')}`, { ticket: open[0].id, rule: 5 });
    if (!tickets.length) return cmd('write the breakdown', '/pincer-narrow — the change has no tickets', { rule: 5 });
    return cmd('complete the change', change('complete'), { rule: 6 });
  }
  // completed
  if (stale) return cmd(`re-verify ${stale.id} (${stale.readiness.reasons[0].code})`, `${change('reopen')} --reason <text>, then scripts/pincer-ticket.sh verify ${stale.id}`, { ticket: stale.id, rule: 5 });
  const cand = j.candidate || {};
  const newer = (cand.reasons || []).find(r => ['CHECK_FAILED', 'ATTEMPT_RUNNING', 'ATTEMPT_TIMED_OUT', 'ATTEMPT_INTERRUPTED', 'ATTEMPT_ERROR'].includes(r.code));
  if (newer) return cmd(`re-run ${newer.detail.split(':')[0]} and re-evaluate`, `${RUNTIME} check ${newer.detail.split(':')[0]} --candidate ${cand.candidate}${cov ? '' : ' -- <command>'}, then /pincer-evaluate`, { check: newer.detail.split(':')[0], rule: 5 });
  // Rules 7 and 8 (strict coverage): the candidate coverage decides what the evaluation still lacks.
  if (cov && cov.candidate.problems.some(p => CANDIDATE_COVERAGE_CODES.includes(p.code) || (cov.candidate.evaluated && ['CHECK_FAILED', 'ATTEMPT_ERROR'].includes(p.code)))) return { ...cov.next, rule: 7 };
  if (cand.notes !== 'current' || (j.prd && j.prd.status !== 'built')) return cmd('evaluate the candidate', `/pincer-evaluate${j.prd && j.prd.status !== 'built' ? ` (PRD status is '${j.prd.status}', expected 'built')` : cand.reason ? ` (${cand.reason})` : ''}`, { rule: 7 });
  return cmd('read-only release audit', '/pincer-release', { rule: 8 });
}

function render(r) {
  const lines = [];
  const short = s => (typeof s === 'string' ? s.slice(0, 12) : '—');
  lines.push(`PINCER resume · ${r.generated} · ${r.root}`);
  if (!r.change) {
    lines.push(`Selection  ${r.selection && r.selection.change ? r.selection.change : 'none'}${r.selection && r.selection.problem ? ` · ${r.selection.problem.code}: ${r.selection.problem.detail}` : ''}`);
  } else {
    const c = r.change, v = c.view;
    lines.push(`Change     ${c.id} · ${c.prd} · revision ${short(c.prd_revision)} · base ${c.base.slice(0, 7)} · registered ${c.registered} · sequence ${c.sequence}`);
    lines.push(`Lifecycle  ${c.lifecycle.state} since ${c.lifecycle.since}${c.lifecycle.superseded_by ? ` · superseded by ${c.lifecycle.superseded_by}` : ''}`);
    lines.push(`View       HEAD ${v.head ? v.head.slice(0, 7) : 'none'} · branch ${v.branch || 'detached'} · base ${v.base_is_ancestor ? 'is an ancestor' : 'is NOT an ancestor'} · dirty ${v.dirty.length} path(s)${v.dirty.length ? `: ${v.dirty.slice(0, 5).join(', ')}${v.dirty.length > 5 ? ` (+${v.dirty.length - 5})` : ''}` : ''}`);
    const a = r.agreement;
    lines.push(`Agreement  ${a.current ? short(a.current) : 'unavailable'}${a.authorized ? ` · authorized as ${a.authorized.agreement} by ${a.authorized.id} (${a.authorized.disposition}, ${a.authorized.recorded})` : ' · not authorized'}${a.difference && !a.difference.same ? ` · differs from the authorized agreement: ${agreement.renderDifference(a.difference)}` : ''}`);
    lines.push(`Authorization ${a.verdict}${a.authorized && a.authorized.excerpt ? ` — "${a.authorized.excerpt}" (${a.authorized.reference})${a.authorized.constraints ? ` · constraints: ${a.authorized.constraints}` : ''}` : ''}`);
    lines.push(`Decisions  ${a.decisions.open.length || a.decisions.resolved.length ? [...a.decisions.open.map(d => `${d.id} open: ${d.summary}`), ...a.decisions.resolved.map(d => `${d.id} resolved: ${d.summary}`)].join('; ') : 'none'}`);
    lines.push(`References PRD ${r.references.prd.path}${r.references.prd.title ? ` ("${r.references.prd.title}")` : ''}${r.references.snapshot ? ` · authorized snapshot ${r.references.snapshot}` : ''}${r.references.tickets.length ? ` · tickets ${r.references.tickets.map(t => `${t.id} (${t.file})`).join(', ')}` : ' · no tickets'}`);
    for (const t of r.references.tickets) if (t.objective) lines.push(`  ${t.id}  ${t.objective}`);
    const ticketWord = t => (t.status === 'open' ? (t.readiness.reasons.some(x => x.code === 'DEPENDENCY_BLOCKED') ? ` ${t.readiness.reasons[0].detail}` : '') : t.readiness.ready ? ' ready' : t.readiness.reasons[0] ? ` ${t.readiness.reasons[0].code}` : '');
    lines.push(`Tickets    ${r.tickets.length ? r.tickets.map(t => `${t.id} ${t.status}${ticketWord(t)}`).join(' · ') : 'none'}`);
    lines.push(`Attempts   ${r.attempts.length ? r.attempts.map(x => `${x.ticket || x.check} ${x.id} ${x.outcome}${x.current ? ' (current)' : ''}`).join('; ') : 'none'}`);
    const cand = r.candidate;
    lines.push(`Candidate  ${cand ? `${cand.locator || 'NOTES.md'}: ${cand.notes === 'current' ? `current (${cand.candidate})` : cand.reason}${cand.evidence ? ` · evidence ${cand.evidence.verdict}` : ''}` : 'none'}`);
    const cv = r.coverage;
    lines.push(`Coverage   ${cv.label}${cv.strict ? ` · structure ${cv.structure.complete ? 'complete' : `incomplete (${cv.structure.problems[0].code})`} · implementation ${cv.implementation.scenarios.complete}/${cv.implementation.scenarios.total - cv.implementation.scenarios.dispositioned} scenarios · candidate ${cv.candidate.evaluated ? `delivery original ${cv.candidate.delivery.original}, agreed ${cv.candidate.delivery.agreed}, adequacy ${cv.candidate.adequacy}` : 'not evaluated'}` : cv.reason ? ` · ${cv.reason}` : ''}`);
    lines.push(`Handoff (authored) ${r.handoff ? `${r.handoff.kind || 'note'} since ${r.handoff.since}${r.handoff.reason ? ` · reason: ${r.handoff.reason}` : ''}${r.handoff.note ? ` · note: ${r.handoff.note}` : ''}` : 'none'}`);
  }
  lines.push(`Blockers   ${r.blockers.length ? r.blockers.map(b => `${b.code} ${b.detail}`).join('\n           ') : 'none'}`);
  lines.push(`Next       ${r.next.action}: ${r.next.command}`);
  return `${lines.join('\n')}\n`;
}

// --- The brief projection (docs/runtime-contracts.md, "Brief resume") ----------------
// A fresh session reads the full report to answer one question — what do I do next —
// and pays for every ticket row, attempt row and repeated blocker detail to get it.
// The brief keeps the answer and the counts and drops the repetition.
//
// It is a projection, not a second report: `next` is the full report's own object,
// copied, and every distinct blocker code survives with its exact count. Grouping may
// collapse repetition; it may never collapse a category, because a category is the
// reason a gate will refuse. Nothing here recomputes a verdict, caches readiness or
// decides an action, and `detail` names the command that prints every omitted row.
const BRIEF = 1;
const BRIEF_KIND = 'resume-brief';

function brief(r) {
  const counts = {};
  for (const b of r.blockers) counts[b.code] = (counts[b.code] || 0) + 1;
  const byStatus = { open: 0, in_progress: 0, done: 0 };
  let notReady = 0;
  for (const t of r.tickets) {
    if (t.status in byStatus) byStatus[t.status]++;
    if (!t.readiness.ready) notReady++;
  }
  const running = r.attempts.filter(a => a.outcome === 'running').length;
  const currentFailed = r.attempts.filter(a => a.current && a.outcome !== 'passed').length;
  const cov = r.coverage;
  return {
    brief: BRIEF, kind: BRIEF_KIND, of: SCHEMA,
    generated: r.generated, root: r.root, mode: r.mode,
    selection: r.selection,
    change: r.change ? { id: r.change.id, prd: r.change.prd, base: r.change.base, lifecycle: r.change.lifecycle.state } : null,
    agreement: r.agreement ? { current: r.agreement.current, verdict: r.agreement.verdict, authorized: r.agreement.authorized ? { id: r.agreement.authorized.id, disposition: r.agreement.authorized.disposition } : null } : null,
    coverage: cov ? { label: cov.label, strict: cov.strict, structure: cov.strict && cov.structure ? cov.structure.complete : null, implementation: cov.strict && cov.implementation ? cov.implementation.scenarios : null } : null,
    tickets: { total: r.tickets.length, by_status: byStatus, not_ready: notReady },
    attempts: { total: r.attempts.length, running, current_failed: currentFailed },
    candidate: r.candidate ? { notes: r.candidate.notes, candidate: r.candidate.candidate, evidence: r.candidate.evidence ? r.candidate.evidence.verdict : null } : null,
    blockers: { total: r.blockers.length, categories: Object.keys(counts).map(code => ({ code, count: counts[code] })) },
    next: r.next,
    detail: {
      command: `${RUNTIME} resume${r.change ? ` --change ${r.change.id}` : ''}`,
      prd: r.references ? r.references.prd.path : null,
      tickets: r.references ? r.references.tickets.map(t => t.file) : [],
      omitted: r.tickets.length + r.attempts.length + Math.max(0, r.blockers.length - Object.keys(counts).length),
    },
  };
}

function renderBrief(b) {
  const lines = [];
  const short = s => (typeof s === 'string' ? s.slice(0, 12) : '—');
  lines.push(`PINCER resume --brief · ${b.generated} · ${b.root}`);
  if (!b.change) {
    lines.push(`Selection  ${b.selection && b.selection.change ? b.selection.change : 'none'}${b.selection && b.selection.problem ? ` · ${b.selection.problem.code}: ${b.selection.problem.detail}` : ''}`);
  } else {
    const c = b.change, a = b.agreement;
    lines.push(`Change     ${c.id} · ${c.prd} · base ${c.base.slice(0, 7)} · ${c.lifecycle}`);
    lines.push(`Agreement  ${a.current ? short(a.current) : 'unavailable'} · ${a.verdict}${a.authorized ? ` · authorized ${a.authorized.id} (${a.authorized.disposition})` : ' · not authorized'}`);
    if (b.coverage) lines.push(`Coverage   ${b.coverage.label}${b.coverage.strict ? ` · structure ${b.coverage.structure ? 'complete' : 'incomplete'} · implementation ${b.coverage.implementation.complete}/${b.coverage.implementation.total - b.coverage.implementation.dispositioned} scenarios` : ''}`);
    const t = b.tickets;
    lines.push(`Tickets    ${t.total} · ${t.by_status.done} done · ${t.by_status.in_progress} in progress · ${t.by_status.open} open · ${t.not_ready} not ready`);
    lines.push(`Attempts   ${b.attempts.total}${b.attempts.running ? ` · ${b.attempts.running} running` : ''}${b.attempts.current_failed ? ` · ${b.attempts.current_failed} current not passed` : ''}`);
    if (b.candidate) lines.push(`Candidate  ${b.candidate.notes === 'current' ? `current (${String(b.candidate.candidate).slice(0, 7)})` : b.candidate.notes}${b.candidate.evidence ? ` · evidence ${b.candidate.evidence}` : ''}`);
  }
  lines.push(`Blockers   ${b.blockers.total ? b.blockers.categories.map(x => `${x.code}${x.count > 1 ? ` ×${x.count}` : ''}`).join(' · ') : 'none'}`);
  lines.push(`Next       ${b.next.action}: ${b.next.command}`);
  lines.push(`Detail     ${b.detail.command}${b.detail.omitted ? ` (${b.detail.omitted} row(s) not shown)` : ''}${b.detail.prd ? ` · ${b.detail.prd}` : ''}`);
  return `${lines.join('\n')}\n`;
}

module.exports = { SCHEMA, BRIEF, BRIEF_KIND, build, decide, render, brief, renderBrief };
