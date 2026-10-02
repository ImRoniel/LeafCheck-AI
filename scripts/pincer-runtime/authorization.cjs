'use strict';
// PINCER runtime — authorization and decisions (docs/runtime-contracts.md,
// "Agreements and authorization"). An authorization record binds one agreement
// digest to the user's actual instruction (disposition `user`) or to an earlier
// authorization it stays within (disposition `delegated`, a reviewer's judgment
// recorded with its explanation). Decisions are the consequential choices that
// need the user: raised as `open`, which blocks execution, and resolved with the
// user's decision, which changes the agreement. The verdict computed here is the
// one every gate, status and resume consume. Nothing here infers approval from a
// status, a passing check, a registration or the v0.5.0 free text.
const transaction = require('./transaction.cjs');
const agreement = require('./agreement.cjs');
const { inlineSecretLine } = require('./sanitize.cjs');

const SHA256 = /^[0-9a-f]{64}$/;
const DECISION_ID = /^D-[0-9]{2,6}$/;
const AUTHORIZATION_ID = /^A-[0-9]{2,6}$/;
const nextId = (prefix, list) => `${prefix}-${String(list.length + 1).padStart(2, '0')}`;

// --- Verdict (pure over the record and the computed agreement) -------------------------
// { verdict: 'current' | 'DECISION_REQUIRED' | 'AUTHORIZATION_REQUIRED' | 'AGREEMENT_CHANGED',
//   detail, authorized, current, latest, open, difference } — or, when the agreement
// cannot be computed, { verdict: <input code>, detail }.
function verdict(root, record, computed = null) {
  const now = computed || agreement.compute(root, record);
  if (now.code) return { verdict: now.code, detail: now.problem, authorized: null, current: null, latest: null, open: [], difference: null };
  const open = record.decisions.filter(d => d.status === 'open');
  const authorized = record.authorizations.find(a => a.digest === now.digest) || null;
  const latest = record.authorizations.length ? record.authorizations[record.authorizations.length - 1] : null;
  let difference = null;
  if (!authorized && latest) {
    const entry = record.agreements.find(g => g.id === latest.agreement);
    const snap = entry ? agreement.readSnapshot(root, record, entry) : { code: 'HISTORY_INVALID' };
    if (!snap.code) difference = agreement.difference(snap.snapshot, now);
  }
  const base = { authorized, current: now.digest, latest, open: open.map(d => d.id), difference };
  if (open.length) return { ...base, verdict: 'DECISION_REQUIRED', detail: `decision ${open[0].id} is open (${open[0].summary}); record the user's decision with: node scripts/pincer-runtime.cjs change decide ${record.change} --resolve ${open[0].id} --reference <text> --excerpt <text>` };
  if (!record.authorizations.length) return { ...base, verdict: 'AUTHORIZATION_REQUIRED', detail: `change ${record.change} has no authorization record${record.legacy.authorization_text ? ' (the v0.5.0 free text is retained as history only)' : ''}; record the user's instruction with: node scripts/pincer-runtime.cjs change authorize ${record.change} --agreement ${now.digest} --reference <text> --excerpt <text>` };
  if (!authorized) return { ...base, verdict: 'AGREEMENT_CHANGED', detail: `the latest authorization ${latest.id} covers agreement ${latest.agreement} ${latest.digest.slice(0, 12)}, the current agreement is ${now.digest.slice(0, 12)}${difference ? ` (${agreement.renderDifference(difference)})` : ''}; record the disposition with: node scripts/pincer-runtime.cjs change authorize ${record.change} --agreement ${now.digest} … (user) or --delegated --basis ${latest.id} --explanation <text>` };
  return { ...base, verdict: 'current', detail: `${authorized.id} (${authorized.disposition}) covers the current agreement ${now.digest.slice(0, 12)}` };
}

// --- Shared validation of authored texts ----------------------------------------------------
function text(value, name, options) {
  const v = transaction.boundedText(value, name, options);
  if (v !== null && inlineSecretLine([v])) transaction.refuse('INPUT_INVALID', `--${name} assigns a secret-like literal; reference secrets by name, never by value`);
  return v;
}

// --- change authorize ---------------------------------------------------------------------------
// Returns { action: 'recorded' | 'unchanged', authorization, agreement, record } or { code, problem }.
function authorize(root, id, opts = {}) {
  const changes = require('./changes.cjs');
  try {
    const out = transaction.run(root, { command: `change authorize ${id}`, hooks: opts.hooks || null }, ctx => {
      const resolved = changes.resolveSelected(root, { change: id });
      if (resolved.code) ctx.refuse(resolved.code, resolved.problem);
      if (opts.expect !== undefined && opts.expect !== null) ctx.expect(resolved.file, 'sequence', opts.expect);
      const record = resolved.record;
      if (changes.TERMINAL.includes(record.lifecycle.state)) ctx.refuse('LIFECYCLE_BLOCKED', `change ${id} is ${record.lifecycle.state}; it cannot be authorized — register a new change and reference this record`);
      if (typeof opts.agreement !== 'string' || !SHA256.test(opts.agreement)) ctx.refuse('INPUT_INVALID', '--agreement must be the 64-hex agreement digest (shown by change show and status)');
      const disposition = opts.delegated ? 'delegated' : 'user';
      const reference = disposition === 'user' ? text(opts.reference, 'reference') : (opts.reference !== undefined && opts.reference !== null ? ctx.refuse('INPUT_INVALID', 'a delegated authorization carries no --reference/--excerpt; name its basis and explanation instead') : null);
      const excerpt = disposition === 'user' ? text(opts.excerpt, 'excerpt') : (opts.excerpt !== undefined && opts.excerpt !== null ? ctx.refuse('INPUT_INVALID', 'a delegated authorization carries no --reference/--excerpt; name its basis and explanation instead') : null);
      const constraints = text(opts.constraints, 'constraints', { required: false });
      let basis = null, explanation = null;
      if (disposition === 'delegated') {
        if (typeof opts.basis !== 'string' || !AUTHORIZATION_ID.test(opts.basis)) ctx.refuse('INPUT_INVALID', '--delegated requires --basis A-NN (an earlier authorization of this change)');
        if (!record.authorizations.some(a => a.id === opts.basis)) ctx.refuse('INPUT_INVALID', `--basis ${opts.basis} is not an authorization of change ${id} (recorded: ${record.authorizations.map(a => a.id).join(', ') || 'none'})`);
        basis = opts.basis;
        explanation = text(opts.explanation, 'explanation');
      } else if (opts.basis || opts.explanation) ctx.refuse('INPUT_INVALID', '--basis and --explanation belong to --delegated authorizations');
      const decisions = [...new Set(opts.decisions || [])].sort();
      for (const d of decisions) {
        if (!DECISION_ID.test(d)) ctx.refuse('INPUT_INVALID', `--decision must name a decision such as D-01 (got ${d})`);
        const found = record.decisions.find(x => x.id === d);
        if (!found) ctx.refuse('INPUT_INVALID', `--decision ${d} is not a decision of change ${id} (recorded: ${record.decisions.map(x => x.id).join(', ') || 'none'})`);
        if (found.status !== 'resolved') ctx.refuse('DECISION_REQUIRED', `decision ${d} is still open; resolve it first with: node scripts/pincer-runtime.cjs change decide ${id} --resolve ${d} --reference <text> --excerpt <text>`);
      }
      const computed = agreement.compute(root, record);
      if (computed.code) ctx.refuse(computed.code, computed.problem);
      if (computed.digest !== opts.agreement) ctx.refuse('AGREEMENT_CHANGED', `--agreement ${opts.agreement.slice(0, 12)} is not the current agreement of ${id} (${computed.digest.slice(0, 12)}); the authored inputs changed since it was prepared — review them (change show ${id}) and authorize the current digest`);
      const same = record.authorizations.find(a => a.digest === computed.digest && a.disposition === disposition && a.reference === reference && a.excerpt === excerpt && a.constraints === constraints && a.basis === basis && a.explanation === explanation && JSON.stringify(a.decisions) === JSON.stringify(decisions));
      if (same) return { action: 'unchanged', authorization: same, agreement: record.agreements.find(g => g.id === same.agreement), record };
      let entry = agreement.entryFor(record, computed.digest);
      if (!entry) {
        const latest = agreement.latestEntry(record);
        const previous = latest ? agreement.readSnapshot(root, record, latest) : null;
        if (previous && previous.code) ctx.refuse(previous.code, previous.problem);
        entry = agreement.appendAgreement(ctx, changes, record, resolved.file, computed, { stage: false, event: false }).agreement;
      }
      const auth = { id: nextId('A', record.authorizations), agreement: entry.id, digest: computed.digest, disposition, reference, excerpt, constraints, basis, explanation, decisions, recorded: ctx.now };
      record.authorizations.push(auth);
      const sequence = record.sequence + 1;
      record.events.push({ sequence, kind: 'authorize', from: record.lifecycle.state, to: record.lifecycle.state, at: ctx.now, reason: null, agreement: entry.id, authorization: auth.id, decision: decisions[0] || null, replacement: null, note: null });
      record.sequence = sequence;
      ctx.write(resolved.file, record);
      return { action: 'recorded', authorization: auth, agreement: entry, record };
    });
    return out.result;
  } catch (error) {
    if (error.refusal) return { code: error.code, problem: error.message };
    if (error.code === 'STATE_BUSY') return { code: 'STATE_BUSY', problem: error.message };
    throw error;
  }
}

// --- change decide ---------------------------------------------------------------------------
// Raise: { action: 'raised' | 'unchanged', decision, record }; resolve: { action:
// 'resolved' | 'unchanged', decision, record, agreement: <new digest> }.
function decide(root, id, opts = {}) {
  const changes = require('./changes.cjs');
  try {
    const out = transaction.run(root, { command: `change decide ${id}`, hooks: opts.hooks || null }, ctx => {
      const resolved = changes.resolveSelected(root, { change: id });
      if (resolved.code) ctx.refuse(resolved.code, resolved.problem);
      if (opts.expect !== undefined && opts.expect !== null) ctx.expect(resolved.file, 'sequence', opts.expect);
      const record = resolved.record;
      if (changes.TERMINAL.includes(record.lifecycle.state)) ctx.refuse('LIFECYCLE_BLOCKED', `change ${id} is ${record.lifecycle.state}; decisions belong to a new change`);
      if (opts.resolve) {
        if (!DECISION_ID.test(opts.resolve)) ctx.refuse('INPUT_INVALID', '--resolve must name a decision such as D-01');
        const decision = record.decisions.find(d => d.id === opts.resolve);
        if (!decision) ctx.refuse('INPUT_INVALID', `no decision ${opts.resolve} on change ${id} (recorded: ${record.decisions.map(d => d.id).join(', ') || 'none'})`);
        const reference = text(opts.reference, 'reference');
        const excerpt = text(opts.excerpt, 'excerpt');
        if (decision.status === 'resolved') {
          if (decision.reference === reference && decision.excerpt === excerpt) return { action: 'unchanged', decision, record, agreement: agreement.compute(root, record).digest || null };
          ctx.refuse('INPUT_INVALID', `${decision.id} is already resolved ("${decision.excerpt}", ${decision.reference}); a different decision needs a new decision record`);
        }
        decision.status = 'resolved'; decision.reference = reference; decision.excerpt = excerpt; decision.resolved = ctx.now;
        const sequence = record.sequence + 1;
        record.events.push({ sequence, kind: 'resolve', from: record.lifecycle.state, to: record.lifecycle.state, at: ctx.now, reason: null, agreement: null, authorization: null, decision: decision.id, replacement: null, note: null });
        record.sequence = sequence;
        ctx.write(resolved.file, record);
        const after = agreement.compute(root, record);
        return { action: 'resolved', decision, record, agreement: after.code ? null : after.digest };
      }
      const summary = text(opts.summary, 'summary');
      const expectedId = nextId('D', record.decisions);
      if (opts.id !== undefined && opts.id !== null) {
        if (!DECISION_ID.test(opts.id)) ctx.refuse('INPUT_INVALID', '--id must be a decision ID such as D-01');
        const existing = record.decisions.find(d => d.id === opts.id);
        if (existing) {
          if (existing.status === 'open' && existing.summary === summary) return { action: 'unchanged', decision: existing, record };
          ctx.refuse('INPUT_INVALID', `${opts.id} already exists on change ${id} (${existing.status}: ${existing.summary}); decisions are never rewritten — raise a new one`);
        }
        if (opts.id !== expectedId) ctx.refuse('INPUT_INVALID', `the next decision of change ${id} is ${expectedId}, not ${opts.id}`);
      }
      const same = record.decisions.find(d => d.status === 'open' && d.summary === summary);
      if (same) return { action: 'unchanged', decision: same, record };
      const decision = { id: expectedId, status: 'open', summary, reference: null, excerpt: null, raised: ctx.now, resolved: null };
      record.decisions.push(decision);
      const sequence = record.sequence + 1;
      record.events.push({ sequence, kind: 'decide', from: record.lifecycle.state, to: record.lifecycle.state, at: ctx.now, reason: null, agreement: null, authorization: null, decision: decision.id, replacement: null, note: null });
      record.sequence = sequence;
      ctx.write(resolved.file, record);
      return { action: 'raised', decision, record };
    });
    return out.result;
  } catch (error) {
    if (error.refusal) return { code: error.code, problem: error.message };
    if (error.code === 'STATE_BUSY') return { code: 'STATE_BUSY', problem: error.message };
    throw error;
  }
}

module.exports = { verdict, authorize, decide, DECISION_ID, AUTHORIZATION_ID };
