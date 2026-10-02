#!/bin/bash
# PINCER ticket state machine — the ONLY writer of a ticket's lifecycle fields.
# Compatibility wrapper: every call is executed by scripts/pincer-runtime.cjs
# (docs/runtime-contracts.md). On Claude Code a PreToolUse hook
# (.claude/hooks/ticket-guard.sh) blocks hand edits of those fields so "done"
# can only be reached through a passing check.
#
#   scripts/pincer-ticket.sh start  T-03   open -> in_progress; refuses while a depends_on ticket isn't ready
#   scripts/pincer-ticket.sh verify T-03   runs the ticket's Verification block and records the outcome
#   scripts/pincer-ticket.sh done   T-03   closes the ticket on a current passing check with all criteria ticked
#   scripts/pincer-ticket.sh bind   T-03 .prd/prd-vN.md   associates a legacy ticket with its PRD
#
# Unmigrated (legacy) projects keep the v0.4.1 receipts: `verify` writes
# `last_check` and `verified` into the ticket and `done` re-runs the check.
# Migrated projects record attempts under .pincer/runtime/ and `done` consumes
# the current passing attempt. Exit codes follow docs/runtime-contracts.md.
command -v node >/dev/null 2>&1 || {
  echo 'pincer-ticket: Node.js 22+ is required — the runtime is scripts/pincer-runtime.cjs' >&2
  exit 4
}
case "${1:-}" in
  start|verify|done|bind) ;;
  *) sed -n '8,11p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
exec node "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/pincer-runtime.cjs" "$@"
