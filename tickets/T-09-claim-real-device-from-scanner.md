---
ticket: T-09
status: open
size: M
prd: .prd/prd-v3.md
depends_on: [T-08]
timeout: 600
---

## Objective
Claim a real MAC and retain account-scoped device state so the frontend implements the server-authoritative device flow.

## Context
- Implements: R-02, R-03
- Scenarios: S-05–S-07; S-11 claim access
- Relevant files: frontend/app/device-connection/scanner.tsx, frontend/context/app-data.tsx, frontend/app/device-connection/selection.tsx, frontend/types/device-connection.ts
- Follow existing request/session, Action/Notice, device-screen and test harness patterns; read the relevant source before edits.

## Requirements
- Replace timed demo discovery with accessible manual MAC input and existing Expo Camera barcode/QR acquisition. Scan the MAC value, without inventing a QR JSON protocol.
- Use claimDevice; retain the returned Device in ephemeral account-scoped AppData state and navigate directly to assignment with the UUID and contextual target.
- Guard duplicate scan events/submissions; disable busy actions. 409 shows an accessible alert and stays on Scanner for correction/retry; other errors use existing sanitized patterns.
- Manual entry remains usable when camera access is denied. Abort on blur/cancel/unmount; session changes clear pending Device and late responses never navigate.
- Require sign-in for real claim and guard/bypass legacy mock selection routes; do not remove unrelated local demo data.

## Acceptance Criteria
- [ ] Entered or scanned LC-A50528 yields exactly one claim and a UUID-bearing assignment handoff.
- [ ] Malformed/empty input is rejected visibly; 409 never advances; retry works after failure.
- [ ] Camera denial permits manual claiming, and cancellation/account switching prevents stale state or navigation.
- [ ] Guest claiming requires sign-in while existing manual care/image scanning remains accessible.

## Verification
Proves: A production screen/provider handler harness observes claim count, input/error UI, route parameters, camera denial and late-response behavior across lifecycle/account boundaries. New focused test files below are deliverables, not existing evidence; missing files must fail verification.
```bash
set -euo pipefail
node --import tsx --test --test-concurrency=1 frontend/tests/device-claim-flow.test.ts frontend/tests/device-activity.test.ts
npm run typecheck --workspace=frontend
```

## Constraints
- Frontend-only implementation; no backend/database/firmware changes or new dependencies.
- Strict TypeScript without any; preserve account token handling, existing environment conventions and styling.
- Run verification from repository root. Do not commit unless explicitly asked by the user.
- Do not fabricate manual/live results or treat Metro startup as end-to-end success.

