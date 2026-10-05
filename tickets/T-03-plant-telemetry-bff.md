---
ticket: T-03
status: open
size: M
prd: .prd/prd-v1.md
depends_on: [T-02]
timeout: 600
---

## Objective
Expose latest hardware telemetry through the owned plant and its paired Device MAC.

## Context
- Implements: R-03, R-04
- Scenarios: S-11–S-15; S-16 BFF integration; S-17 BFF verification
- Relevant files: backend/src/routes/plants.ts, backend/src/lib/ownership.ts, backend/src/lib/prisma.ts, backend/src/types/sensor.ts, backend/src/routes/telemetry.ts
- Existing baseline: 73 backend tests pass; backend TypeScript compiles.

## Requirements
- GET /api/plants/:plantId/telemetry uses existing authentication and ownedPlant UUID validation. Anonymous callers get 401, invalid IDs 400, missing/foreign plants or foreign associated devices 404, before Mongo access.
- Fetch the associated PostgreSQL Device and validate its ownership. Unpaired plants return 200 {paired:false,device:null,telemetry:null} without Mongo queries.
- Query sensorReading.findFirst by device.macAddress with timestamp descending; return paired true, standard Device fields, and the TelemetryPayload or null when no reading exists. Query only MAC keys; no UUID fallback.
- Use plant moisture bounds with strict below/above and inclusive optimal boundaries. Test all soil states/boundaries, custom thresholds, ISO time, sensor mappings, nullable raw/lux fallback, and 500/50000 light thresholds.
- Test both database failure paths for sanitized 500 responses. Preserve UUID-based legacy endpoints and demo consumers; explicitly demonstrate that a UUID-only reading does not match this MAC-only BFF.

## Acceptance Criteria
- [ ] GET /api/plants/:plantId/telemetry uses existing authentication and ownedPlant UUID validation. Anonymous callers get 401, invalid IDs 400, missing/foreign plants or foreign associated devices 404, before Mongo access.
- [ ] Fetch the associated PostgreSQL Device and validate its ownership. Unpaired plants return 200 {paired:false,device:null,telemetry:null} without Mongo queries.
- [ ] Query sensorReading.findFirst by device.macAddress with timestamp descending; return paired true, standard Device fields, and the TelemetryPayload or null when no reading exists. Query only MAC keys; no UUID fallback.
- [ ] Use plant moisture bounds with strict below/above and inclusive optimal boundaries. Test all soil states/boundaries, custom thresholds, ISO time, sensor mappings, nullable raw/lux fallback, and 500/50000 light thresholds.
- [ ] Test both database failure paths for sanitized 500 responses. Preserve UUID-based legacy endpoints and demo consumers; explicitly demonstrate that a UUID-only reading does not match this MAC-only BFF.
- [ ] Run the verification block successfully and commit this endpoint with a conventional message after verification; include its code and tests, and preserve unrelated work.

## Verification
Proves: HTTP tests exercise this endpoint's accepted and rejected inputs, owner isolation, response contracts and failure paths; the full backend suite detects regressions and TypeScript checks strict compilation. New focused tests must be implemented, so this block cannot pass before delivery.
```bash
set -euo pipefail
node --import tsx/esm --experimental-test-module-mocks --test backend/tests/plant-telemetry.test.mjs
npm test --workspace=backend
npx tsc --noEmit -p backend/tsconfig.json
```

## Constraints
- No external dependencies, raw SQL, migrations, frontend or firmware changes.
- Use existing Prisma clients, res.locals.auth.user.id, asyncRoute, bodyObject and HttpError. Never use any.
- Preserve existing .env ignore and .env.example conventions; do not read or print credentials into test output.
- Verification runs from repository root. Live database verification must use isolated fixtures and report unavailable infrastructure as unverified.
