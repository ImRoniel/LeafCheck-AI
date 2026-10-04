---
prd: .prd/prd-v3.md
base: c70f08d912446a0c75861f439d864b19a41ab351
candidate: b2868f81cd369565c4d0129eba455e9e6738589f
evidence: .prd/evidence/prd-v3/b2868f81cd369565c4d0129eba455e9e6738589f/manifest.json
---

# PRD v3 evaluation — blocked

The referenced manifest does not exist: strict export refused required unverified reviews C-06/C-07. Candidate-bound reviews, the draft and copied runtime logs are a handoff, not validated release evidence. No evaluation locator was generated. Earlier PRD v2 evidence remains preserved.

Gemini report Care actions bullets now become one to five automatic tasks through tasknotes-nlp-core. The server preserves conditions, applies conservative categories and UTC scheduling, and creates a review task when instructions are unusable. Plant, identification, report, tasks and health save together in PostgreSQL. Scanner success shows the saved-task count and Open Care Tasks action. Existing task completion, rescan history and Retry Sync behavior remain intact. No requirement was cut or deferred.

The user approved commits with “yes you can commit it to complete the implementation and workflow recodrs,” recorded as A-03. Delegated A-04 covers the scoped T-13 correction and evaluation checks under G-02. Implementation: ff39541; fix: adeba62; completion/candidate: b2868f8. The original five tickets were implemented and verified sequentially, then committed together once permission arrived.

Candidate checks C-01/C-02/C-03/C-04/C-05/C-08/C-11 pass: backend 73/73, frontend 169/169, real PostgreSQL commit/rollback 11/11, both TypeScript checks, parsing in three timezones, environment tracking/ignores and invalid/oversized HTTP requests. Command results, exact commands, runtime attempt IDs and digest-checked log copies are in review/command-results.json beneath the candidate evidence directory. The disposable database was removed; no application database migration or live provider scan occurred.

Independent reviewers found one P2 scheduling bug: unsupported timezone suffixes silently became UTC. T-13 fixes it with CET, +0800, UTC+8 and Europe/Paris regressions while preserving valid UTC dates and conditions. Both reviewers confirm no remaining high-confidence code findings on the final candidate. Limited redacting history/manual inspection found no potential secret locations; only frontend/.env.example is a tracked dotenv file.

C-10 fails: 22 high-severity dependency entries and zero critical in existing Expo/React Native and Prisma chains. Root advisories include braces stack exhaustion, node-forge signature verification and deepmerge-ts stack exhaustion (package-lock.json:5208, :6049, :10992). The previous evaluation already reported these; the parser addition did not introduce them. Recommend separate compatible dependency remediation. No forced breaking downgrade was applied, and the required audit failure is not waived.

The provisional coverage judgment is R-01/R-02 supported by automated evidence; R-03/R-04 blocked on C-06; R-05 blocked on C-07. Twelve scenarios have executable evidence; S-09, S-14, S-15 and S-16 still need observed platform outcomes or screenshots. Adequacy is inadequate for complete delivery. No manifest was exported and no scope deferral is authorized.

Expo web started on port 8084, bundled and returned HTTP 200, then was stopped. No physical camera/device or browser automation MCP was available; bundled DevTools failed because libasound.so.2 is missing. No signed-in end-to-end demo, rendered visual inspection or screenshots are claimed. Startup and harness tests do not satisfy C-06/C-07.

Next: run C-06 on a signed-in supported mobile device and camera-capable browser; capture C-07 success/fallback/task-detail/sync-failure/reload-failure scenarios with platform and viewport. Address dependency advisories in an authorized separate change. Resume evaluation against the resulting clean candidate, rerun declared checks, export/validate the manifest and commit its locator. Run `$pincer-release` for a pass/fail workflow audit; it is expected to fail while these blockers remain.

## Handover

Read this file first, then .prd/prd-v3.md, .prd/coverage/prd-v3.json and T-08 through T-13. Candidate review/code-quality.md, review/security.md and review/export-refusal.md explain findings and limitations. Runtime status remains authoritative for receipts and readiness.

backend/src/routes/scan.ts orchestrates providers; report-care-tasks.ts extracts the fixed section and maps parser output; scan-persistence.ts owns the short transaction. The scanner screen displays confirmed-save feedback; existing scan-flow and care-task hooks manage synchronization and refresh. Run backend/frontend npm tests and both TypeScript checks. Real rollback verification additionally needs Docker and postgres:16-alpine through `npm run test:scan-persistence --workspace=backend`.

The only new direct dependency, tasknotes-nlp-core 0.2.0, parses extracted instructions and cleans titles as requested. Its chrono-node/date-fns dependencies interpret language/dates; package-provided rrule does not enable recurring task execution here. The host controls trusted UTC deadlines and ownership. Existing Express handles HTTP; separate Prisma 6 clients isolate PostgreSQL domain writes from MongoDB telemetry; Gemini/Pl@ntNet/Perenual remain server-side. React Native, Expo Router and expo-camera retain screens/navigation/capture. Node tests, tsx and TypeScript verify behavior without a new test framework.

The riskiest aging assumption is Gemini retaining the exact Care actions grammar: wording drift can produce the explicit review fallback. Real camera permissions/timing, retained-screen synchronization and device readability are the least-tested paths. Keep the parser pin and repeat condition/negation/timezone fixtures before upgrades. UTC-only scheduling, duplicates across distinct rescans, the existing listing cap and lost-response idempotency remain agreed limits.
