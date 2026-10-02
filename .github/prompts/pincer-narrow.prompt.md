---
mode: agent
description: "Turn the approved PRD into local, AI-ready ticket files"
---
<!-- Generated from .claude/commands/pincer-narrow.md by scripts/sync-prompts.sh — edit the source, not this file -->


# /pincer-narrow — PRD to Local Tickets

You are decomposing the PRD into coherent, independently verifiable tickets stored as
local markdown files (no external tracker needed). Ticket count and size follow the
change's dependencies and risk, plus any budget the user supplied. There is no hard
one-to-two-ticket cap for small PRDs and no default timebox: cohesion and dependencies
decide the count. A breakdown that follows the PRD needs no second approval; a newly
discovered consequential choice is surfaced before implementation.

**Initial request:** ${input:request:Task brief or arguments (optional)}

## Steps

1. Run `scripts/pincer-status.sh`. If tickets already exist for another PRD, leave them
   as history. New tickets continue the numbering and existing ones are never renumbered.
   If tickets already exist for this PRD, extend them only when the current request already
   authorizes that work; otherwise present the concrete addition before asking. Then read the
   PRD (`${input:request:Task brief or arguments (optional)}` or the latest `.prd/prd-v*.md`). If its status isn't `draft`, ask
   which PRD to use.
2. Decompose into tickets. Rules:
   - Each ticket is one coherent unit. Use S, M, or L as relative scope indicators and
     split work when that improves dependency order, verification, or ownership.
   - For greenfield work, use a walking skeleton when it reduces integration risk. For
     brownfield work, begin with the smallest protected vertical change; add a
     characterization ticket before changing load-bearing code that lacks coverage.
   - Order by dependency; note blockers explicitly ("depends on T-01").
   - Build the requirement map: for every `R-NN` in the PRD and each of its
     scenarios, name the ticket that owns the implementation and the executable
     check that exercises it, or an explicit review method when no executable check
     exists. Record the IDs in each ticket's Context as `Implements: R-NN, R-MM`
     (a navigation aid). Enabling work that implements no requirement states its purpose
     in the ticket Objective. Resolve missing coverage and conflicting criteria with
     the user before implementation; do not start with an unmapped required scenario. On a change with change records, author the map once as
     `.prd/coverage/<change id>.json` (coverage map schema 1, "Coverage map" in
     `docs/runtime-contracts.md`). Start from
     `node scripts/pincer-runtime.cjs coverage scaffold --change <change id>`: it prints
     a read-only draft listing every live scenario exactly once with its requirement,
     every ticket with its objective, its own `Implements:` claim and its Verification
     text, and an `Unresolved` list of what is still unauthored. It writes nothing,
     adopts nothing and decides nothing — it removes the transcription, not the
     judgment, so a ticket's claim is material to check rather than a link, and no check
     command, ticket role or scope disposition is ever invented. The draft is not a map:
     it carries no `schema` key and `coverage adopt` refuses it. You author the real map
     yourself, working through the draft's unresolved entries:
     one `scenarios` row per `S-NN` naming its
     implementing tickets and declared checks, every ticket of the change in
     `tickets` as `implements` or `enables` (with a rationale), each check declared
     once in `checks` with its kind, `required` flag and, for a command, the exact
     command line and timeout, and a `scope` entry (`deferred` or `removed`) for a
     scenario this change will not deliver, naming the decision that records the
     user's choice. The map is authored work you edit by hand; the runtime never
     rewrites it, and it validates it against the PRD's definitions.
   - Every ticket gets a runnable command in its Verification block — a fenced `bash`
     block that exits 0 only when the ticket is done. `scripts/pincer-ticket.sh verify`
     runs it verbatim and stamps the receipt that `done` requires, so it must be
     non-interactive and self-contained (no "check by hand"). An optional
     `timeout: <seconds>` frontmatter field (default 600) bounds the run; it is part of
     the check identity, so changing it invalidates earlier passes.
   - Each Verification section opens with `Proves:` — what the check establishes and
     which regression it detects. A check for an executable change must exercise
     observable behavior (including relevant rejection paths and, in brownfield work,
     preservation of existing behavior) and fail when the behavior is wrong, not only
     when an identifier is renamed. Reuse adequate focused tests. A build, a syntax
     check, or an identifier grep alone is not proof; static assertions are primary
     evidence only for static contracts such as generated files, and `Proves:` says so.
   - Adequacy is a judgment about what the command observes, never a word match: do
     not call a command sufficient because it contains `grep`, `test`, or a runner
     name, nor insufficient for lacking them. Manual visual judgment is recorded
     separately in evaluation; a tool the check needs but cannot run yields an
     explicit `unverified` result, never fabricated evidence or a silent waiver.
   - If the brief or stack implies automated tests, at least one ticket's verification
     command must be the test runner (e.g. `npm test`) — manual checks alone don't count.
   - Any ticket whose surface accepts external input (HTTP endpoint, form, file,
     LLM output) gets an acceptance criterion for the reject path — what invalid
     input produces (e.g. "empty goal → 400 with a clear message"), not only the
     happy path.
   - A greenfield setup ticket includes `.gitignore` covering `.env*` (except
     `.env.example`) and an `.env.example` naming any required secrets before any
     secret can exist in the repo. In brownfield repositories, preserve and verify
     the existing ignore and environment conventions.
3. Write each ticket to `tickets/T-{NN}-{slug}.md` using
   `.claude/references/ticket-template.md`, with `status: open` and an explicit
   `prd: .prd/prd-vN.md` naming the selected PRD. Never infer this association from
   numbering or old notes. The other state fields
   (`started`, `last_check`, `verified`, `finished`) are added later by `scripts/pincer-ticket.sh` —
   never write them yourself.
4. Present the ticket list (number, title, size, dependencies) as a table, followed
   by the requirement map as a second table (requirement · scenario · ticket · check
   or review method). Whether the map is complete and each check is adequate is your
   judgment as the author; say so rather than presenting the table as mechanical proof.

Present the concrete breakdown and build order as a report, not a question. Reuse
existing authorization for the same scope and order.

5. Finalize. A breakdown that follows the PRD is already authorized by the PRD: do not
   ask whether to proceed. Update the selected PRD frontmatter to `status: ticketed`,
   inspect existing staged changes, stage that PRD and the explicit new ticket paths,
   review `git diff --cached`, and commit only those paths. Ask first — and finalize
   once it is resolved — only when step 4 surfaced a newly discovered consequential
   choice or a scope change the PRD does not cover. Then register the change when the
   `Runtime` status line says `legacy` and no ticket of this PRD carries legacy
   receipts, or `changes` (the project already keeps change records):
   `node scripts/pincer-runtime.cjs register --prd .prd/prd-vN.md` writes the change
   record `.prd/changes/prd-vN.json` (retaining every earlier change); stage
   `.prd/changes/` and `.gitignore` (registration adds `.pincer/` to it) and commit them
   as `Register PRD vN`. Then record the user's actual approval against the agreement
   the record binds — `node scripts/pincer-runtime.cjs change show prd-vN --json`
   prints the agreement digest — with
   `node scripts/pincer-runtime.cjs change authorize prd-vN --agreement <digest> --reference "<where the user said it>" --excerpt "<the user's approval, quoted>"`,
   select it for this worktree (`node scripts/pincer-runtime.cjs change select prd-vN`)
   and commit `.prd/changes/` as `Authorize PRD vN`. When the map was authored, adopt
   strict coverage explicitly: `node scripts/pincer-runtime.cjs coverage adopt --preview --change prd-vN`
   shows the inventory, the map digest and the agreement it records (it refuses an
   incomplete map, naming the scenario or ticket); `--apply` writes the schema 3
   record with a backup and grants nothing — record the user's approval of that
   agreement with `change authorize` (the same instruction, if it named this
   breakdown; a delegated disposition needs its basis) and commit `.prd/coverage/`
   and `.prd/changes/` as `Adopt strict coverage for PRD vN`. A scenario the user
   deferred or removed is a decision: `change decide --summary "<the choice>"`,
   `--resolve D-NN` with the user's words naming the scenario, the `scope` entry in
   the map, then `change authorize … --decision D-NN`. Never record a disposition
   the user did not state; `coverage` reports `SCOPE_UNAUTHORIZED` until it is. The excerpt records the user's own
   words; running the command proves nothing by itself, and a registration, a PRD
   status or a passing check never becomes an authorization. A project whose tickets
   carry legacy receipts, or that still holds a v0.5.0 binding (`Runtime  change <id> ·
   revision …`), is migrated from `/pincer-code` after a preview, never here. Finish with:
   "Tickets ready in `tickets/`. Run `/pincer-code` to start implementing."

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
