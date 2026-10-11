---
ticket: T-20
status: done
size: M
prd: .prd/prd-v6.md
depends_on: []
timeout: 600
started: 2026-10-11T02:55:05Z
finished: 2026-10-11T02:55:55Z
---

## Objective
Replace native/preview onboarding persistence with one shared AsyncStorage boolean contract, protected by focused behavior tests.

## Context
Implements: R-01, R-02
Owns S-01, storage/runtime contract portion of S-02, S-03–S-06; T-21 owns their UI integration and T-22 owns current guidance and real-device review.
Read frontend/services/install-onboarding-storage.ts, its native adapter, install-onboarding-store.ts, context/install-onboarding.tsx and tests/install-onboarding-storage.test.ts before editing. The provider currently sits outside account-keyed providers; keep this lifetime. The installed AsyncStorage dependency already supplies native/web storage.

## Requirements
- Delete the entire frontend/modules/install-onboarding/ folder, frontend/services/install-onboarding-storage.native.ts and frontend/tests/install-onboarding-native-contract.test.ts. Check active config and lockfile for custom module references; remove only obsolete references.
- Shared install-onboarding-storage.ts uses AsyncStorage only, key @leafcheck_onboarding_complete, with no runtime/environment switch or legacy marker migration.
- Store string-serialized JSON booleans; null/false mean incomplete, true means complete. Reject malformed and nonboolean input with existing sanitized recoverable errors. Never silently rewrite corrupt records or delete unrelated state.
- Preserve read/write coalescing, retry, durable completion before unlocking, and provider independence from account generations. Leave auth credential handling unchanged.
- Update focused storage tests and add tests/install-onboarding-asyncstorage.test.ts using the existing isolated adapter-loading pattern with an injected AsyncStorage implementation. Assert exact keys/values, reload persistence, legacy-key isolation, synchronous/rejected I/O recovery and no SecureStore/native loader use. Test nonboolean rejection and no writes on reads.
- Keep existing UI-compatible state methods until T-21 integrates any splash-phase changes; update affected persistence assertions in integration fixtures without prematurely changing route expectations.

## Acceptance Criteria
- [x] Required native paths are deleted and shared adapter runs without custom native capability.
- [x] Missing/false/true records produce correct completion decisions; writes persist only true to the exact new key and reload retains it.
- [x] Malformed records, rejected reads and rejected writes are recoverable, do not unlock completion and do not alter credentials or garden data.
- [x] Concurrent loads/taps coalesce and completion becomes observable only after successful write.
- [x] Legacy markers and account/session changes cannot supply or reset the new completion flag.

## Verification
Proves: Real store and injected shared adapter exercise persistence, boolean rejection, retry and durable write ordering; deleted-path assertions prove the static removal contract.
```bash
set -euo pipefail
test ! -e frontend/modules/install-onboarding
test ! -e frontend/services/install-onboarding-storage.native.ts
test ! -e frontend/tests/install-onboarding-native-contract.test.ts
(cd frontend && node --import tsx --test --test-concurrency=1 tests/install-onboarding-storage.test.ts tests/install-onboarding-asyncstorage.test.ts)
npm run typecheck --workspace=frontend
```

## Constraints
Strict TypeScript without any; no new dependencies, backend/database edits, credential relocation, legacy cleanup, design changes or commits. Historical PRDs and evidence remain intact. Focused tests are required work, not evidence already obtained.
