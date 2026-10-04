---
ticket: T-11
status: done
size: M
prd: .prd/prd-v3.md
depends_on: [T-10]
timeout: 900
started: 2026-10-04T06:56:25Z
finished: 2026-10-04T07:11:05Z
---

## Objective
Commit each scan's plant, report and parsed task set atomically and prove rollback against a disposable PostgreSQL database.

## Context
- Relevant files: `backend/src/routes/scan.ts`, `backend/src/lib/prisma-pg.ts`, `backend/prisma/schema.postgres.prisma`, `backend/prisma/schema.prisma`, `backend/tests/scan-cache.test.mjs`, `backend/package.json`.
- Add focused persistence helper/tests if useful, `backend/tests/scan-persistence.test.mjs`, a separate integration test directory, and `backend/scripts/test-scan-persistence.mjs` powering `test:scan-persistence`.
- Implements: R-02, R-03, R-04
- Scenarios: S-05, S-09, S-10, S-11, S-12
- Depends on T-10. Read `.windsurf/skills/prisma-client-api/SKILL.md` and transactions references; read relevant `prisma-cli`/`prisma-postgres` skills before test-database provisioning. Follow installed Prisma 6, not newer construction examples.

## Requirements
- Prepare provider and parser output before opening a short PostgreSQL interactive transaction. All scan-owned plant/identification/analysis/task/health writes use its transaction client. Species-cache work and MongoDB telemetry reads stay outside it.
- Derive user/plant/analysis linkage from trusted server state and initialize tasks `PENDING`. Recheck ownership as needed at the write boundary. Return success only after commit; respond with the persisted task array/count rather than an independently rebuilt array.
- On any write failure roll back all scan-owned changes and return the existing sanitized failure. A rescan failure preserves previous plant fields, analyses and tasks. Successful rescans create a fresh analysis/task set without another plant or changes to completed/skipped history.
- Replace characterization of partial writes with atomic failure assertions. Unit tests inject failures at plant, identification, analysis, task insertion and final health update; use real persistence code with controlled transaction boundaries.
- Add non-interactive `npm run test:scan-persistence --workspace=backend`. Its runner provisions a fresh disposable PostgreSQL container, supplies its own temporary credentials/URLs to child processes, applies the existing PostgreSQL schema and invokes Node integration tests. It must override rather than reuse application `.env` database configuration, never reset shared databases, and clean up only its own container/resources in finally/signal handling.
- Use Prisma Client exclusively for fixture queries and assertions. The integration suite exercises actual application persistence and observes successful commit plus rollback after each injected stage failure, for new plants and rescans, through a fresh read. Test invalid/foreign ownership before writes as well.
- Keep real-database integration outside the default `tests/*.test.mjs` glob and invoke it explicitly so ordinary mocked suites do not need Docker. Missing Docker/image/client/schema prerequisites cause the required integration command to fail clearly, never skip or return a false pass. Generate the PostgreSQL client if needed using the project's existing CLI.
- Preserve existing `.env` ignores and keep test credentials runtime-only. Record provisioning steps without connection strings or secrets in output.

## Acceptance Criteria
- [x] New-plant success commits matching plant, identification, archived report, task owner/analysis links and health timestamp together; report/tasks remain available through GET after a new request.
- [x] Failure at every write stage leaves no new scan-owned rows; rescan failures leave the previous plant/history unchanged, verified against actual PostgreSQL.
- [x] Successful rescans create no second plant, preserve completed/skipped tasks, and add only the new report's bounded parsed task set.
- [x] Invalid report/provider/owner inputs are rejected before relational scan writes; task text cannot control ownership or completion state.
- [x] The isolated integration runner uses only its own database, fails on unavailable prerequisites, cleans up its own resources, and passes without schema changes, raw SQL, or production data access.

## Verification
Proves: transaction-linked task persistence and existing-plant preservation pass route regressions and actual PostgreSQL commit/rollback checks; a mocked transaction alone cannot satisfy this gate.
```bash
set -euo pipefail
npm test --workspace=backend
npm run test:scan-persistence --workspace=backend
node node_modules/typescript/bin/tsc --noEmit -p backend/tsconfig.json
```

## Constraints
- No cross-database transaction, schema migration, shared database reset, raw SQL, historical duplicate cleanup, or cross-request idempotency.
- Transaction rollback cannot undo species-cache writes or a previously committed request whose response was lost.
- A missing Docker capability is an explicit unverified integration obligation, not permission to replace the real-database check with mocks.
