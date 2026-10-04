---
version: 3
status: built
date: 2026-10-04
---

# Report text to automatic plant care tasks

## 1. Problem

After a scanned plant is saved in My Garden, the user wants simple care tasks to appear automatically in Care Tasks, derived from the Gemini report using `tasknotes-nlp-core`. Today automatic task creation already exists, but uses Gemini's separate `careTasks` JSON array. The change is to make actionable report text the source of those tasks, while making saving reliable and the outcome clear to the user.

Original brief: “I want to Use the tasknotes-nlp-core library to parse the Gemini report text into an array of task objects. But the thing is I want you to analyze what is our scan/camera to gemini/llm AI workflow before we Implement this feature. The goal of this feature is after thle plants save in your My garden it should automatically create a task in my care task screen. It should be easy to undestand.”

Planning profile: standard. This crosses an external LLM contract, natural-language date parsing, relational persistence, and existing scanner/task behavior. Existing PRDs v1 and v2 are preserved; this is a separate feature, not a revision of scanner lifecycle work. Status reported no active tickets. The prior change's agreement/coverage warnings are not resolved by this draft.

## 2. Solution

Keep the existing scan-first experience: take a photo, receive a report, and automatically save the plant with its care tasks. Ask Gemini to include a clearly headed `Care actions` section in `diagnosticReport`, with one short action per bullet and explicit scheduling language. A backend adapter extracts only those bullets, calls `tasknotes-nlp-core` once per action, and maps the results to the existing care task objects. Persist plant, identification, report, tasks, and plant health together in PostgreSQL. Reuse the existing task screen and account synchronization; no second AI call or manual task-entry step is needed.

Selected planning defaults: English action text; UTC scheduling because the current API has no user timezone field; preserve automatic task generation on existing-plant rescans. The user invoked `$pincer-narrow` after presentation of this concrete draft and its rescan/default-reminder proposal, carrying that proposed scope forward into tickets. Visual direction keeps the current design with short, plain task titles.

Authorization basis: the user's subsequent instruction `$pincer-narrow`, in direct response to the saved draft and proposed architecture, authorizes decomposition of this PRD without a second approval of the same scope. Record that exact instruction with its conversational context against this change's agreement; do not reuse earlier changes' authorizations. Actual implementation begins when the user invokes `$pincer-code`. No commit is made under the project's explicit no-commit instruction.

## 3. Scope

| This PRD covers | This PRD does NOT cover |
| --- | --- |
| Camera-to-provider-to-save workflow analysis | Camera redesign or reopening changes from PRD v2 |
| Backend report-action extraction using the requested library | Parsing arbitrary prose into instructions or a second LLM extraction call |
| Existing CareTask object mapping and automatic persistence | A new task database, raw SQL, or database/provider upgrades |
| Atomic saving and readable task feedback | Push notification delivery or a recurring task engine |
| Existing task listing, completion, and scan synchronization compatibility | Historical report backfill, guest AI scans, or manual plant creation generating AI advice |

## 4. Requirements

### R-01 — Make report actions the task source

- **S-01:** Given a valid report with two `Care actions` bullets, parsing produces two task objects through `tasknotes-nlp-core`, preserving each action's conditions and details; diagnoses and environmental prose do not become tasks.
- **S-02:** Given absent, empty, or unusable action bullets in an otherwise accepted report, return one routine `Review plant health` task explaining that automatic care instructions could not be extracted. Do not fall back to a second independent Gemini task array.
- **S-03:** Given repeated bullets, return one task per normalized identical action, with at most five tasks and deterministic report order. Over-limit, overlong, malformed, or non-action candidates are bounded or rejected before persistence; task output always passes the application's validator.
- **S-04:** Preserve the archived diagnostic report, health assessment, telemetry freshness disclosure, and notification metadata. The public scan response retains its existing `careTasks` shape even though its source changes.

### R-02 — Map parsed data safely and predictably

- **S-05:** Each output has a nonempty title of at most 200 characters, description of at most 5,000 characters, an allowed task type, allowed urgency, and valid ISO UTC due date. The persisted task starts `PENDING` and belongs to the authenticated user, plant, and analysis; NLP text cannot assign ownership or completion status.
- **S-06:** An explicit unambiguous date/time produces the corresponding UTC due instant. Configure dates as due dates rather than scheduled dates, disable unused tag/context/project/status triggers, and verify date handling across server timezone settings and midnight. Gemini is prompted to use absolute dates based on the supplied scan time; unsupported relative or ambiguous numeric dates must not silently become guessed schedules.
- **S-07:** If a usable action has no reliable due time, retain the action and use a documented default of 24 hours after scan time, marking the description as a default reminder rather than an AI-specified deadline. A reliable date without a time uses 09:00 UTC on that date. Invalid or already-past deadlines use the default reminder. The fallback review task uses the same 24-hour default.
- **S-08:** Preserve conditional wording such as “water only if the soil is dry” in title/details. Unsupported task categories map to `OTHER`; absent or unclear urgency maps to `routine`. Negated instructions such as “do not fertilize” must not become affirmative fertilizing tasks. Recurrence may remain in source details but does not create repeated occurrences.

### R-03 — Save the plant and tasks as one operation

- **S-09:** A successful new-plant scan commits the plant, identification, archived analysis, one to five care tasks, and health/scan timestamp together before returning success. Opening My Garden shows that plant; opening Care Tasks shows the same parsed actions without another scan or app restart.
- **S-10:** Inject failure at each relational write, especially task creation and final health update: the transaction rolls back all scan-owned relational changes and returns the existing sanitized scan failure. For an existing plant, its previous state and previous tasks remain intact. Provider/spec-cache work and MongoDB reads occur outside the transaction.
- **S-11:** Provider/authentication failure or rejected report structure creates no plant, analysis, or tasks. Preserve ownership validation, optional sensors, cache-race recovery, and missing/stale-reference disclosure. Optional species-cache writes can still survive independently as they do today.

### R-04 — Preserve scan and task lifecycle behavior

- **S-12:** Under the proposed rescan policy, scanning an existing owned plant creates a new analysis and its parsed task set without creating another plant or modifying earlier completed/skipped tasks. Deduplicate within a report only; identical tasks from distinct successful rescans retain their existing semantics.
- **S-13:** Retry Sync reuses the saved report and only retries client synchronization; it does not call Gemini or create tasks again. Scanner close/background handling and stale-callback fences continue to pass their existing regressions.
- **S-14:** Tasks refresh on screen focus using the existing server GET path, appear in the correct Today/Upcoming group, and survive app restart. Complete/undo uses existing server IDs and ownership-checked PATCH behavior. Failed reloads retain the current last-good state and retry feedback; local schedules and guest checklists continue working.

### R-05 — Explain the result simply

- **S-15:** After confirmed scan save, the result view says `Plant saved. N care tasks added.` and provides a clear route to Care Tasks. The displayed count is the persisted response task count, including a fallback review task when applicable. A client synchronization failure retains existing Retry Sync feedback and does not falsely claim the garden refresh succeeded.
- **S-16:** Each task uses a short action title, plant name, readable due date, and concise details preserving conditions. Keep current colors, typography, grouping, completion controls, and account/local distinction. Avoid parser terms, raw JSON, and NLP configuration in user-facing text.

## 5. Architecture

### Current workflow, verified from source

| Stage | Actual behavior | Relevant files |
| --- | --- | --- |
| Capture | Camera captures JPEG/base64 and immediately submits; there is no separate Save button | `frontend/app/(tabs)/scanner.tsx`, `frontend/hooks/use-scan.ts` |
| Client scan | POST `/api/scan`; optional `plantId` identifies a rescan; successful report retained for Retry Sync | `frontend/services/scan-flow.ts`, `frontend/services/api.ts` |
| Validate | Authentication, owned plant/device, image and location validation | `backend/src/routes/scan.ts`, `backend/src/lib/scan-input.ts` |
| Identify | Pl@ntNet identifies species | `backend/src/lib/plantnet.ts` |
| Enrich | Parallel PostgreSQL species cache/Perenual fallback and optional latest MongoDB sensor reading | `backend/src/routes/scan.ts`, `backend/src/lib/perenual.ts` |
| Diagnose | Gemini receives image, species/confidence, reference specs, telemetry/freshness, and UTC time | `backend/src/routes/scan.ts`, `backend/src/lib/gemini.ts` |
| Parse today | JSON contains report, separate careTasks, health, and notification; malformed JSON uses a heuristic report/review fallback; structurally invalid JSON fails | `backend/src/lib/scan-output.ts`, `backend/src/types/scan.ts` |
| Save today | Sequential independent writes create plant when needed, identification, archived analysis, tasks, then update health | `backend/src/routes/scan.ts`, `backend/prisma/schema.postgres.prisma` |
| Synchronize | Client PATCHes health again, fetches plant, then refreshes garden. Its refresh-only comment disagrees with the actual implementation | `frontend/services/scan-flow.ts`, `frontend/app/(tabs)/scanner.tsx` |
| Display | GET `/api/scan/tasks`, merge remote tasks with local checks, group and complete/undo | `frontend/hooks/use-care-tasks.ts`, `frontend/services/care-tasks.ts`, `frontend/app/(tabs)/tasks.tsx` |

The executable Gemini default is `gemini-2.5-flash`, configurable through `GEMINI_MODEL`; the supplied project overview's 2.0 name does not describe the runtime default. The legacy `/api/ai/analyze` route is separate from the camera's scan-first path and is excluded from this change.

### Proposed structure

```text
backend/
  package.json + workspace lockfile         add pinned parser dependency
  src/lib/report-care-tasks.ts              new extraction/parser/mapping adapter
  src/lib/scan-output.ts                    separate report and final-task validation
  src/types/scan.ts                         separate provider contract from public DTO
  src/routes/scan.ts                        prompt, adapter, relational transaction
  tests/report-care-tasks.test.mjs           parser fixtures and date/failure cases
  tests/scan-cache.test.mjs                  scan integration and preservation
  tests/scan-persistence.test.mjs            transactional save/failure evidence
frontend/
  app/(tabs)/scanner.tsx                    clear saved-task feedback and navigation
  tests/                                   relevant scanner/task regressions
```

These are proposed responsibilities, not implementation mandates. No schema change is expected: existing PostgreSQL CareTask fields cover the mapped output. Read both Prisma schemas before coding and use the separate PostgreSQL client. The Prisma guidance under `.windsurf/skills/prisma-client-api/` was read; its newer-version construction examples do not replace this repository's Prisma 6 clients. The installed generated client confirms interactive `$transaction` support. Ticket T-11 adds a separate, non-skipping integration runner that provisions its own disposable PostgreSQL container and applies the existing schema there; it never takes a database URL from application configuration.

### Key components and contracts

Keep Gemini's JSON envelope for health, `diagnosticReport`, and notification; remove its separate task array as the task authority. The report must contain exactly one `Care actions` section, one actionable instruction per bullet, including any condition and an absolute UTC date/time. Extraction stops at the next section heading/end of report. Never send the entire report as one parser input or try to classify every sentence as a task. Plain-text malformed-JSON fallback remains limited to accepted bounded report text and the existing generic review behavior; structurally invalid envelopes still fail safely.

The backend-only adapter accepts validated report text and scan time, extracts bounded action bullets, parses each one, then maps to existing `CareTaskOutput[]`. Task category uses conservative action matching; uncertainty becomes `OTHER`. Explicit recognized priority wording may set urgency, otherwise `routine`. Keep the complete action as description so parser cleanup cannot erase plant-care conditions. Disable irrelevant NLP syntax and ignore unsupported output fields.

The public POST response, task GET/PATCH endpoints, IDs, and frontend DTO shape remain compatible. Do not add another client-side task writer. Use a short PostgreSQL interactive transaction for scan-owned relational persistence only, after providers and parsing have completed; read telemetry outside it. Leave the extra client health PATCH intact unless implementation proves a necessary compatibility change.

### Data flow

```text
Photo -> authenticated scan -> Pl@ntNet species
  -> species specs + optional telemetry -> Gemini JSON report
  -> validate envelope -> extract Care actions -> parse each action
  -> validate mapped task array
  -> PostgreSQL transaction: plant + identification + analysis + tasks + health
  -> response -> garden synchronization -> Care Tasks GET on focus
```

Real alternative: retain Gemini's structured task array and run the library only on task titles/descriptions. This minimizes contract changes but does not make the report text the source requested by the user. The recommendation therefore uses a delimited report section while retaining the public response contract.

### Load-bearing paths, blast radius, and rollback

Changes touch scan output validation and persistence, provider prompt behavior, and result feedback. They must preserve credentials, ownership, cache races, sensor optionality, scanner session fences, retained reports, and task status mutations. Existing backend scan tests mock persistence; mocks alone do not prove database rollback. Add an isolated PostgreSQL integration check that observes no partial rows after injected failure, without modifying a shared/production database.

Rollback is a scoped revert restoring the previous prompt and structured-task writer; no migration or deletion of saved tasks is required. Existing task rows remain readable. A transaction does not solve a lost response after commit: a completely new POST can still create another plant/analysis. Cross-request idempotency, rescan reconciliation, historical duplicate cleanup, the existing 50-task listing cap, and local/server semantic overlap are explicitly outside this feature.

## 6. Success Criteria

| Criterion | How to verify |
| --- | --- |
| Requested library performs real parsing | Actual `tasknotes-nlp-core` fixture tests with two actions, dates, conditional text, missing section, malformed candidates, duplicates, and fallback |
| Plant and task save is atomic | Route tests plus isolated PostgreSQL rollback integration evidence |
| End-to-end outcome is easy to understand | Signed-in device/browser demo: scan, see saved task count, open My Garden, open Care Tasks, complete/undo, restart and verify persistence |
| Existing behavior is protected | `npm test --workspace=backend`; `npm test --workspace=frontend` |
| Strict TypeScript passes | `node node_modules/typescript/bin/tsc --noEmit -p backend/tsconfig.json`; `npm run typecheck --workspace=frontend` |
| Library/runtime compatibility verified | Import pinned release in the actual backend ESM runtime and test timezone/default-date behavior before implementing route changes |

Baseline at source HEAD `c70f08d`, 2026-10-04: frontend tests passed 163/163; backend tests passed 60/60; frontend and backend TypeScript checks passed. The restricted backend run failed because local HTTP tests cannot bind `127.0.0.1` (`listen EPERM`); the approved rerun outside the sandbox passed all tests. The draft also passes `node scripts/pincer-runtime.cjs validate .prd/prd-v3.md`. No live AI scan, camera demo, or real-database rollback test was performed during planning.

## 7. Out of Scope

No dependency upgrades beyond adding the parser, new database models, raw SQL, AI provider replacement, model migration, scan-save confirmation step, manual-creation AI tasks, retroactive parsing, arbitrary-language support, automatic treatment execution, push delivery, repeating reminders from RRULE, broad task-screen redesign, cross-request idempotency, or automatic retirement of earlier rescan tasks. Existing local/server checklist overlap and listing pagination are not redesigned. No delivery time budget was supplied and no requirement was cut for time.

## 8. Visual Direction

Simple, calm, actionable. Preserve the existing screen theme and typography; retain green accents and current task cards. Use short verb-led titles, readable dates, and concise condition-preserving details. Give saved-task count and an obvious Care Tasks action on scan success. Avoid dense AI explanations, developer syntax, or duplicate generation controls. The default was presented before the user's narrowing request; this authorizes preserving the design, not a redesign.

## 9. Security & Trust Boundaries

Camera payloads, provider responses, and LLM report text are untrusted. Validate image/ownership before provider calls; validate the envelope before extraction and mapped fields before persistence. Report text cannot override user/plant/analysis IDs or task status. Provider keys remain server-side in the existing environment configuration; no secrets or base64/report payloads enter error logs. Return the existing generic scan errors; client cancellation does not undo a committed server save.

## 10. Dependencies & Risks

`npm view tasknotes-nlp-core version repository homepage exports --json` verified published version **0.2.0** on 2026-10-04, with ESM/CommonJS exports; pin that version for initial integration. Registry metadata lists `chrono-node`, `date-fns`, and `rrule` dependencies. The [official library README](https://github.com/callumalpass/tasknotes-nlp-core#readme) documents `NaturalLanguageParserCore.parseInput()` returning one parsed task, with optional due/scheduled dates and times. It does not extract an array of care instructions from a diagnostic narrative; the host adapter must do that. Published-package date/clock behavior remains an implementation compatibility gate; inspected upstream source is not proof of the exact packaged release.

The [Gemini generateContent API documentation](https://ai.google.dev/api/generate-content) was checked for the existing prompt/image request contract; this plan retains that route and the installed SDK. No new external endpoint is introduced. Changes in Gemini wording can break extraction, so a fixed section grammar, bounded validation, and explicit review fallback are required. NLP priority/type classification is not botanical reasoning: preserve conditions and choose conservative defaults. UTC scheduling is visible through local date formatting; user-specific timezone scheduling requires a separate contract. Real database rollback and physical camera behavior require integration/manual evidence beyond current mocked suites.
