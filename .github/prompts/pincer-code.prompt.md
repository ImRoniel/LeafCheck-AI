---
mode: agent
description: "Implement tickets sequentially with verification and one commit per ticket"
---
<!-- Generated from .claude/commands/pincer-code.md by scripts/sync-prompts.sh — edit the source, not this file -->


# /pincer-code — Ticket Implementation

You are implementing the tickets in `tickets/` sequentially. The approved PRD, ticket
breakdown, and existing session authorization define the work; run continuously and report
progress between tickets unless a material scope or design decision appears.

**Initial request:** ${input:request:Task brief or arguments (optional)}

Ticket state lives in the ticket file's frontmatter and is written **only** by
`scripts/pincer-ticket.sh` (`start` → `verify` → `done`). `verify` runs the ticket's
Verification block and stamps a receipt only on a green exit; `done` refuses without a
receipt that matches the current check, or with unticked acceptance criteria. Never edit
`status`, `started`, `last_check`, `verified`, or `finished` by hand — on Claude Code a hook blocks it.
On a migrated project (a change binding under `.prd/changes/`; the `Runtime` line of
`scripts/pincer-status.sh` names it) `verify` records an attempt under `.pincer/runtime/`
and writes no receipt into the ticket, and `done` consumes the current passing attempt
against the current source without re-running the check. `.pincer/`, `.prd/changes/` and `.prd/evidence/changes/`
are written only by the runtime; never edit or delete them by hand. On a project with
change records (`Runtime  changes …`) every `start`, `verify` and `done` first passes
the change gate: the ticket's change must be selected in this worktree, `active`
(`verify` also runs on a `completed` change), on a compatible branch, and authorized
for the current agreement — otherwise the command refuses with `SELECTION_REQUIRED`,
`WRONG_CHANGE`, `LIFECYCLE_BLOCKED`, `BASE_MISMATCH`, `DECISION_REQUIRED`,
`AUTHORIZATION_REQUIRED` or `AGREEMENT_CHANGED` before anything runs or is written.

## Before the loop

Run `scripts/pincer-status.sh`. It lists every ticket's state, what is blocked, elapsed
build time from the clock, and the next action. If a ticket is `in_progress`, you are
resuming: read it, check `git status` / `git diff` for uncommitted work, and continue
from wherever the receipt says you are. Do not ask the user to reconfirm unchanged,
previously authorized work. Read the `Runtime` line before the first ticket. `changes` (change records under
`.prd/changes/`) → run `node scripts/pincer-runtime.cjs resume` and follow its `Next`
line: it names the selected change, its lifecycle state, the agreement and the
authorization verdict, the blockers in order and the exact next command, all from the
files on disk. `resume --brief` is the same report projected to counts and one next
action — the same verdict and the same `Next` line, with every blocker category kept
and its `Detail` line naming the command that prints the rows it grouped. Prefer it
when you are orienting, and read the full report when a blocker needs its detail. Select the change to work on (`node scripts/pincer-runtime.cjs change
select <id>`; selection is local metadata and touches no source), activate it
(`change activate <id>`; refused until the user's authorization is recorded with
`change authorize` and no consequential decision is open) and resume a paused change
with `change resume <id>`. On a change with strict coverage (`Coverage strict …` in status) also read
`node scripts/pincer-runtime.cjs coverage` — it names the scenario, ticket, check or
decision that is next and every structural gap (`COVERAGE_INCOMPLETE`,
`SCOPE_UNAUTHORIZED`, `OBLIGATION_MISSING`) — and, after any PRD, ticket or map edit,
`node scripts/pincer-runtime.cjs impact` (`--from G-NN` for another baseline): it
lists the affected scenarios, tickets and checks with reasons and the dependency
dependents separately, and reports an unscoped PRD change or unavailable history
rather than "no impact". `legacy` and no ticket of this PRD carries legacy
receipts → register now (`node scripts/pincer-runtime.cjs register --prd .prd/prd-vN.md`,
commit `.prd/changes/` and `.gitignore` as `Register PRD vN`), then record the user's
approval (`change authorize …`, as `/pincer-narrow` describes), select and activate.
`legacy` with legacy receipts, or a v0.5.0 binding (`Runtime  change <id> · revision …`)
→ run `node scripts/pincer-runtime.cjs migrate --preview --prd .prd/prd-vN.md`, show
the plan (backups, receipts imported as history, the converted binding, the
`.gitignore` line, the local selection) and ask once whether to apply. Apply only on
a yes, then commit the rewritten tickets, `.gitignore` and the record as `Migrate PRD
vN to the runtime`. The migrated change is planned with no authorization: record the
user's actual earlier instruction with `change authorize` (the v0.5.0 free text is
history only) and activate it. Never migrate silently, and never apply when the
preview reports a conflict.

## Loop (per ticket, in dependency order)

1. **Start:** `scripts/pincer-ticket.sh start T-{NN}` — refuses while a `depends_on` ticket
   isn't done, and stamps the start time. Read the ticket and the files it references.
   Announce: "Starting T-{NN}: {title}."
2. **Implement.** Follow the conventions in `AGENTS.md` and the PRD's architecture and
   visual direction. Installing a dependency not named in the PRD's architecture is a
   stop-and-ask: verify it's the real package on the registry (linked repo, downloads —
   hallucinated names get typosquatted), say why it earns its place, and wait for a yes.
   For an S ticket, implement directly. For an M ticket touching isolated files, you may
   dispatch a subagent with a clean prompt: paste the full ticket body, the relevant
   conventions, and nothing else.
3. **Verify:** `scripts/pincer-ticket.sh verify T-{NN}` — runs the Verification block and
   writes the receipt only if it exits 0 (after migration it records an attempt with the
   captured log under `.pincer/runtime/` and writes no receipt into the ticket; readiness
   derives from the latest attempt and the current source). Red → fix and re-run; report the actual output,
   not assumptions. Green output is the definition of done, not your confidence. If the
   check only validated syntax or a build, say so — that is not behavioral proof. A
   visual judgment is recorded separately in evaluation, not as the receipt, and a tool
   the check needs but cannot run yields an explicit `unverified` result, never
   fabricated output.
4. **Self-review the diff** before committing: silent failures (empty catches,
   un-awaited promises), leftover debug code, drift from the ticket's acceptance criteria.
   Then a security sweep of the same diff:
   - Check for secret-like assignments without printing values. If a scanner reports a
     possible secret, report only its file and line until the value is safely redacted;
     environment references and names in `.env.example` are allowed.
   - External input touched by this diff is validated server-side, and untrusted
     content (user input, LLM output) is escaped where rendered — per the
     Security defaults in `AGENTS.md`.
   - No error path leaks internals (stack traces, key names with values) to the client.
   If the review changed code, run `verify` again — the receipt must match the code you commit.
5. **Close the ticket:** tick every verified acceptance-criteria checkbox (`- [ ]` → `- [x]`;
   editing the checkboxes is allowed), then `scripts/pincer-ticket.sh done T-{NN}`. After
   migration `done` consumes the current passing attempt and does not re-run the check; it
   refuses with a reason code (`SOURCE_CHANGED`, `CHECK_CHANGED`, `CHECK_FAILED`,
   `CRITERIA_UNTICKED`, …) and the next step when the latest attempt is not current. A
   criterion that was cut is a scope change to record in the PRD, not a box to skip.
   Inspect `git status --short`, preserve pre-existing staged work, and stage only the
   explicit paths changed for this ticket plus its ticket file. Review `git diff --cached`
   before committing as `T-{NN}: {title}`.
6. Give a one-line progress update ("T-02 done, 3 remaining") and continue. Quote the
   wall-clock elapsed figure from `scripts/pincer-status.sh` when it shows one — it
   appears while a ticket is in progress or a budget is set, and it is not a measure
   of active execution time.

## Recovering a ticket file

Ticket lifecycle fields are written only by `scripts/pincer-ticket.sh`, and the guard
also blocks shell restores that would touch ticket files from the assistant's shell:
`git checkout`/`git restore`/`git switch` naming a ticket path or a normalized
pathspec that cannot be shown to stay outside `tickets/` (the whole tree, `.`, `:/`,
`:(top)`, globs, absolute or unexpanded paths, `tickets/…` in any spelling, a
`-C tickets` prefix), force flags (`-f`, `--force`, `--discard-changes`,
`--pathspec-from-file`), `git reset --hard|--merge|--keep`, `git stash` (except
`list`, `show`, `create`, `store`), `git clean -f` without a narrow pathspec,
`git checkout-index -a` and `git read-tree -u|--reset`, including when wrapped in
`bash -c`, `eval`, `nice`, `time`, `nohup`, `timeout` or `xargs`. Restoring HEAD
would erase a newer failed attempt and revive an old passing receipt. Branch
switches and file-specific restores outside `tickets/` stay allowed. The guard is a
pattern-based safety net for documented mistake forms, not a complete shell
boundary; the receipt and status checks remain the source of trust. When a ticket file is malformed or its state was hand
edited, preserve the malformed contents as they are, report the validation error that
the script or `scripts/pincer-status.sh` printed, and hand the repair to the user, who
performs it in their own terminal. Then return through the lifecycle — `start`,
`verify`, `done` — so the ticket carries fresh verification; a restored receipt is
never evidence. Do not recommend restoring source files or unrelated edits as routine
ticket repair. One exception: when the PRD is built with valid candidate evidence;
tracked files other than the ticket file being restored match the evaluated candidate
(or the candidate plus its evidence-only commit) with nothing untracked; the recorded
failure is explained by a working-tree change that has since been reverted (the failed
`last_check` was stamped while source differed from the candidate, and that difference
is gone); and the ticket's Verification block passes when run
directly rather than through `verify` (which would write a receipt), in the
same execution context as `verify` — the same shell, working directory, `PATH`
and environment, with no substituted binary and no repair made first — then
the committed evaluation still describes the tree. Say so, name the exact command
for the user to restore the ticket file in their own terminal, and
do not run `verify`, refresh the receipt or commit anything — the restored file is
what is already committed, not new evidence. If the block fails on that clean tree,
the failure is real: keep the failed `last_check` and repair through the lifecycle.
A changed executable, runner, working directory or environment repair requires a
new recorded verification through `verify`; the exception does not apply to it.
An unexplained failure cannot be cleared by restoring a receipt: when no
since-reverted source change explains it (a service down, a missing dependency, a
check that reads external data), keep the failure, name the cause you observed, and
ask for the environment to be repaired before `verify` runs again.
If source still differs from the candidate, name the differing paths and let the
user decide rather than asking which way to fix them; permission to restore a ticket
does not authorize discarding source changes.
After migration (a change binding exists) recovery is the lifecycle itself: retain the
failure, repair the cause, run `verify` again; readiness derives from the latest attempt,
both attempts stay in `.pincer/runtime/` and no tracked file changes. Never restore a
ticket file or delete `.pincer/runtime` to obtain a green status; the legacy exception
above applies only before migration. A session that died mid-`verify` leaves a `running`
attempt: run `node scripts/pincer-runtime.cjs recover`, which finalizes it as
`interrupted` once the owner process is gone, then `verify` again.

## Changes: pausing, decisions and completion

- Stopping before the change is complete (end of session, switching to another
  change): `node scripts/pincer-runtime.cjs change pause <id> --reason "<why>" --note "<handoff for the next session>"`
  and commit the record. Pausing keeps every ticket state, attempt and authorization;
  it refuses while a check is running (`recover` first if its owner died). A fresh
  session runs `resume`, then `change resume <id>` under the existing authorization —
  do not ask the user to re-approve unchanged scope. Another change's work in the
  meantime makes this change's passing attempts `SOURCE_CHANGED`; verify again, do
  not ask for approval again.
- A newly discovered consequential choice: `node scripts/pincer-runtime.cjs change decide <id> --summary "<the question>"`
  blocks execution (`DECISION_REQUIRED`) until the user answers; record the answer with
  `change decide <id> --resolve D-NN --reference "<where>" --excerpt "<the user's words>"`,
  then `change authorize <id> --agreement <digest> --reference … --excerpt … --decision D-NN`.
  A revision within the user's delegation (for example an added regression check for
  approved behavior) records `change authorize <id> --agreement <digest> --delegated --basis A-NN --explanation "<why it stays within the delegation>"`
  without asking again, and the changed check still needs fresh verification.
- Editing the PRD under its filename, or a ticket's acceptance text, dependencies,
  size, timeout, association or check — and, with strict coverage, a scenario's text,
  a map link, a declared command or timeout, or a scope entry — changes the agreement:
  execution refuses with `AGREEMENT_CHANGED` (status shows the structural difference;
  `impact` explains it) until its disposition is recorded as above. Ticking criteria, starting or closing tickets and recording
  attempts never change it. An `AGREEMENT_CHANGED` caused by an edit this session
  did not make — a revised PRD, an added or changed ticket found on resume — is a
  consequential decision: raise it with `change decide <id> --summary "<what changed>"`,
  report the structural difference (and the `impact` report) and stop. A general instruction to continue,
  resume or not re-ask never authorizes new scope; record a `user` authorization for
  the revised agreement only for an instruction that names the revised content. With strict coverage a scenario that will not be delivered is
  never dropped from the map or the PRD: it is deferred or removed through a decision
  the user resolves naming it, a `scope` entry (a removal keeps a tombstone naming the
  prior agreement) and an authorization naming that decision; `coverage` reports
  `OBLIGATION_MISSING` or `SCOPE_UNAUTHORIZED` until then, and `change complete`
  refuses. A revised check declaration (a stricter command, an added check) within the
  user's delegation is a `--delegated` authorization and needs fresh verification.
- When every ticket is done and ready: `node scripts/pincer-runtime.cjs change complete <id>`
  (it refuses unfinished tickets, unticked criteria, stale or failed verification and
  open decisions; with strict coverage also an incomplete map, an unauthorized
  disposition or a missing obligation, before the ticket gate) and commit the record
  as `Complete PRD vN`. Completion never asks for candidate evidence. Completed means ready
  for evaluation, not evaluated or released; a later finding is `change reopen <id> --reason …`
  plus a fix ticket.

## Budget rules

- If the user set `PINCER_BUILD_BUDGET_MIN` or stated another budget, use the elapsed
  figure from `scripts/pincer-status.sh` rather than estimating. If the remaining tickets won't fit,
  stop and propose a scope cut: which remaining tickets to drop or shrink. Cutting scope
  deliberately beats an unfinished mess — record the cut in the PRD's Out of Scope.
- If a ticket reveals the plan was wrong, stop and say so rather than silently diverging.
  Update the ticket/PRD, then continue.

## When all tickets are done

On a project with change records, complete the change first (`change complete <id>`,
committed as `Complete PRD vN`). Then update the PRD to `status: built` and commit that change on its own (`PRD vN: built`).
The built transition is part of the candidate that `/pincer-evaluate` reviews; it is
never moved into a later evidence-only commit. Then finish with:
"All tickets built. Run `/pincer-evaluate` for a final quality pass."

## Authorization rule (shared by plan, narrow, code and evaluate)

Reuse explicit authorization for the same scope and decisions; ask only about a
material choice not already authorized, and prepare the concrete proposal before
asking. A decision the user delegated (for example "pick the architecture") does not
need another approval when you exercise it, but a newly discovered consequential
choice is surfaced before implementation. Record the authorization basis and the
scope it covers in the PRD or the handover, and on a project with change records as
a `change authorize` record (the user's words as the excerpt, or a `--delegated`
disposition with its basis). An agent-written record or a status
field is not authenticated human approval. When resuming without the context that
granted authorization, do not invent it — read the `resume` report; an authorization
it reports as `current` needs no repeat approval, and any other verdict is asked.
