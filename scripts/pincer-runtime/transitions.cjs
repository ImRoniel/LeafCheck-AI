'use strict';
// PINCER runtime — change lifecycle transitions (docs/runtime-contracts.md,
// "Lifecycle"). planned → active → paused/completed → …, cancelled and
// superseded as terminal states, each transition one transaction that checks the
// whole precondition set under the lock, appends exactly one event and rewrites
// the projection; an invalid transition writes nothing; requesting the state a
// record already has writes no event. Running attempts are never terminated
// here: pause, complete, cancel and supersede refuse while one runs.
const transaction = require('./transaction.cjs');
const agreement = require('./agreement.cjs');
const { inlineSecretLine } = require('./sanitize.cjs');

const OPS = ['activate', 'pause', 'resume', 'complete', 'reopen', 'cancel', 'supersede'];
const NEEDS_SELECTION = ['activate', 'pause', 'resume', 'complete', 'reopen'];
const NEEDS_IDLE = ['pause', 'complete', 'cancel', 'supersede'];
const ACTIVATION = ['activate', 'resume', 'reopen'];
const DECISION_ID = /^D-[0-9]{2,6}$/;

function text(value, name, options) {
  const v = transaction.boundedText(value, name, options);
  if (v !== null && inlineSecretLine([v])) transaction.refuse('INPUT_INVALID', `--${name} assigns a secret-like literal; reference secrets by name, never by value`);
  return v;
}
// The operations the table permits from a state (for refusal messages).
function permitted(changes, state) {
  return OPS.filter(op => changes.LIFECYCLE_KINDS[op][0].includes(state));
}

// transition(root, id, op, opts): opts = { reason, note, decision, with, expect, hooks }.
// Returns { action: 'transitioned' | 'unchanged', record, from, to, event } or { code, problem }.
function transition(root, id, op, opts = {}) {
  const changes = require('./changes.cjs');
  const authorization = require('./authorization.cjs');
  const statusModule = require('./status.cjs');
  if (!OPS.includes(op)) return { code: 'INPUT_INVALID', problem: `unknown lifecycle operation ${op}` };
  const [froms, to] = changes.LIFECYCLE_KINDS[op];
  try {
    const out = transaction.run(root, { command: `change ${op} ${id}`, hooks: opts.hooks || null }, ctx => {
      const resolved = changes.resolveSelected(root, { change: id });
      if (resolved.code) ctx.refuse(resolved.code, resolved.problem);
      if (opts.expect !== undefined && opts.expect !== null) ctx.expect(resolved.file, 'sequence', opts.expect);
      const record = resolved.record;
      const from = record.lifecycle.state;
      // Idempotence: the requested state is already the state (same replacement for supersede).
      if (from === to && (op !== 'supersede' || record.lifecycle.superseded_by === opts.with)) return { action: 'unchanged', record, from, to };
      if (changes.TERMINAL.includes(from)) ctx.refuse('LIFECYCLE_BLOCKED', `change ${id} is ${from}${record.lifecycle.superseded_by ? ` by ${record.lifecycle.superseded_by}` : ''}; its history is inspectable (change show ${id}) but it cannot be ${op}d — register a new change and reference this record`);
      if (!froms.includes(from)) ctx.refuse('LIFECYCLE_BLOCKED', `change ${id} is ${from}; ${op} applies to ${froms.join(' or ')} changes — permitted now: ${permitted(changes, from).map(o => `change ${o}`).join(', ')}`);
      if (NEEDS_SELECTION.includes(op)) {
        if (!resolved.selection) ctx.refuse('SELECTION_REQUIRED', `${op} needs the change selected in this worktree: node scripts/pincer-runtime.cjs change select ${id}`);
        if (resolved.selection.change !== id) ctx.refuse('WRONG_CHANGE', `the selected change is ${resolved.selection.change}, not ${id}; select it first: node scripts/pincer-runtime.cjs change select ${id}`);
      }
      const reason = ['pause', 'reopen', 'cancel'].includes(op) ? text(opts.reason, 'reason') : null;
      const note = op === 'pause' ? text(opts.note, 'note', { required: false }) : null;
      let decision = null;
      if (['cancel', 'supersede'].includes(op)) {
        if (typeof opts.decision !== 'string' || !DECISION_ID.test(opts.decision)) ctx.refuse('INPUT_INVALID', `${op} requires --decision D-NN, the user's recorded decision (change decide ${id} --summary … then --resolve)`);
        const d = record.decisions.find(x => x.id === opts.decision);
        if (!d) ctx.refuse('INPUT_INVALID', `--decision ${opts.decision} is not a decision of change ${id} (recorded: ${record.decisions.map(x => x.id).join(', ') || 'none'})`);
        if (d.status !== 'resolved') ctx.refuse('DECISION_REQUIRED', `decision ${d.id} is still open; record the user's decision first: node scripts/pincer-runtime.cjs change decide ${id} --resolve ${d.id} --reference <text> --excerpt <text>`);
        decision = d.id;
      }
      let replacement = null;
      if (op === 'supersede') {
        const w = opts.with;
        if (typeof w !== 'string' || !changes.CHANGE_ID.test(w)) ctx.refuse('INPUT_INVALID', 'supersede requires --with <replacement change id>');
        if (w === id) ctx.refuse('LIFECYCLE_BLOCKED', `change ${id} cannot supersede itself`);
        if (!resolved.loaded.records.has(w)) ctx.refuse('INPUT_INVALID', `replacement change "${w}" is not a retained record (retained: ${[...resolved.loaded.records.keys()].join(', ')}); register it first`);
        // The replacement must not be (transitively) superseded by this record.
        let cursor = resolved.loaded.records.get(w).record.lifecycle.superseded_by;
        const seen = new Set([w]);
        while (cursor) {
          if (cursor === id) ctx.refuse('LIFECYCLE_BLOCKED', `change "${w}" is already superseded by ${[...seen].join(' → ')} → ${id}; superseding ${id} with it would form a cycle`);
          if (seen.has(cursor)) break;
          seen.add(cursor);
          const next = resolved.loaded.records.get(cursor);
          cursor = next ? next.record.lifecycle.superseded_by : null;
        }
        replacement = w;
      }
      if (NEEDS_IDLE.includes(op)) ctx.idle(id);
      let authorized = null, agreementId = null, verdict = null;
      if (ACTIVATION.includes(op) || op === 'complete') {
        const v = changes.view(root, record);
        if (v.problems.length) ctx.refuse(v.problems[0].code, v.problems[0].detail);
        const computed = agreement.compute(root, record);
        if (computed.code) ctx.refuse(computed.code, computed.problem);
        verdict = authorization.verdict(root, record, computed);
        if (verdict.verdict !== 'current') ctx.refuse(verdict.verdict, verdict.detail);
        authorized = verdict.authorized.id; agreementId = verdict.authorized.agreement;
        if (ACTIVATION.includes(op)) {
          for (const [otherId, e] of resolved.loaded.records) {
            if (otherId !== id && e.record.lifecycle.state === 'active') ctx.refuse('LIFECYCLE_BLOCKED', `change ${otherId} is active in this tree; pause or complete it before activating ${id} (at most one active change)`);
          }
        }
      }
      if (op === 'complete') {
        const st = statusModule.render(root, { change: id });
        const g = st.gathered;
        if (!g || !g.tickets) ctx.refuse('INPUT_INVALID', st.text.trim().split('\n').find(l => l.startsWith('WARN')) || 'the change cannot be inspected');
        if (g.unresolved > 0) ctx.refuse('INPUT_INVALID', 'a ticket has an unresolved PRD association; repair it before completing');
        if (!g.tickets.length) ctx.refuse('LIFECYCLE_BLOCKED', `change ${id} has no tickets; a change completes only with a verified breakdown`);
        // Strict coverage (docs/runtime-contracts.md, "Phase-specific coverage"): structural
        // completeness — every scenario linked or authorized as not delivered, nothing
        // missing from the baseline — precedes the ticket readiness gate below; a
        // candidate is never demanded here.
        if (changes.isStrict(record)) {
          const report = require('./phases.cjs').compute(root, record, { gathered: g, verdict });
          const blocker = require('./phases.cjs').firstBlocker(report, 'structure');
          if (blocker) ctx.refuse(blocker.code, `${blocker.detail} — complete needs structural coverage: every scenario linked or dispositioned, every ticket classified, every disposition authorized`);
        }
        for (const t of g.tickets) {
          const tid = t.fields.ticket;
          if (t.fields.status !== 'done') ctx.refuse('LIFECYCLE_BLOCKED', `${tid} is ${t.fields.status}, not done; finish every ticket before completing ${id}`);
          const r = g.computeReadiness(t);
          if (!r.ready) ctx.refuse(r.reasons[0].code, `${tid}: ${r.reasons[0].detail} — ${r.reasons[0].next}`);
        }
      }
      const sequence = record.sequence + 1;
      const event = { sequence, kind: op, from, to, at: ctx.now, reason, agreement: agreementId, authorization: authorized, decision, replacement, note };
      record.events.push(event);
      record.sequence = sequence;
      record.lifecycle = { state: to, since: ctx.now, reason, note, superseded_by: replacement };
      ctx.write(resolved.file, record);
      return { action: 'transitioned', record, from, to, event };
    });
    return out.result;
  } catch (error) {
    if (error.refusal) return { code: error.code, problem: error.message };
    if (error.code === 'STATE_BUSY') return { code: 'STATE_BUSY', problem: error.message };
    throw error;
  }
}

module.exports = { OPS, transition, permitted };
