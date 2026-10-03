---
ticket: T-06
status: done
size: M
prd: .prd/prd-v2.md
depends_on: [T-05]
timeout: 600
started: 2026-10-03T06:29:06Z
finished: 2026-10-03T06:33:05Z
---

## Objective

Provide idempotent end-of-session cleanup in the scan flow and hook so route exit discards transient results and safely isolates pending network work from the next session.

## Context

- Relevant files: `frontend/services/scan-flow.ts`, `frontend/hooks/use-scan.ts`, `frontend/tests/scan-flow.test.ts`, `frontend/tests/scanner-lifecycle.test.ts`.
- Implements: R-01, R-03
- Scenario ownership: S-01 and S-02 (flow state), S-03 (hook exit), S-07 and S-08 (network races), S-09 (retry/background preservation). T-07 owns the camera/UI portions of the same scenarios.
- Depends on T-05's characterization harness.

## Requirements

- Reuse or compose cancel-before-reset behavior into an idempotent session-ending path. On route exit/unmount, abort pending client work and clear phase/report/plant snapshot, errors, controller, busy state, target, and patch bookkeeping.
- Ensure old scan, health-update, and fetch completions/rejections/finalizers cannot publish into, unlock, or trigger additional work for a newer session, including transports that ignore abort.
- Distinguish route exit from temporary background cancellation: keep report-retaining Retry Sync semantics within an open session. Do not globally turn all cancellation into report deletion.
- Keep request/response plant-identity rejection and authentication/focus/foreground gates. Do not delete persisted records or imply a client abort reverses completed server work.

## Acceptance Criteria

- [x] Closing idle, scanning, synchronizing, complete, and failed flows repeatedly returns idle with cleared transient state and no busy-reset exception; requests receive abort signals when pending.
- [x] A fresh scan starts after cleanup without waiting for old promises; late scan/update/fetch success and rejection cannot affect the new state, unlock it, or issue a stale downstream request.
- [x] Hook route departure and unmount perform cleanup while temporary backgrounding retains existing report/retry behavior.
- [x] Wrong-plant scan/refetch responses remain rejected; duplicate requests remain blocked, and Retry Sync never reruns diagnosis or repeats an already completed update.
- [x] Service regressions and real-hook lifecycle tests cover S-01–S-03 and S-07–S-09 at the flow boundary and retain all T-05 checks.

## Verification

Proves: flow reset and hook departure behavior work under delayed transport success/failure while existing identity rejection, duplicate protection, and synchronization retry remain intact; native camera teardown is verified by T-07 and evaluation.

```bash
set -euo pipefail
cd frontend
node --import tsx --test tests/scan-flow.test.ts tests/scanner-lifecycle.test.ts
npm run typecheck
```

## Constraints

- No backend/API/database changes, credential storage changes, dependency upgrades, or permanent-record deletion.
- Do not alter unrelated `useScan` consumers without checking usage, and do not weaken generation/abort guards to make tests pass.
