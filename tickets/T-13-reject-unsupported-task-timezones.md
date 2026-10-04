---
ticket: T-13
status: done
size: S
prd: .prd/prd-v3.md
depends_on: [T-09]
timeout: 600
started: 2026-10-04T07:38:53Z
finished: 2026-10-04T07:44:55Z
---

## Objective
Fix the evaluation finding that unsupported timezone suffixes silently become UTC deadlines.

## Context
- Relevant files: `backend/src/lib/report-care-tasks.ts`, `backend/tests/report-care-tasks.test.mjs`.
- Implements: R-02
- Scenarios: S-06, S-07

## Requirements
- Accept the existing supported UTC date grammar; unsupported named zones, numeric offsets, and UTC offsets use the documented 24-hour default with an explanation.
- Preserve action and condition text, calendar validation, and timezone independence.

## Acceptance Criteria
- [x] CET, +0800, UTC+8, and other unsupported scheduling suffixes default instead of silently becoming UTC.
- [x] Supported UTC dates and condition continuations still work in three process timezones; backend TypeScript passes.

## Verification
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
- No dependency upgrades or scheduling scope expansion.
