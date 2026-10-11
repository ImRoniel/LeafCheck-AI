---
ticket: T-22
status: done
size: S
prd: .prd/prd-v6.md
depends_on: [T-21]
timeout: 600
started: 2026-10-11T02:58:06Z
finished: 2026-10-11T03:00:05Z
---

## Objective
Run the full workspace gate, replace obsolete native-module guidance and prepare and record honest real Expo Go verification evidence.

## Context
Implements: R-01, R-05
Owns documentation and device evidence portions of S-02, S-13 and S-14.
Read frontend/README.md, frontend/tests/INSTALL_ONBOARDING_MANUAL_CHECKS.md and .prd/prd-v6.md. Old docs describe backup-excluded native storage and isolated preview keys; these guarantees are superseded. Preserve historical PRDs/evidence.

## Requirements
- Update current README and onboarding checklist for the single AsyncStorage boolean, standard Expo Go startup, secure existing auth restore and direct Dashboard destination. Remove instructions requiring custom native onboarding builds or separate preview/production storage.
- Explain the new key intentionally replays intro once for old installations and does not promise ordinary app backup exclusion. Preserve existing environment/secret conventions; no credential logging.
- Add .prd/frontend-mvp-verification-v6.md with the device matrix: missing flag, false, true/no credential, true/rejected credential, true/valid restored session (including pending garden setup), reload persistence and brief Splash each time. Record runtime/platform, storage reset method, dates and observed results without token values.
- Execute the real Expo Go matrix if a real device/runtime is available. Otherwise record unverified and what prevents execution. This is not a waiver: required review C-04 stays unverified and full PRD completion cannot be claimed until actual evidence exists or the user explicitly changes scope. Automated ticket verification below proves the integrated code/docs portion only.
- Run npm test --workspaces and frontend typecheck after changes. Do not absorb unrelated dependency/audit work or rewrite historical evidence.

## Acceptance Criteria
- [x] Current README/checklist describe the shared MVP and no longer instruct users to install the deleted module.
- [x] Device verification handoff contains every required matrix row and truthful observed/unverified status with no secrets.
- [x] Full frontend/backend tests and frontend TypeScript pass after implementation.
- [x] Required real-device obligation remains explicit; reports distinguish automated passes from unverified device behavior.

## Verification
Proves: Full workspace regression and frontend compilation, plus existence of the current device handoff; C-03 separately reviews guidance and C-04 requires actual Expo Go observations, neither is certified by this command.
```bash
set -euo pipefail
npm test --workspaces
npm run typecheck --workspace=frontend
test -s .prd/frontend-mvp-verification-v6.md
```

## Constraints
Do not fabricate device results or silently defer S-14. No custom native build, dependency changes, secret exposure, backend/database modifications or commits. Evaluation must keep required reviews separate from automated receipts.
