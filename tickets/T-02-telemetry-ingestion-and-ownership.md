---
ticket: T-02
status: done
size: M
prd: .prd/prd-v1.md
depends_on: [T-01]
started: 2026-10-02T12:32:45Z
finished: 2026-10-02T12:36:46Z
---

## Objective

Protect the telemetry ingestion and read path so device data remains valid, owned, and separated from relational plant state.

## Context

- Relevant files: `backend/src/routes/telemetry.ts`, `backend/src/lib/demo-telemetry.ts`, `backend/prisma/schema.prisma`, `backend/prisma/schema.postgres.prisma`
- PRD section: `R-02` and `R-05`
- Implements: R-02, R-05

## Requirements

- Telemetry payloads must validate numeric values and reject malformed, non-finite, or unknown-device submissions before any write occurs.
- Latest and historical telemetry reads must require valid plant/device ownership before returning data.
- Synthetic telemetry seeding must not override a different existing device association and must preserve the owner/device relationship model.

## Acceptance Criteria

- [x] A valid device or synthetic seed flow records a new telemetry sample without corrupting plant ownership.
- [x] Invalid numeric or unknown-device payloads are rejected with a clear error and no partial write.
- [x] A non-owner cannot fetch latest or historical telemetry for a device.
- [x] Re-seeding a plant keeps the original ownership model and avoids replacing an unrelated device association.

## Verification

Proves: This verifies the telemetry acceptance and reject logic, including owner-scoped reads and the synthetic seeding guardrails.

```bash
cd backend && node --import tsx/esm --experimental-test-module-mocks --test tests/demo-telemetry.test.mjs tests/ownership.test.mjs tests/security.test.mjs
```

## Constraints

- Do not add device authentication without explicitly extending the PRD scope.
- Do not merge telemetry and plant ownership logic into a single unscoped endpoint.
