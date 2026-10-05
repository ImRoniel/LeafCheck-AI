---
ticket: T-13
status: done
size: S
prd: .prd/prd-v3.md
depends_on: [T-11, T-12]
timeout: 600
started: 2026-10-05T15:08:59Z
finished: 2026-10-05T15:10:54Z
---

## Objective
Remove the browser-confirmed duplicate React sibling keys from Plant Profile while preserving component remounts when the plant changes.

## Context
- Implements: R-04, R-05
- Scenarios: S-17, S-18
- Evaluation of candidate c4ef68b showed the telemetry panel and delete action sharing the plant ID key; editing also collided with the edit form. The Expo development error toast obscures controls.
- Relevant files: frontend/app/plant-profile.tsx, frontend/tests/plant-telemetry-bff-flow.test.ts.

## Requirements
- Give edit, telemetry and delete siblings distinct identities scoped to the plant.
- Preserve metadata, editing, telemetry state and plant-change remount behavior.
- Add regression coverage for both normal and editing render states; repeat browser visual captures against the new candidate.

## Acceptance Criteria
- [x] Normal and editing profile children have distinct keys and retain plant-specific identities.
- [x] Existing BFF, metadata and navigation tests and frontend typecheck pass.
- [x] New candidate visual review verifies the React duplicate-key error toast is absent.

## Verification
Proves: Rendered production profile children maintain unique React sibling identities through edit transitions and retain plant-bound remounting; existing BFF regressions remain green. Browser confirmation is separately recorded in C-08.
```bash
set -euo pipefail
node --import tsx --test --test-concurrency=1 frontend/tests/plant-telemetry-bff-flow.test.ts
npm run typecheck --workspace=frontend
```

## Constraints
Frontend-only fix within authorized PRD v3; no new dependencies, backend or architecture changes.
