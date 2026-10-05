---
ticket: T-02
status: done
size: L
prd: .prd/prd-v1.md
depends_on: [T-01]
timeout: 600
started: 2026-10-05T07:52:48Z
finished: 2026-10-05T07:59:34Z
---

## Objective
Pair or unpair owned plants atomically, including automatic reassignment under concurrent requests.

## Context
- Implements: R-02, R-04
- Scenarios: S-06–S-10; S-16 pairing integration; S-17 pairing verification
- Relevant files: backend/src/routes/plants.ts, backend/src/lib/ownership.ts, backend/prisma/schema.postgres.prisma, backend/tests/plants.test.mjs, backend/tests/demo-telemetry.test.mjs
- Existing baseline: 73 backend tests pass; backend TypeScript compiles.

## Requirements
- Validate UUIDs and allow only required deviceId as UUID or null. Missing/invalid/extra inputs return 400; unauthenticated requests return 401 and absent/foreign resources return 404 NOT_FOUND before writes.
- Use ownedPlant and ownedDevice; optionally extend their typed client argument with default prismaPg so authorization is repeated through tx. All transaction reads/writes use tx and target mutations remain owner-scoped.
- Use prismaPg.$transaction with Serializable isolation. Clear all other holders of the verified device then assign the target, or clear target on null; return existing serializePlant representation, including omitted null deviceId.
- Retry P2034 at most three attempts. Retry exhaustion returns 409 PAIRING_CONFLICT; unexpected storage errors return sanitized 500. Test reassignment, replacement, repeated unpair, rollback on assignment failure, concurrent conflict/retry and exhaustion.
- Preserve existing plant CRUD, ownership and demo behavior. Mock tests must assert transaction options and rollback/state results, not just call names. If isolated test database credentials are available, add/run a real PostgreSQL concurrency check through Prisma; otherwise explicitly report that live correctness is unverified.

## Acceptance Criteria
- [x] Validate UUIDs and allow only required deviceId as UUID or null. Missing/invalid/extra inputs return 400; unauthenticated requests return 401 and absent/foreign resources return 404 NOT_FOUND before writes.
- [x] Use ownedPlant and ownedDevice; optionally extend their typed client argument with default prismaPg so authorization is repeated through tx. All transaction reads/writes use tx and target mutations remain owner-scoped.
- [x] Use prismaPg.$transaction with Serializable isolation. Clear all other holders of the verified device then assign the target, or clear target on null; return existing serializePlant representation, including omitted null deviceId.
- [x] Retry P2034 at most three attempts. Retry exhaustion returns 409 PAIRING_CONFLICT; unexpected storage errors return sanitized 500. Test reassignment, replacement, repeated unpair, rollback on assignment failure, concurrent conflict/retry and exhaustion.
- [x] Preserve existing plant CRUD, ownership and demo behavior. Mock tests must assert transaction options and rollback/state results, not just call names. If isolated test database credentials are available, add/run a real PostgreSQL concurrency check through Prisma; otherwise explicitly report that live correctness is unverified.
- [x] Run the verification block successfully and commit this endpoint with a conventional message after verification; include its code and tests, and preserve unrelated work.

## Verification
Proves: HTTP tests exercise this endpoint's accepted and rejected inputs, owner isolation, response contracts and failure paths; the full backend suite detects regressions and TypeScript checks strict compilation. New focused tests must be implemented, so this block cannot pass before delivery.
```bash
set -euo pipefail
node --import tsx/esm --experimental-test-module-mocks --test backend/tests/plant-pairing.test.mjs
npm test --workspace=backend
npx tsc --noEmit -p backend/tsconfig.json
```

## Constraints
- No external dependencies, raw SQL, migrations, frontend or firmware changes.
- Use existing Prisma clients, res.locals.auth.user.id, asyncRoute, bodyObject and HttpError. Never use any.
- Preserve existing .env ignore and .env.example conventions; do not read or print credentials into test output.
- Verification runs from repository root. Live database verification must use isolated fixtures and report unavailable infrastructure as unverified.
