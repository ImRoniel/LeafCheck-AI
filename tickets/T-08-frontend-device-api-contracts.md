---
ticket: T-08
status: open
size: M
prd: .prd/prd-v3.md
depends_on: []
timeout: 600
---

## Objective
Add authenticated device and telemetry API contracts so the frontend implements the server-authoritative device flow.

## Context
- Implements: R-01
- Scenarios: S-01–S-04
- Relevant files: frontend/services/api.ts, frontend/services/validators.ts, frontend/types/, frontend/tests/api.test.ts
- Follow existing request/session, Action/Notice, device-screen and test harness patterns; read the relevant source before edits.

## Requirements
- Add claimDevice(macAddress, name?), pairDeviceToPlant(plantId, deviceId|null), and fetchPlantTelemetry(plantId) to the existing client and named exports; reuse request options including AbortSignal.
- Validate/normalize LC and conventional MAC formats, optional nonempty names up to 100 characters, and UUID resource identifiers. Invalid input must reject before transport.
- Parse bare serialized Device, pairing Plant and discriminated BFF payloads. Enforce unpaired null fields and paired valid Device with nested nullable readings; reject malformed success responses.
- Preserve Bearer headers, 401 refresh, typed HTTP status including 409, timeout and cancellation. Keep UUID and MAC identities distinct.

## Acceptance Criteria
- [ ] Claim/pair/unpair/BFF route, method, body and parsed-response assertions pass, including zero metrics and null readings.
- [ ] Invalid input and inconsistent or malformed payloads reject; 409 remains distinguishable and is never a successful claim.
- [ ] Production client tests demonstrate auth refresh, session cancellation and no transport regression.

## Verification
Proves: Production API tests observe outgoing requests and accepted/rejected responses, identity separation, authentication and cancellation rather than matching source identifiers. New focused test files below are deliverables, not existing evidence; missing files must fail verification.
```bash
set -euo pipefail
node --import tsx --test --test-concurrency=1 frontend/tests/device-api.test.ts frontend/tests/api.test.ts
npm run typecheck --workspace=frontend
```

## Constraints
- Frontend-only implementation; no backend/database/firmware changes or new dependencies.
- Strict TypeScript without any; preserve account token handling, existing environment conventions and styling.
- Run verification from repository root. Do not commit unless explicitly asked by the user.
- Do not fabricate manual/live results or treat Metro startup as end-to-end success.

