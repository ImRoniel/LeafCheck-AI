---
ticket: T-05
status: done
size: S
prd: .prd/prd-v2.md
depends_on: []
timeout: 600
started: 2026-10-03T06:18:38Z
finished: 2026-10-03T06:29:06Z
---

## Objective

Enable safe lifecycle changes by adding a deterministic behavioral harness for the currently uncovered scanner and hook before modifying production code; this ticket implements no product scenario.

## Context

- Relevant files: `frontend/app/(tabs)/scanner.tsx`, `frontend/hooks/use-scan.ts`, `frontend/components/scan-viewfinder.tsx`, `frontend/services/scan-flow.ts`.
- Follow the actual-hook execution and effect scheduling conventions in `frontend/tests/care-task-hook.test.ts` and the Node test runner in `frontend/package.json`.
- Add `frontend/tests/scanner-lifecycle.test.ts`; optional reusable fixtures belong under `frontend/tests/helpers/`.
- PRD section: Architecture and Success Criteria; enabling work for T-06 and T-07.

## Requirements

- Execute actual scanner handlers and actual `useScan` lifecycle logic with mocked platform/transport boundaries; do not replace the lifecycle being tested with a mock implementation.
- Support retained renders across route departure/reentry, unmount, AppState changes, permissions, camera-ready/mount-error callbacks, and deferred picture/network promises.
- Characterize intended existing behavior that must survive the fix: capture gating and duplicate suppression, valid capture auto-submission, Retake/New Scan, target forwarding, and report-retaining Retry Sync.
- Supply controls that later regressions can use to settle old callbacks after a new session begins. Do not encode the known broken close/reopen behavior as a permanent expected result.

## Acceptance Criteria

- [x] Tests execute real screen/hook handlers and fail if ready/focus/auth gates or capture duplicate protection are removed.
- [x] Missing image data and oversized camera payloads are rejected without provider submission; safe error UI is observed.
- [x] Current valid capture, target forwarding, Retake/New Scan, and Retry Sync behaviors are characterized with observable state/request assertions.
- [x] The harness preserves hook state across retained-tab renders, performs effect cleanup, exposes deferred operations and tracks preview mount/unmount; no production behavior changes are made in this ticket.

## Verification

Proves: baseline scanner behavior and existing scan-flow rejection/retry contracts are exercised through real handlers, providing protection before close/reopen changes; this does not yet prove the lifecycle fix or native camera release.

```bash
set -euo pipefail
cd frontend
node --import tsx --test tests/scanner-lifecycle.test.ts tests/scan-flow.test.ts tests/bottom-nav-regression.test.ts
npm run typecheck
```

## Constraints

- Preserve production code and dependency versions. No snapshots of implementation identifiers as primary assertions, skipped tests, or tests asserting that the bug must remain.
- Use strict TypeScript without `any`. Keep synthetic images/credentials in fixtures; never read or log real secrets.
