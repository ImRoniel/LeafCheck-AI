---
ticket: T-09
status: done
size: M
prd: .prd/prd-v3.md
depends_on: [T-08]
timeout: 600
started: 2026-10-04T06:44:57Z
finished: 2026-10-04T06:51:50Z
---

## Objective
Convert bounded care-action bullets from report text into validated care task objects using the actual pinned NLP library, preserving conditions and predictable UTC deadlines.

## Context
- Relevant files: `backend/package.json`, `package-lock.json`, `backend/src/types/scan.ts`, `backend/src/lib/scan-output.ts`; add `backend/src/lib/report-care-tasks.ts` and `backend/tests/report-care-tasks.test.mjs`.
- Implements: R-01, R-02
- Scenarios: S-01, S-02, S-03, S-05, S-06, S-07, S-08
- The published library parses one phrase into one task; the host owns report section extraction and field mapping. No route behavior changes in this ticket.

## Requirements
- Add exact `tasknotes-nlp-core` version 0.2.0 to the backend and workspace lockfile; verify its actual ESM import/API and date behavior with the repository runtime before integration. Do not infer packaged behavior from upstream source alone.
- Extract one `Care actions` section, stopping at the next heading/end. Normalize ordinary bullet markers and whitespace; never parse diagnoses or other narrative. Define and test the accepted section grammar, repeated/missing headers, continuation details, and malformed candidates.
- Use the real parser on each action, configure due rather than scheduled dates, and disable unused tags/contexts/projects/status triggers. Produce one to five validated `CareTaskOutput` objects in report order; deduplicate normalized identical actions within this report only.
- Enforce existing report/title/description bounds and five-task cap. Reject invalid envelope-level input safely; empty/unusable action sections yield one routine `Review plant health` task with extraction-failure explanation.
- Preserve complete source conditions in description. Never turn a negative treatment into a positive task. Default unsupported types to `OTHER`, unclear urgency to `routine`, and ignore NLP-provided ownership/status fields and recurrence execution.
- Parse unambiguous absolute action date/time as UTC regardless of process timezone. A valid date alone means 09:00 UTC; absent/unreliable/ambiguous/unsupported relative/past deadlines mean scan time plus 24 hours with explicit default-reminder wording. Preserve supplied scan time through the adapter for deterministic tests; do not alter process-wide timezone in application code.
- Use strict types and test final validation. T-11 owns trusted persisted IDs and `PENDING` status for S-05.

## Acceptance Criteria
- [x] Two valid action bullets exercise the real library and become two task objects; narrative and subsequent report sections do not produce tasks.
- [x] Missing/empty/unusable actions yield the review fallback; oversized/invalid input and malformed candidates follow the documented rejection/bounding rules; duplicate bullets do not create duplicate output.
- [x] Explicit dates, date-only 09:00, midnight boundaries, past/ambiguous/relative dates, and 24-hour defaults behave identically in UTC, Asia/Manila, and America/New_York runs.
- [x] Titles/details retain conditional and negated care instructions; absent type/urgency use conservative defaults and parsed recurrence/status/ownership cannot cause unsupported actions.
- [x] Output respects all DTO limits and the actual library's pinned ESM runtime contract; TypeScript passes.

## Verification
Proves: real-library action extraction, validated mapping, fallback, safety conditions, and UTC deadline handling are correct; three process timezones detect dependence on server locale/clock interpretation.
```bash
set -euo pipefail
cd backend
TZ=UTC node --import tsx/esm --experimental-test-module-mocks --test tests/report-care-tasks.test.mjs
TZ=Asia/Manila node --import tsx/esm --experimental-test-module-mocks --test tests/report-care-tasks.test.mjs
TZ=America/New_York node --import tsx/esm --experimental-test-module-mocks --test tests/report-care-tasks.test.mjs
cd ..
node node_modules/typescript/bin/tsc --noEmit -p backend/tsconfig.json
```

## Constraints
- No second LLM request, arbitrary narrative NLP classification, unrelated dependency upgrades, schema change, or route task writer yet.
- Acceptance uses real library behavior; a mock of `parseInput` alone is insufficient.
- If the pinned library cannot meet these semantics, document the concrete incompatibility before changing the dependency or date policy.
