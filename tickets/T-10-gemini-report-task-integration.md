---
ticket: T-10
status: done
size: M
prd: .prd/prd-v3.md
depends_on: [T-09]
timeout: 600
started: 2026-10-04T06:51:50Z
finished: 2026-10-04T06:56:25Z
---

## Objective
Make the Gemini report's care-action text the sole task source in the existing scan endpoint while preserving its public response and provider/error behavior.

## Context
- Relevant files: `backend/src/routes/scan.ts`, `backend/src/types/scan.ts`, `backend/src/lib/scan-output.ts`, `backend/tests/scan-cache.test.mjs`, `backend/tests/gemini-runtime.test.mjs`, `backend/tests/scan-providers.test.mjs`.
- Implements: R-01, R-03
- Scenarios: S-04, S-11
- Depends on T-09. T-11 later wraps the prepared persistence payloads atomically.

## Requirements
- Keep the Gemini JSON envelope for report, health, and notification. Prompt for the agreed `Care actions` grammar, one short action per bullet, conditions and explicit absolute UTC dates based on the supplied scan time.
- Separate provider-envelope validation from final task-array validation. Use the report adapter to fill the existing public `careTasks` DTO and insertion payload; Gemini's separate `careTasks` field must never become an alternative writer or fallback source.
- Keep image/species/confidence/specs/optional telemetry/freshness context and notification metadata. Archive the accepted diagnostic text unchanged.
- Preserve bounded malformed-JSON review fallback and reject structurally invalid envelopes with the existing sanitized scan error before scan-owned relational writes. Invalid health/notification/report shape is not silently repaired into success.
- Preserve auth/ownership/image checks, server-side keys, optional Perenual behavior, cache concurrency recovery, and provider-error sanitization. Leave `/api/ai/analyze` and model selection untouched.
- Update characterization fixtures to the new provider contract while retaining assertions on public DTO fields, persisted/returned task equality, trusted owner linkage, and failure ordering.

## Acceptance Criteria
- [x] A real route request with a two-action report returns the parsed tasks and prepares identical persistence data, ignoring a contradictory separate provider task array.
- [x] Archived report, health, notification, missing-sensor behavior and stale-data disclosure retain their values through the route.
- [x] A usable report without actions produces the single review fallback; invalid report/health/notification structure and provider/auth failures produce sanitized failures without new plants/analyses/tasks.
- [x] Cache hit/miss/concurrent insertion recovery and owned-device/species identification behavior remain protected by the full backend suite.

## Verification
Proves: the actual scan route derives tasks from report text while preserving provider, ownership, archive, notification, cache and rejection behavior; catches divergence between saved and returned tasks.
```bash
set -euo pipefail
npm test --workspace=backend
node node_modules/typescript/bin/tsc --noEmit -p backend/tsconfig.json
```

## Constraints
- No second provider call, client task creation, public endpoint/DTO break, provider/model upgrade, or historical backfill.
- Do not treat this ticket's sequential writes as proof of atomicity; T-11 must pass before the feature is complete.
