---
ticket: T-01
status: done
size: M
prd: .prd/prd-v1.md
depends_on: []
timeout: 600
started: 2026-10-05T07:47:35Z
finished: 2026-10-05T07:52:48Z
---

## Objective
Claim devices through an authenticated router and mount it in the server.

## Context
- Implements: R-01, R-04
- Scenarios: S-01–S-05; S-16 claim integration; S-17 claim verification
- Relevant files: backend/src/routes/devices.ts (new), backend/src/server.ts, backend/src/lib/auth.ts, backend/src/lib/http.ts, backend/prisma/schema.postgres.prisma
- Existing baseline: 73 backend tests pass; backend TypeScript compiles.

## Requirements
- Accept only macAddress and optional name; validate LC-hex or consistent colon/hyphen standard MAC formats, uppercase characters while preserving separators. Reject invalid bodies and names with 400; anonymous requests get 401.
- Create an owner-linked UUID Device with OFFLINE default; omitted name defaults to normalized macAddress. Return exactly the specified Device fields with ISO dates and 201.
- Reclaim by owner returns 200 and preserves UUID/name unless a valid trimmed name is provided; another owner receives 409 DEVICE_ALREADY_CLAIMED with no mutation.
- Handle P2002 contention by re-reading the winning row and applying the same ownership rules; test same-owner and foreign-owner concurrent claims.
- Mount devicesRouter at /api/devices and exercise the actual server mount in a test using the existing security/startup harness pattern; verify authentication, unexpected-field rejection, and sanitized storage failures.

## Acceptance Criteria
- [x] Accept only macAddress and optional name; validate LC-hex or consistent colon/hyphen standard MAC formats, uppercase characters while preserving separators. Reject invalid bodies and names with 400; anonymous requests get 401.
- [x] Create an owner-linked UUID Device with OFFLINE default; omitted name defaults to normalized macAddress. Return exactly the specified Device fields with ISO dates and 201.
- [x] Reclaim by owner returns 200 and preserves UUID/name unless a valid trimmed name is provided; another owner receives 409 DEVICE_ALREADY_CLAIMED with no mutation.
- [x] Handle P2002 contention by re-reading the winning row and applying the same ownership rules; test same-owner and foreign-owner concurrent claims.
- [x] Mount devicesRouter at /api/devices and exercise the actual server mount in a test using the existing security/startup harness pattern; verify authentication, unexpected-field rejection, and sanitized storage failures.
- [x] Run the verification block successfully and commit this endpoint with a conventional message after verification; include its code and tests, and preserve unrelated work.

## Verification
Proves: HTTP tests exercise this endpoint's accepted and rejected inputs, owner isolation, response contracts and failure paths; the full backend suite detects regressions and TypeScript checks strict compilation. New focused tests must be implemented, so this block cannot pass before delivery.
```bash
set -euo pipefail
node --import tsx/esm --experimental-test-module-mocks --test backend/tests/devices.test.mjs
npm test --workspace=backend
npx tsc --noEmit -p backend/tsconfig.json
```

## Constraints
- No external dependencies, raw SQL, migrations, frontend or firmware changes.
- Use existing Prisma clients, res.locals.auth.user.id, asyncRoute, bodyObject and HttpError. Never use any.
- Preserve existing .env ignore and .env.example conventions; do not read or print credentials into test output.
- Verification runs from repository root. Live database verification must use isolated fixtures and report unavailable infrastructure as unverified.
