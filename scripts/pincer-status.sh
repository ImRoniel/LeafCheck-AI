#!/bin/bash
# PINCER status — where the workflow stands, read from the artifacts on disk.
# Read-only. Every playbook runs this first; /pincer-status wraps it.
#
#   scripts/pincer-status.sh [--json]
#
# Compatibility wrapper: the report is computed by scripts/pincer-runtime.cjs
# (`status`), which prints the PRD state and profile, every ticket with its
# state and clock-based elapsed time, the wall-clock elapsed build line while a
# ticket is in progress or PINCER_BUILD_BUDGET_MIN is set, the evidence verdict,
# readiness warnings, and the next command. Exit codes follow
# docs/runtime-contracts.md (0 inspected, 4 invalid input).
command -v node >/dev/null 2>&1 || {
  echo 'pincer-status: Node.js 22+ is required — the runtime is scripts/pincer-runtime.cjs' >&2
  exit 4
}
exec node "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/pincer-runtime.cjs" status "$@"
