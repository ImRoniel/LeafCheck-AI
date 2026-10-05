---
ticket: T-05
status: done
size: M
prd: .prd/prd-v2.md
depends_on: [T-04]
timeout: 600
started: 2026-10-05T08:38:56Z
finished: 2026-10-05T08:43:49Z
---

## Objective
Make changes-mode Notes compatibility freshness accept the existing validated evidence followers while retaining rejection boundaries.

## Context
- Relevant files: scripts/pincer-runtime/status.cjs; scripts/pincer-runtime/locator.cjs; scripts/tests/pincer-freshness.test.mjs.
- PRD section: Consistent evaluation freshness in workflow status and release
- Implements: R-01, R-03

## Requirements
- Add the positive regression for matching Notes, validated candidate artifacts and a valid locator in an evidence-only follow-up commit; demonstrate it fails on the original implementation.
- Reuse locator.followers via an explicit changes-mode option/internal follower set; keep legacy/migrated calls and locator validation policy unchanged.
- Assert Notes current, Evaluation current, Evidence ok and successful readiness for the valid fixture.
- Keep all T-04 rejection cases green, and assert dirty mutations cannot bypass the clean-tree release requirement.
- Run full backend regression tests and strict compilation; preserve PRD v1 records, artifacts and endpoint code.

## Acceptance Criteria
- [x] A valid evidence-only locator commit produces consistent current status and passes readiness.
- [x] Malformed input, genuine committed/dirty changes and invalid evidence remain rejected.
- [x] The positive test fails against the original defect and passes with the correction; legacy/migrated regressions remain green.
- [x] Backend tests and TypeScript checks pass without endpoint changes.

## Verification
Proves: Valid evidence-only freshness and all rejection/mode regressions, plus unchanged backend behavior and strict compilation.
```bash
set -euo pipefail
node --test scripts/tests/pincer-freshness.test.mjs
node --test scripts/pincer-runtime/runner.test.cjs
npm test --workspace=backend
npx tsc --noEmit -p backend/tsconfig.json
```

## Constraints
- No dependencies, database/API changes, broad evidence allowlists, authorization shortcuts or historical record edits. Preserve existing environment/secret ignore conventions.
- Runtime owns lifecycle and receipt fields. Record semantic and delivery review separately from executable checks.
