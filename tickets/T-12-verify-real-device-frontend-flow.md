---
ticket: T-12
status: open
size: M
prd: .prd/prd-v3.md
depends_on: [T-09, T-10, T-11]
timeout: 600
---

## Objective
Verify regression coverage and local Expo device flow so the frontend implements the server-authoritative device flow.

## Context
- Implements: R-05
- Scenarios: S-18–S-19
- Relevant files: frontend/tests/device-connection-accessibility.test.ts, frontend/tests/device-frontend-integration.test.ts, .prd/frontend-device-verification-v3.md
- Follow existing request/session, Action/Notice, device-screen and test harness patterns; read the relevant source before edits.

## Requirements
- Add an integration harness executing production Scanner → Assignment → Profile behavior with the real frontend API client and controlled HTTP responses; cover claim conflict, headers, MAC/UUID separation, null/populated/unpaired states, reassignment and account cancellation.
- Update impacted accessibility/mock assertions without removing unrelated regression coverage. Run full frontend tests and typecheck; investigate previous inconsistent suite results and identify baseline versus introduced failures. Do not suppress failures or silently waive them.
- Start Expo using existing project scripts and the configured EXPO_PUBLIC_API_URL. Exercise live authenticated new claim/same-owner reclaim/another-owner conflict, waiting/readings/reassignment and old-plant unpaired flow against the existing backend.
- Record commands, actual observed results, platform and prerequisites in .prd/frontend-device-verification-v3.md without credentials. Missing backend/accounts/hardware/browser capability is explicitly unverified and keeps S-19 unresolved.
- Review existing visual/accessibility patterns and frontend-only scope. Preserve .env ignore/example conventions and make no backend changes.

## Acceptance Criteria
- [ ] Integration and updated accessibility tests exercise the real screens/client rather than copies of callbacks.
- [ ] Full frontend test runner and typecheck pass; any environmental/pre-existing failure is documented and cannot count as a passed check.
- [ ] Local Expo live-flow results cover every S-19 branch with observable evidence, or are explicitly unverified pending prerequisites.
- [ ] Visual review confirms existing patterns; no backend, firmware, secrets or new dependency changes appear.

## Verification
Proves: Production frontend integration/accessibility tests and the full runner detect behavioral regressions. The command does not prove live Expo navigation; required C-07 live-flow review and C-08 scope/visual review remain separate delivery obligations. New focused test files below are deliverables, not existing evidence; missing files must fail verification.
```bash
set -euo pipefail
node --import tsx --test --test-concurrency=1 frontend/tests/device-frontend-integration.test.ts frontend/tests/device-connection-accessibility.test.ts
npm test --workspace=frontend
npm run typecheck --workspace=frontend
```

## Constraints
- Frontend-only implementation; no backend/database/firmware changes or new dependencies.
- Strict TypeScript without any; preserve account token handling, existing environment conventions and styling.
- Run verification from repository root. Do not commit unless explicitly asked by the user.
- Do not fabricate manual/live results or treat Metro startup as end-to-end success.

