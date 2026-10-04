---
ticket: T-08
status: done
size: S
prd: .prd/prd-v3.md
depends_on: []
timeout: 600
started: 2026-10-04T06:39:04Z
finished: 2026-10-04T06:44:57Z
---

## Objective
Protect the existing scan-to-task behavior with observable characterization tests before changing its provider contract and persistence; this enables T-10 and T-11 and implements no new product scenario.

## Context
- Relevant files: `backend/src/routes/scan.ts`, `backend/src/lib/scan-output.ts`, `backend/tests/scan-cache.test.mjs`, `frontend/tests/scan-flow.test.ts`.
- PRD section: Architecture, current workflow and load-bearing paths.
- Existing tests do not inspect full task insertion payloads or characterize late write failures; they cannot establish real transaction rollback.
- Historical ticket IDs T-01 through T-07 remain reserved even though their files were removed. New numbering begins at T-08.

## Requirements
- Extend the real-route test harness to capture identification/analysis/task writes, final health update, ownership fields, insertion order, and injected errors. Reuse current test patterns rather than mocking the entire route.
- Characterize current structured output, malformed-JSON review fallback, accepted empty task array, new plant versus rescan, and the public task DTO. Record sequential partial-save behavior as a baseline only; T-11 replaces those expectations with rollback requirements.
- Cover rejected image/foreign plant or device/malformed report before writes, and provider failure with no new plant.
- Keep fixtures reusable when provider output and transactional client doubles change. Verify existing task completion/undo ownership and retained-report Retry Sync tests.

## Acceptance Criteria
- [x] Real-route tests assert task insert payloads match the accepted response and authenticated user/plant/analysis; existing-plant scans do not create another plant.
- [x] Injected late persistence failure returns a sanitized scan failure and documents current partial writes without asserting that partial writes are desired behavior.
- [x] Invalid input, cross-owner requests, provider rejection, and malformed output remain blocked before scan-owned writes.
- [x] The characterization and existing frontend Retry Sync tests pass against unchanged feature code.

## Verification
Proves: the existing route's task payload, ownership, failure ordering, and retained-report synchronization are protected before integration; this is characterization, not proof of future rollback.
```bash
set -euo pipefail
cd backend
node --import tsx/esm --experimental-test-module-mocks --test tests/scan-cache.test.mjs tests/ownership.test.mjs
cd ../frontend
node --import tsx --test tests/scan-flow.test.ts
```

## Constraints
- Do not add the parser, change the Gemini prompt, introduce transactions, or repair unrelated PRD v2 records.
- Use synthetic credentials/image fixtures; never log real secrets or image data.
- Tests bind local HTTP ports; use the established approved backend test environment when sandbox networking blocks them.
