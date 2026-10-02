'use strict';
// PINCER runtime — command gates (docs/runtime-contracts.md, "Command gates").
// In changes mode every execution or lifecycle-writing command passes this one
// guard before a child process is spawned or a ticket file written: the
// records must be readable, a change must be selected and own the ticket (or
// PRD), its lifecycle state must permit the command, the repository view must
// be compatible, and the authorization verdict must be `current`. Refusals carry
// the contracted code, in the contracted order, and nothing has been written.
const changes = require('./changes.cjs');
const agreement = require('./agreement.cjs');
const authorization = require('./authorization.cjs');
const { refuse } = require('./transaction.cjs');

// Lifecycle states that permit each command.
const PERMITTED = {
  start: ['active'], done: ['active'], verify: ['active', 'completed'],
  check: ['completed'], export: ['completed'],
};
const ORDER = ['INPUT_INVALID', 'INVENTORY_INVALID', 'COVERAGE_INVALID', 'MALFORMED', 'UNSUPPORTED_SCHEMA', 'HISTORY_INVALID', 'STATE_INCOMPLETE', 'SELECTION_REQUIRED', 'SELECTION_INVALID', 'WRONG_CHANGE', 'LIFECYCLE_BLOCKED', 'BASE_MISMATCH', 'DECISION_REQUIRED', 'AUTHORIZATION_REQUIRED', 'AGREEMENT_CHANGED'];

// guard(root, { command, ticket: { file, fields } | null, prd: string | null })
// Returns { id, record, file, selection, view, computed, verdict, binding } where
// `binding` is the context every attempt, readiness and export consumes:
// { change, prd, prd_revision, base, agreement, legacy_receipts, mode: 'changes' }.
// Throws a transaction Refusal on the first failing gate.
function guard(root, { command, ticket = null, prd = null }) {
  const resolved = changes.resolveSelected(root, {});
  if (resolved.code) {
    const hint = resolved.code === 'SELECTION_REQUIRED' || resolved.code === 'SELECTION_INVALID' ? ` (execution needs the selected change; ${resolved.problem})` : `: ${resolved.problem}`;
    refuse(resolved.code, `${command} refused${hint}`);
  }
  const { id, record, file, selection, loaded } = resolved;
  // Ownership: the ticket's PRD, or the named PRD, must belong to the selected change.
  let owner = null;
  if (ticket) {
    const o = changes.ticketOwner(root, loaded, ticket.file, ticket.fields);
    if (o.problem) refuse(o.id ? 'WRONG_CHANGE' : 'INPUT_INVALID', `${command} refused: ${o.problem}`);
    owner = o;
  } else if (prd) {
    const o = changes.ownerOf(loaded, prd);
    if (!o) refuse('INPUT_INVALID', `${command} refused: ${prd} is owned by no change record; register it first`);
    owner = { id: o[0], prd };
  }
  if (owner && owner.id !== id) refuse('WRONG_CHANGE', `${command} refused: ${ticket ? `${ticket.fields.ticket} (${owner.prd})` : owner.prd} belongs to change ${owner.id}, but ${id} is selected; select it first: node scripts/pincer-runtime.cjs change select ${owner.id}`);
  const st = record.lifecycle.state;
  if (!PERMITTED[command].includes(st)) {
    const next = changes.TERMINAL.includes(st) ? `the change is ${st}${record.lifecycle.superseded_by ? ` by ${record.lifecycle.superseded_by}` : ''}; register a new change and reference this one`
      : st === 'planned' ? `activate it first: node scripts/pincer-runtime.cjs change activate ${id}`
        : st === 'paused' ? `resume it first: node scripts/pincer-runtime.cjs change resume ${id}${record.lifecycle.reason ? ` (paused: ${record.lifecycle.reason})` : ''}`
          : st === 'completed' ? `${command} needs an active change; reopen it first: node scripts/pincer-runtime.cjs change reopen ${id} --reason <text>`
            : `${command} needs a completed change; complete it first: node scripts/pincer-runtime.cjs change complete ${id}`;
    refuse('LIFECYCLE_BLOCKED', `${command} refused: change ${id} is ${st} (${command} runs on ${PERMITTED[command].join(' or ')} changes); ${next}`);
  }
  const view = changes.view(root, record);
  if (view.problems.length) refuse('BASE_MISMATCH', `${command} refused: ${view.problems[0].detail}`);
  const computed = agreement.compute(root, record);
  if (computed.code) refuse(computed.code, `${command} refused: ${computed.problem}`);
  const verdict = authorization.verdict(root, record, computed);
  if (verdict.verdict !== 'current') refuse(verdict.verdict, `${command} refused: ${verdict.detail}`);
  // A strict change's binding carries its inventory and coverage map digests (attempt schema 3).
  const binding = { change: id, prd: record.prd, prd_revision: computed.prd.revision, base: record.base, agreement: computed.digest, legacy_receipts: record.legacy.receipts, mode: 'changes', strict: Boolean(computed.inventory), ...(computed.inventory ? { inventory: computed.inventory.digest, coverage: computed.coverage.digest } : {}) };
  return { id, record, file, selection, view, computed, verdict, binding, loaded };
}

// The read-only counterpart for status/ready: the same checks as reasons, none thrown.
function reasons(root, { command, ticket = null, prd = null }) {
  try { guard(root, { command, ticket, prd }); return []; } catch (error) {
    if (error && error.refusal) return [{ code: error.code, detail: error.message }];
    throw error;
  }
}

module.exports = { guard, reasons, PERMITTED, ORDER };
