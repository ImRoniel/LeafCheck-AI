---
ticket: T-11
status: done
size: M
prd: .prd/prd-v3.md
depends_on: [T-08, T-10]
timeout: 600
started: 2026-10-05T13:43:18Z
finished: 2026-10-05T13:53:49Z
---

## Objective
Render Plant Profile from unified BFF sensor state so the frontend implements the server-authoritative device flow.

## Context
- Implements: R-04
- Scenarios: S-12–S-17
- Relevant files: frontend/app/plant-profile.tsx, frontend/components/plant-telemetry.tsx, frontend/components/plant-care-summary.tsx, frontend/components/telemetry-history.tsx
- Follow existing request/session, Action/Notice, device-screen and test harness patterns; read the relevant source before edits.

## Requirements
- Use AppData collection metadata for name/image/species/location/thresholds and edit/delete/scan controls; wait for hydration and expose collection retry and genuinely missing-plant behavior. Do not add a profile fetchPlant fallback.
- Own one BFF latest/pairing read on focus/refresh, with spinner, retry and cancellation of obsolete responses. Remove useSensorData/latest requests from PlantTelemetry and accept unified payload plus parent callbacks.
- Render unpaired card and Pair a Sensor contextual action; paired Device name with nested metrics including zero; paired/null waiting message. Errors stay distinct from unpaired/waiting and never display another plant's readings.
- Retain care guidance with telemetry or null, accessible states and existing styles. Local mapping/demo-seed actions must not override real sensor state.
- If retaining history, load only after an explicit action and address it using Device.macAddress, not UUID. Preserve a useful history feature without an automatic second request.
- Verify the old plant after reassignment becomes unpaired on focus; handle metadata updates without refetch loops.

## Acceptance Criteria
- [x] Loading, unpaired, waiting, populated and failure/retry states render correctly and only the BFF fetches latest readings.
- [x] No extra metadata/latest/history call occurs from a ready profile; zero readings are rendered as zero.
- [x] Pair action carries the current plant target; old profile responses cannot overwrite a different plant.
- [x] Metadata loading/error/missing cases preserve useful edit/delete/scanning/care behavior when metadata is available.
- [x] Malformed BFF is surfaced as failure, local mapping cannot turn unpaired into paired, and explicit history uses MAC.

## Verification
Proves: A production profile/component harness observes calls and rendered states, metrics, retries, metadata recovery, history identity and cancellation; existing guidance/history tests protect unrelated behavior. New focused test files below are deliverables, not existing evidence; missing files must fail verification.
```bash
set -euo pipefail
node --import tsx --test --test-concurrency=1 frontend/tests/plant-telemetry-bff-flow.test.ts frontend/tests/plant-guidance.test.ts frontend/tests/telemetry-series.test.ts
npm run typecheck --workspace=frontend
```

## Constraints
- Frontend-only implementation; no backend/database/firmware changes or new dependencies.
- Strict TypeScript without any; preserve account token handling, existing environment conventions and styling.
- Run verification from repository root. Do not commit unless explicitly asked by the user.
- Do not fabricate manual/live results or treat Metro startup as end-to-end success.

