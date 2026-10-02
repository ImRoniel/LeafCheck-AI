---
mode: agent
description: "Where the workflow stands — PRD, tickets, receipts, elapsed time, next action"
---
<!-- Generated from .claude/commands/pincer-status.md by scripts/sync-prompts.sh — edit the source, not this file -->


# /pincer-status — Where are we?

You are orienting in a repo that uses PINCER, typically after a context reset or at the
start of a session. Read-only: change nothing.

## Steps

1. On a project with change records, start with
   `node scripts/pincer-runtime.cjs resume --brief`. It is one read that answers the
   question this command exists for: the selected change and its lifecycle, the
   authorization verdict, the coverage label, ticket and attempt counts, every blocking
   reason category with its count, and the exact next command — the full report's own,
   copied, never recomputed. Reading the full `resume`, `status` and `coverage` reports
   in sequence to find one next action costs several kilobytes to answer in a line, and
   on a large change the full report grows with the work while the answer does not.
   Read further only when the brief gives you a reason to: it ends with the `Detail`
   line naming the command that prints every row it grouped.
2. When you need the detail — a blocker you must act on, a ticket list, an attempt
   history — run `scripts/pincer-status.sh`. It reads the artifacts on disk (`.prd/`,
   `tickets/`,
   `NOTES.md`) and prints the PRD state and profile, every ticket with its state and
   clock-based elapsed time, what is blocked, wall-clock build time while a ticket is in
   progress or against an explicit user budget, the `Runtime` line (legacy receipts or
   the registered change), the evidence verdict and `Provenance` line for the evaluated
   candidate, any warnings (each readiness problem once), and the next command to run.
   `scripts/pincer-status.sh --json` prints one status object with reason codes and the
   next action for tooling; `node scripts/pincer-runtime.cjs ready [T-NN]` is the
   read-only gate. On a project with change records (`Runtime  changes …`)
   `node scripts/pincer-runtime.cjs resume` is the full report: it reports the selected change, its
   lifecycle, agreement and authorization, decisions, references, tickets, attempts,
   candidate, the authored handoff note and the next command, and never writes;
   `change list` shows every retained change, `status --change <id>` and
   `resume --change <id>` inspect another one without selecting it. `resume` is the
   report; `change resume <id>` is the lifecycle operation. The `Coverage` line says
   `strict` or `unverified`; on a strict change `node scripts/pincer-runtime.cjs coverage`
   (and `impact` after an edit) name the exact scenario, ticket, check or decision
   that is next — quote them rather than inferring coverage from the ticket list.
   On a legacy project there is no change record to summarize, so `pincer-status.sh`
   is the first read.
3. Report in three lines: where the workflow is, what is in progress or blocked, and the
   next command. Quote the `Next` line as-is. When the `Runtime` line says `legacy`,
   add the register or migrate command it names as the step that precedes the next
   ticket (fresh project → `register`, legacy receipts → `migrate --preview`, a v0.5.0
   binding → `migrate --preview`, no selection → `change select <id>`).
4. If a ticket is `in_progress`, read it and `git status`, then offer to resume it with
   `/pincer-code T-{NN}`. If the script printed a warning, surface it — a done ticket
   without a receipt was marked by hand and needs `scripts/pincer-ticket.sh verify T-{NN}`.
   Never restore a ticket file from git to clear a warning; a failed attempt is a record.
   The one exception is the tree-back-at-candidate case in the recovery section of
   `/pincer-code`: the user restores the ticket file, and nothing is verified or committed.
   It applies only when the recorded failure is explained by a since-reverted source
   change and the block passes in the same execution context as `verify`; an
   unexplained failure (a service down, a missing dependency) stays a failure until the
   environment is repaired and `verify` passes again. After migration never restore a
   ticket file or delete `.pincer/runtime` to clear a warning: repair the cause and run
   `verify` again; a dead session's `running` attempt is finalized by
   `node scripts/pincer-runtime.cjs recover`.
