---
ticket: T-10
status: done
size: M
prd: .prd/prd-v3.md
depends_on: [T-09]
timeout: 600
started: 2026-10-05T13:21:48Z
finished: 2026-10-05T13:42:17Z
---

## Objective
Pair the claimed UUID and refresh reassigned plants so the frontend implements the server-authoritative device flow.

## Context
- Implements: R-03
- Scenarios: S-08–S-11
- Relevant files: frontend/app/device-connection/assignment.tsx, frontend/app/device-connection/success.tsx, frontend/context/app-data.tsx, frontend/services/device-connection.ts
- Follow existing request/session, Action/Notice, device-screen and test harness patterns; read the relevant source before edits.

## Requirements
- Replace mock lookup/delay/local assignment mutation with owned-plant selection and pairDeviceToPlant. Preserve valid locked contextual targets; reject missing pending claims, malformed/deleted targets, mock IDs and Space targets without choosing another destination.
- Busy state prevents duplicate mutations. Mutation errors remain on Assignment with retry; success appears only after confirmation and offers the paired profile route without requiring a mock connectedDevices record.
- Use backend auto-reassignment, never an extra unpair request. Replace the destination's cached Plant and clear that device's old cached plant link; refresh/invalidate the collection without confusing refresh failure with pairing failure.
- Retain account isolation and abort handling. After a confirmed mutation, cancellation cannot imply server rollback. Guest pairing requires sign-in; route params/local data do not authorize pairing.
- Update compatibility entry/success links needed for the real flow; unrelated mock Space records must never count as server pairing.

## Acceptance Criteria
- [x] The selected owned plant is paired using the claimed UUID exactly once and confirmed success navigates to its profile.
- [x] Invalid/deleted/unsupported targets and missing claim state cannot issue a mutation or silently fall back.
- [x] Pair failure has retry; refresh failure after successful pair still reports successful pair with a refresh warning.
- [x] Reassignment clears old cached linkage without an explicit unpair mutation; account changes cannot apply stale state.
- [x] Legacy mock-specific assignment tests are updated for real behavior while unrelated local persistence coverage remains.

## Verification
Proves: Production assignment/provider tests observe the actual pairing call, confirmed success, failed mutation/refresh distinction, target rejection and cache reassignment across accounts. New focused test files below are deliverables, not existing evidence; missing files must fail verification.
```bash
set -euo pipefail
node --import tsx --test --test-concurrency=1 frontend/tests/device-pairing-flow.test.ts frontend/tests/device-connection-flow.test.ts frontend/tests/device-connection.test.ts
npm run typecheck --workspace=frontend
```

## Constraints
- Frontend-only implementation; no backend/database/firmware changes or new dependencies.
- Strict TypeScript without any; preserve account token handling, existing environment conventions and styling.
- Run verification from repository root. Do not commit unless explicitly asked by the user.
- Do not fabricate manual/live results or treat Metro startup as end-to-end success.

