'use strict';
// The head of the next-action precedence (docs/runtime-contracts.md, rules 1-8),
// in one place. `resume` and `coverage` both render a next action; when each
// carried its own copy they drifted, and `coverage` ended up recommending
// commands the gates refuse — `start T-01` on a paused change, execution on a
// cancelled one. Rules 2 and 3 live here so the two reports cannot disagree
// again, and so neither can disagree with the gate that will run next.
const changes = require('./changes.cjs');

const RUNTIME = 'node scripts/pincer-runtime.cjs';
const action = (what, command, extra = {}) => ({ action: what, command, ticket: null, check: null, ...extra });

// Rules 2 and 3: what outranks the agreement gap. Returns null when none applies
// and the caller should go on to rule 4.
//   running       — transaction.runningAttempts(root, id)
//   viewProblems  — the BASE_MISMATCH reasons for this change
function preface({ id, lifecycle, base = null, running = [], viewProblems = [] }) {
  if (running.length) {
    const first = running[0];
    return first.alive === false
      ? action('recover the interrupted attempt', `${RUNTIME} recover`, { rule: 2 })
      : action('wait for the running attempt', `wait for attempt ${first.id}, or ${RUNTIME} recover if its owner died`, { rule: 2 });
  }
  if (changes.TERMINAL.includes(lifecycle.state)) {
    return action('inspect the historical change; execution needs a new change',
      `${RUNTIME} change show ${id} — then register a replacement: ${RUNTIME} register --prd <prd> --change <id>`, { rule: 3 });
  }
  if (viewProblems.length) {
    return action('check out the branch that carries the change',
      `git checkout <branch with base ${String(base || '').slice(0, 7)}> — ${viewProblems[0].detail}`, { rule: 3 });
  }
  return null;
}

// Rule 3 again, after rule 4 is satisfied: a planned or paused change has to be
// brought to active before any ticket command will run.
function lifecycleAction({ id, lifecycle }) {
  if (lifecycle.state === 'planned') return action('activate the change', `${RUNTIME} change activate ${id}`, { rule: 3 });
  if (lifecycle.state === 'paused') return action('resume the change', `${RUNTIME} change resume ${id}`, { rule: 3 });
  return null;
}

// A ticket command resolves its ticket against the *selected* change, so when a
// report describes a change this worktree has not selected, the command it prints
// is refused with WRONG_CHANGE unless the selection is changed first. Commands that
// name their change explicitly (`change authorize <id>`, `change show <id>`) run
// as written and are left alone.
const TICKET_COMMAND = /(^|[^\w])(scripts\/pincer-ticket\.sh|pincer-runtime\.cjs)\s+(start|verify|done)\s+T-/;
function qualify(next, { id, selected = true }) {
  if (selected || !next || typeof next.command !== 'string' || !TICKET_COMMAND.test(next.command)) return next;
  return { ...next, command: `${RUNTIME} change select ${id}, then ${next.command}` };
}

module.exports = { preface, lifecycleAction, qualify, RUNTIME };
