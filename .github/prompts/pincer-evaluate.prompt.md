---
mode: agent
description: "Final quality pass over everything built — high-confidence findings only"
---
<!-- Generated from .claude/commands/pincer-evaluate.md by scripts/sync-prompts.sh — edit the source, not this file -->


# /pincer-evaluate — Final Quality Pass

You are reviewing all work built this session against the PRD and tickets. Autonomous —
run the pipeline, then present results.

## Steps

1. Run `scripts/pincer-status.sh`. Review only tickets associated with the selected
   PRD. Every such ticket should be `done` with a current receipt; if one
   is still open or in progress, stop and ask whether it was cut (then it goes in the
   PRD's Out of Scope) or should be finished first via `/pincer-code`. Then get the full
   diff of the change: identify the actual base commit before this change from
   its ticket commits and recorded context. If it cannot be established, resolve
   that uncertainty before claiming a complete review. Record full commit IDs for
   `base` and `candidate` (`git rev-parse HEAD`), then review `git diff <base>..<candidate>`.
   The candidate is the clean, committed tree that already includes the implementation,
   the ticket closures, on a project with change records the `change complete` commit
   (the `Runtime` line reads `… · completed ·`; `check` and `evidence export` refuse an
   active, paused or unauthorized change), and the PRD `status: built` commit:
   `git status --short` must be empty before review. If anything is uncommitted or the PRD is not yet built, return
   to `/pincer-code`; do not review a dirty tree.
2. Dispatch a `code-quality-reviewer` agent with: the diff, the PRD's Success Criteria and
   Scope sections, and the list of tickets. If the diff is large, split by area and
   dispatch two in parallel. (No subagents on this platform? Review the diff yourself
   in a separate pass, applying `.claude/agents/code-quality-reviewer.md` as the rubric.)
   Keep the reviewer's report — or its explicit no-findings statement — for step 9,
   where it is saved as an artifact; a review that left no record cannot be audited.
3. Yourself, in parallel, check spec compliance. On a change with strict coverage
   (`Coverage strict …` in status) start from `node scripts/pincer-runtime.cjs coverage`:
   its structure must be complete, and its scenario rows are the obligations — the
   export derives every disposition from the map and the outcomes, so you do not
   author `requirements`; your judgment is recorded as `adequacy` (whether the
   declared checks and reviews really establish their scenarios) and in
   `coverage_review`. Otherwise, for every requirement `R-NN` in the
   PRD record one disposition: `delivered` (evidence on this candidate), `blocked`
   (required behavior failed or was left unverified — this blocks PASS; do not relabel
   it a known limitation to pass), or `deferred` (only with explicit user authorization;
   record the scope decision in the PRD's Out of Scope and evaluate the revised
   candidate). Compare what was built against every ticket's acceptance criteria and
   the PRD scope, and list any gaps. Whether the requirement map is complete and each
   check is semantically adequate is your judgment as reviewer — record that judgment
   in the evaluation; the kit is not a mechanical traceability engine and does not
   validate requirement-revision impact.
4. If the project has a UI, look at it — don't only read the code. Start it, open it in
   the browser (screenshot via Chrome DevTools MCP if available), and check it against
   the PRD's Visual Direction and Success Criteria. Note anything visibly broken or off.
5. Run a mechanical security audit:
   - Inspect the relevant history with a secret scanner that redacts values, when one is
     available. Otherwise review likely locations without copying candidate values into
     output. Report file, line, and remediation only; a secret committed then deleted is
     still leaked.
   - `.gitignore` covers `.env*` (except `.env.example`), and `git ls-files | grep -i env`
     shows only `.env.example`.
   - `npm audit --omit=dev` (or the ecosystem's equivalent) — report high/critical only.
   - If there's an HTTP API: hit one endpoint with invalid input (empty, oversized)
     and confirm a clean 4xx with a generic message, no stack trace.
6. Filter the agent's findings: report only issues you'd flag in a real PR review —
   concrete bugs, silent failures, misleading code. Drop nitpicks and style opinions.
7. Present findings as a short list with `file:line` references, ordered by severity.
   Security findings always rank above style-adjacent ones. For each, say whether you
   recommend fixing now through a ticket or recording it as a known issue.
8. Fix findings clearly within the authorized PRD through a new ticket associated with
   that PRD. Use `pincer-ticket.sh` to start, verify, and close it, then make a scoped
   `T-{NN}: {title}` commit. Ask only when a fix changes scope, architecture, or another
   material decision; never make an ad-hoc `review: fixes` commit. Every fix commit
   produces a new candidate: re-record `candidate`, re-run the checks against it, and
   write fresh evidence in step 9 — never reuse a manifest from a previous candidate.
9. Persist evidence for the candidate under `.prd/evidence/prd-vN/<candidate>/`.
   Strict coverage: run every declared command check as
   `node scripts/pincer-runtime.cjs check C-NN --candidate <sha>` (no command, no
   timeout: the map's declaration is the only source, and a supplied command is
   `CHECK_UNDECLARED`); record each declared review or visual obligation in the
   draft with its `result` and an artifact saved under the candidate's evidence
   directory (a required one that is not passed with an artifact is
   `REVIEW_MISSING`); write `adequacy: { verdict: "adequate" | "inadequate", note }`;
   list every declared check once and no `requirements` (they are derived). The
   export writes the inventory and map snapshots under `coverage/`, derives the
   scenario and requirement rows and `delivery` (original versus agreed scope) and
   validates them against the committed candidate; an `inadequate` judgment or a
   failed required check is recorded honestly and blocks readiness. Migrated
   project without strict coverage (the `Runtime` status line names a change): run
   each executable check through the runtime on the clean candidate view —
   `node scripts/pincer-runtime.cjs check C-NN --candidate <sha> -- <command>` (one
   command per check, the command line as run; `npm test` stays one aggregate check) —
   then write the authored fields to a draft outside the evidence directory, for
   example `.pincer/drafts/<sha>.json`: `environment.tools` and `environment.limitations`,
   `coverage_review`, `requirements`, review and visual checks with their saved
   artifacts, `visual_review`, and a stub `{"id": "C-NN", "kind": "command",
   "required": true|false}` for each executable check. Then run
   `node scripts/pincer-runtime.cjs evidence export --candidate <sha> --base <base> --prd .prd/prd-vN.md --draft <file>`.
   The export writes `checks/C-NN.log` from the captured logs, fills `command`,
   `result`, `provenance: runtime` and `attempt` from the attempts, labels review and
   visual checks `provenance: authored`, computes the digests and writes an evidence
   schema 2 manifest; it refuses a dirty tree, a HEAD that is not the candidate, a stub
   without an attempt, and a `passed` or `failed` command result written by hand. On a
   project with change records the export also appends the evaluation to the change's
   locator `.prd/evidence/changes/<id>.json` (the identity of this change's
   evaluation; root `NOTES.md` stays the human summary and may be overwritten by a
   later change's evaluation without losing this one) — commit the locator with the
   evidence. A tool that cannot run is recorded as an authored command check with
   `result: unverified` and a note, as before. Legacy project (no change binding):
   author the schema 1 manifest as follows.
   - `checks/C-NN.log` — the command and a redacted summary or safe log of each
     executable check. Never secrets, never an environment dump. Record
     one check per command: `command` holds the command line as run, never prose
     describing a session, and a manual smoke run is recorded as the command lines
     that were run (separate entries when they establish independent outcomes).
     Independently assessed commands — the tracked `.env` check, the secret scan,
     the dependency audit — are separate `checks` entries with their own `result`
     and log, so only the tool that could not run is `unverified`. A test runner
     such as `npm test` stays one aggregate check; do not split every subprocess or
     assertion. Visual and review checks keep their kinds and get no artificial
     shell command. Note a redaction rather than inventing a substitute command.
   - `visual/<scenario>.png` — each visual capture from step 4, with its scenario,
     viewport and observed result recorded in the manifest. When nothing renders,
     record `visual_review: {applicable: false, reason}` and say why.
   - `review/code-quality.md` — the reviewer's findings from step 2 with their
     dispositions, or its explicit no-findings statement, recorded as a check of
     kind `review` and referenced by the requirements it covers.
   - `manifest.json` — evidence schema 1 (field list in the header of
     `scripts/pincer-evidence.cjs`): selected PRD, full `base` and `candidate` IDs,
     `created`, `environment` with tool limitations, `coverage_review` (your judgment
     from step 3), one `requirements` entry per `R-NN` with its disposition, tickets
     and check IDs, one `checks` entry per check with `kind`, `required`, `result`,
     `command`, timestamp and artifact paths, and `artifacts` with digests from
     `node scripts/pincer-evidence.cjs digest <file>...`.
   A tool you cannot run yields a check with `result: unverified` and a note — never a
   fabricated artifact. A deferred requirement carries `authorized_by` naming the
   user's explicit authorization. Then run
   `node scripts/pincer-evidence.cjs validate .prd/evidence/prd-vN/<candidate>/manifest.json --candidate <candidate> --prd .prd/prd-vN.md`
   and correct the manifest until it prints `ok`; the same validator runs in status
   and release. It checks the record's consistency, not that the commands ran.
10. Close out: write a brief `NOTES.md` at the repo root with frontmatter:
   ```yaml
   ---
   prd: .prd/prd-vN.md
   base: <full reviewed base commit ID>
   candidate: <full reviewed candidate commit ID>
   evidence: .prd/evidence/prd-vN/<candidate>/manifest.json
   ---
   ```
   Then commit NOTES.md, the manifest, its listed artifacts and (change records) the
   evaluation locator — and nothing else —
   as `evaluate: PRD vN candidate <short sha>`. Status accepts this later commit only
   when its diff from the candidate is limited to `NOTES.md`, the candidate's evidence
   directories and evaluation locators; changes to source, tests, configuration,
   tickets, the PRD or the change record (a lifecycle transition after the
   candidate) require reevaluation. Legacy notes without these references
   do not establish readiness. Then describe what was built, what was cut
   and why, known issues, and what you'd do next with more time. Then a **Handover**
   section, written for the stranger who inherits this repo in six months: how to get
   oriented (which file to read first), what each dependency is for and why it earned
   its place, and what breaks first as the code ages (the riskiest assumption, the
   least-tested path). This is the first document a reviewer of this repo should read;
   summarize the requirement dispositions from the manifest in it.
11. Suggest `/pincer-release` as the final step: "Run `/pincer-release` for a pass/fail audit of the
   whole workflow's artifacts."

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
