---
ticket: T-15
status: done
size: M
prd: .prd/prd-v4.md
depends_on: [T-14]
timeout: 600
started: 2026-10-07T13:39:44Z
finished: 2026-10-07T13:43:03Z
---

## Objective
Add backup-excluded installation completion storage without changing credential storage.

## Context
Read PRD Architecture and frontend/services/token-storage.native.ts, frontend/services/local-state-storage.ts and frontend/app.json. Owns storage aspects of S-05 through S-11; T-16 integrates the UI and T-17 supplies native review evidence.

Implements: R-02, R-03

## Requirements
- Create the local Expo module, versioned validated store and native/web adapters described by the PRD. Android uses noBackupFilesDir; iOS uses an Application Support location with exclusion applied and verified before accepting the record, including atomic replacement.
- Expose loading/incomplete/completed/error plus retry and serialized completion; publish completed only after successful durable persistence. Missing is incomplete; malformed or unsupported records and I/O failures are explicit errors, not destructive resets.
- Browser fallback uses a distinct local key. A missing native module must report recovery rather than silently use AsyncStorage. Test persistence across store instances, concurrent writes, invalid records, read/write failures and retry.
- Retain token key, matching get/set/delete options, device-only accessibility, Android backup configuration and cookie/access-token boundaries. No shared Keychain group or synchronizable attribute.
- Add frontend/tests/install-onboarding-storage.test.ts and frontend/tests/install-onboarding-native-contract.test.ts. Native source/config assertions establish only static contracts, not actual transfer behavior.
- The existing global android/ and ios/ ignore rules also match module subdirectories. Add narrowly scoped negations for module source/config paths if needed while retaining generated build and secret exclusions. Document native rebuild and Expo Go limitations.

## Acceptance Criteria
- [x] Missing, malformed, unsupported, failed-write and retry cases have observable tests; writes do not unlock completion early.
- [x] Same installation persistence survives store recreation and account changes; no garden records or credentials are copied into the marker.
- [x] Native module source is not accidentally ignored; backup exclusion and unchanged SecureStore options have static checks.

## Verification
Proves: Validated durable store behavior, failure handling and platform adapter contracts; native static checks protect exclusion configuration but require C-05 device review for lifecycle guarantees.
```bash
set -euo pipefail
cd frontend
node --import tsx --test --test-concurrency=1 tests/install-onboarding-storage.test.ts tests/install-onboarding-native-contract.test.ts tests/session.test.ts
cd ..
npm run typecheck --workspace=frontend
```

## Constraints
Follow AGENTS.md: strict TypeScript without `any`, existing hooks/router and credential boundaries. No implementation beyond PRD v4, publishing, pushing or merging. Local commits for Pincer evaluation are authorized by AGENTS.md. Never claim planned tests or review obligations have already passed.
