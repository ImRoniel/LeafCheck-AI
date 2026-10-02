'use strict';
// PINCER runtime — the one readiness computation (docs/runtime-contracts.md,
// "Readiness and reason codes"). Pure functions over parsed inputs: the human
// status, the JSON status, `ready`, `done`, `start` and release all consume
// these so they cannot disagree. Nothing here reads the clock, executes a
// command or writes a file.
const parse = require('./parse.cjs');
const { validateAttempt } = require('./state.cjs');

const reason = (code, detail, next) => ({ code, detail, next });

// Legacy mode: the v0.4.1 rules over the ticket's own receipts. Returns
// { ready, reasons, legacyMessage } where legacyMessage is the exact wording
// the Bash helper printed for a done ticket that needs attention.
function legacyTicketReadiness(text, fields) {
  const receipt = fields.verified || '';
  const attempt = fields.last_check || '';
  const hash = parse.legacyBlockHash(text);
  const fail = (message, code, detail = message) => ({ ready: false, legacyMessage: message, reasons: [reason(code, detail, 're-run verify')] });
  if (!attempt) return fail('missing latest verification outcome — re-run verify', 'EVIDENCE_MISSING', 'no recorded verification attempt');
  const parts = attempt.split(/[ \t]+/);
  if (!(parts.length === 3 && parse.TIMESTAMP.test(parts[0]) && parts[1] === 'passed' && /^[a-f0-9]{12}$/.test(parts[2])) || parts[2] !== hash) {
    const outcomeCode = parts[1] === 'running' ? 'ATTEMPT_RUNNING' : parts[1] === 'interrupted' ? 'ATTEMPT_INTERRUPTED' : parts[1] === 'failed' ? 'CHECK_FAILED' : 'CHECK_CHANGED';
    const code = parts[1] === 'passed' && parts[2] !== hash ? 'CHECK_CHANGED' : outcomeCode;
    return fail(`latest verification: ${attempt} — re-run verify`, code, code === 'CHECK_CHANGED' ? 'the Verification block changed after the latest pass' : `latest verification: ${attempt}`);
  }
  if (!receipt) return fail('done without a verification receipt — re-run verify', 'EVIDENCE_MISSING', 'done without a verification receipt');
  const rparts = receipt.split(/[ \t]+/);
  if (!(rparts.length === 2 && parse.TIMESTAMP.test(rparts[0]) && /^[a-f0-9]{12}$/.test(rparts[1])) || rparts[1] !== hash) {
    return fail('stale or malformed verification receipt — re-run verify', 'CHECK_CHANGED', 'stale or malformed verification receipt');
  }
  if (parse.unticked(text).length) return fail('unticked acceptance criteria — complete and re-run verify', 'CRITERIA_UNTICKED', 'unticked acceptance criteria');
  return { ready: true, reasons: [] };
}

// Migrated mode: readiness derives from the latest attempt for the ticket's
// context and the current inputs. `current` carries the digests computed now;
// `sourceProblems` are snapshot problems (secret path, unsupported input);
// `contextKey` is the key the attempt was read for and `pointedId` the id the
// index names for it (the record must match both); the attempt's artifacts
// carry `missing`/`altered` from state.inspectArtifacts.
function migratedTicketReadiness({ text, fields, timeout, attempt, legacyReceipt, current, sourceProblems = [], changedPaths = [], contextKey = null, pointedId = null, mode = 'migrated', strict = false }) {
  const reasons = [];
  for (const p of sourceProblems) reasons.push(reason(p.code, p.detail, p.code === 'SECRET_PATH' ? 'remove or ignore the secret file' : 'remove the input or change the configuration'));
  if (reasons.length) return { ready: false, reasons };
  if (!attempt) {
    if (legacyReceipt) return { ready: false, reasons: [reason('LEGACY_RECEIPT', `migrated legacy receipt (${legacyReceipt.verified || legacyReceipt.last_check || 'present'}) is history, not runtime evidence`, 'verify')] };
    return { ready: false, reasons: [reason('EVIDENCE_MISSING', 'no runtime attempt recorded', 'verify')] };
  }
  const id = typeof attempt.id === 'string' && attempt.id ? attempt.id : '?';
  // The record must be complete and written for this context before any
  // outcome is honored: a stripped or foreign record is never a pass.
  const invalid = validateAttempt(attempt, contextKey, pointedId);
  if (invalid) return { ready: false, reasons: [reason('ATTEMPT_ERROR', `attempt ${id} ${invalid}`, 'verify')] };
  // A record written before the migration to change records keeps its identity
  // as history; it never becomes current evidence for the new change context.
  if (mode === 'changes' && attempt.schema === 1) return { ready: false, reasons: [reason('HISTORICAL_EVIDENCE', `attempt ${id} was recorded under schema ${attempt.schema} (before this project used change records) and is history, not current evidence`, 'verify')] };
  // Strict coverage (schema 3 attempts): an attempt recorded before adoption is history;
  // a strict attempt read for a change without the capability is never evidence.
  if (mode === 'changes' && strict && attempt.schema !== 3) return { ready: false, reasons: [reason('HISTORICAL_EVIDENCE', `attempt ${id} was recorded under schema ${attempt.schema} (before this change adopted strict coverage) and is history, not current evidence`, 'verify')] };
  if (mode === 'changes' && !strict && attempt.schema === 3) return { ready: false, reasons: [reason('ATTEMPT_ERROR', `attempt ${id} is a strict-coverage (schema 3) attempt; this change has not adopted strict coverage`, 'verify')] };
  if (mode !== 'changes' && attempt.schema !== 1) return { ready: false, reasons: [reason('ATTEMPT_ERROR', `attempt ${id} is a change-record (schema ${attempt.schema}) attempt; this project is not in changes mode`, 'verify')] };
  switch (attempt.outcome) {
    case 'running': return { ready: false, reasons: [reason('ATTEMPT_RUNNING', `attempt ${id} is running`, 'wait, or run recover if its owner died')] };
    case 'interrupted': return { ready: false, reasons: [reason('ATTEMPT_INTERRUPTED', `attempt ${id} was interrupted`, 'verify')] };
    case 'timed_out': return { ready: false, reasons: [reason('ATTEMPT_TIMED_OUT', `attempt ${id} timed out after ${attempt.check && attempt.check.timeout_seconds} s`, 'fix or raise timeout, then verify')] };
    case 'error': return { ready: false, reasons: [reason('ATTEMPT_ERROR', `attempt ${id}: ${attempt.error || 'could not be recorded'}`, 'inspect the record, then verify')] };
    case 'failed': return { ready: false, reasons: [reason('CHECK_FAILED', `attempt ${id} failed (exit ${attempt.exit_code ?? attempt.signal ?? '?'})`, 'fix, then verify')] };
    case 'passed': break;
    default: return { ready: false, reasons: [reason('ATTEMPT_ERROR', `attempt ${id} has unknown outcome ${JSON.stringify(attempt.outcome)}`, 'verify')] };
  }
  if (current.prdRevision && attempt.context && attempt.context.prd_revision !== current.prdRevision) {
    // The remedy is mode-specific. `register --rebind` is the v0.4.1/v0.5.0 repair and
    // changes mode refuses it outright (AGREEMENT_CHANGED: "--rebind is not supported
    // for change records"), so naming it there sends the reader to a command the
    // runtime will not run — the defect class T-80 closed for the coverage report.
    reasons.push(reason('REVISION_CHANGED', 'the PRD revision changed since the passing attempt',
      mode === 'changes' ? 'change revise, record its authorization, then verify' : 'register --rebind, then verify'));
  }
  if (attempt.check && attempt.check.digest !== parse.checkDigest(text, timeout)) {
    reasons.push(reason('CHECK_CHANGED', 'the Verification block or timeout changed since the passing attempt', 'verify'));
  }
  if (attempt.context && attempt.context.ticket_digest !== parse.ticketDigest(text)) {
    reasons.push(reason('SOURCE_CHANGED', 'the ticket\'s authored content changed since the passing attempt', 'verify'));
  }
  if (current.sourceDigest && attempt.source && attempt.source.after !== current.sourceDigest) {
    const shown = changedPaths.slice(0, 5).join(', ') + (changedPaths.length > 5 ? `, … (${changedPaths.length} paths)` : '');
    reasons.push(reason('SOURCE_CHANGED', `source changed since the passing attempt${shown ? `: ${shown}` : ''}`, 'verify'));
  }
  const streams = ['stdout', 'stderr'];
  if (streams.some(k => attempt.artifacts[k].missing)) {
    reasons.push(reason('EVIDENCE_MISSING', 'the attempt\'s captured log is missing from local state', 'verify'));
  }
  const altered = streams.filter(k => attempt.artifacts[k].altered);
  if (altered.length) {
    reasons.push(reason('EVIDENCE_MISSING', `the attempt's captured ${altered.join(' and ')} log was altered after the run and no longer matches the recorded digest`, 'verify'));
  }
  if (parse.unticked(text).length) reasons.push(reason('CRITERIA_UNTICKED', 'unticked acceptance criteria', 'tick verified criteria'));
  return { ready: reasons.length === 0, reasons };
}

module.exports = { reason, legacyTicketReadiness, migratedTicketReadiness };
