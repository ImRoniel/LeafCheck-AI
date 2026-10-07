---
ticket: T-17
status: done
size: M
prd: .prd/prd-v4.md
depends_on: [T-16]
timeout: 600
started: 2026-10-07T13:49:44Z
finished: 2026-10-07T14:13:51Z
---

## Disposition
**Native validation deferred to a future sprint** by the user: “Skip T-17 for now. Mark it as deferred. The native builds will be tested in a future sprint. Resume the PRD workflow.” Decision D-01 records this scope change. The runtime supports only open/in_progress/done ticket states; its lifecycle will close the already-delivered automated portion, not certify the deferred native work.

## Objective
Retain and verify completed integration coverage and hand off deferred native validation.

## Context
Implements: R-01, R-02, R-03
Completed automated integration tests cover launch, persistence, storage rejection, restore races and account setup. Native requirements and their expected outcomes remain preserved in the PRD, device checklist and validation handoff. Scenarios S-06/S-07/S-11 and obligations C-05/C-06 are deferred under D-01.

## Requirements
- Preserve the completed integration tests and full frontend/typecheck verification.
- Preserve frontend/tests/INSTALL_ONBOARDING_MANUAL_CHECKS.md and .prd/frontend-install-verification-v4.md as the future-sprint handoff.
- Report native builds, physical backup/transfer and visual reviews as deferred and unverified, never passed. No native execution is required to close the current automated portion.

## Acceptance Criteria
- [x] Full frontend suite and typecheck pass with integrated launch/race regression coverage.
- [x] Deferred native scope, original test procedure and missing evidence are explicitly retained under D-01.

## Verification
Proves: Integrated frontend behavior and regression compatibility; the automated command does not prove physical backup/transfer or visual quality, which are explicitly deferred C-05/C-06 reviews under D-01.
```bash
set -euo pipefail
cd frontend
node --import tsx --test --test-concurrency=1 tests/install-onboarding-integration.test.ts
cd ..
npm test --workspace=frontend
npm run typecheck --workspace=frontend
```

## Constraints
Follow AGENTS.md: strict TypeScript without `any`, existing hooks/router and credential boundaries. No implementation beyond PRD v4, publishing, pushing or merging. Local commits for Pincer evaluation are authorized by AGENTS.md. Never claim planned tests or review obligations have already passed.
