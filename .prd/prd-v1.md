---
version: 1
status: draft
date: 2026-10-05
---

# Device Claiming, Plant Pairing, and Telemetry BFF

## Problem

Hardware telemetry arriving through Vercel uses a MAC-derived identifier such as LC-A50528, whereas PostgreSQL Device.id is a UUID. Users need authenticated endpoints to claim hardware, associate it with a plant, and retrieve its latest reading without handling this database identifier mismatch themselves.

Source: the user's `$pincer-plan` brief in this conversation, titled “Device Claiming, Plant Pairing, and Telemetry BFF.” Its four numbered deliverables map respectively to R-01, R-02, R-03, and R-04 below. Constraints require existing clients and ownership helpers, TypeScript, transactional pairing, no added dependencies, and a verified commit after each endpoint.

Planning profile: standard. This changes authorization boundaries and concurrent relational writes across a dual-database application; a small profile would understate those risks.

## Solution

Add an authenticated claim router and two authenticated plant subroutes. PostgreSQL remains authoritative for ownership and pairing; MongoDB supplies the newest reading under the paired Device.macAddress. Preserve existing plant response serialization and existing telemetry endpoints. No frontend, ingestion, schema migration, or dependency upgrade is included.

Assumptions: a missing claim name defaults to the normalized hardware identifier; supplied names are trimmed, nonempty strings of at most 100 characters. Standard MAC means six two-digit hexadecimal groups with consistent colon or hyphen separators; preserve separators and uppercase characters so MongoDB keys are not silently rewritten. Paired devices without readings return HTTP 200 with telemetry null. These are routine defaults for gaps in the brief.

Authorization basis: the user explicitly requested these endpoints, specified the architecture and transaction constraint, and wrote “Commit your changes after each endpoint is implemented and verified.” This covers the implementation and endpoint commits; this invocation produces its planning artifact. Any expanded ingestion or demo compatibility scope requires a separate decision.

## Scope

| This PRD covers | This PRD does NOT cover |
| --- | --- |
| Claiming devices and registering /api/devices | Device listing, deletion, transfer, or hardware proof of possession |
| Owner-only pair/unpair with automatic reassignment | Frontend screens or firmware changes |
| Plant telemetry BFF using MAC-based Mongo keys | Changes to UUID-based ingestion/history/latest or demo generators |
| Concurrency handling, validation, and meaningful route tests | Dependency upgrades, database migrations, data backfills |

## Requirements

### R-01 — Claim hardware

- **S-01:** Authenticated POST /api/devices/claim with a valid unclaimed LC identifier or standard MAC creates a UUID Device owned by the authenticated user and returns 201 with id, name, macAddress, userId, status, createdAt, and updatedAt; characters are uppercase and default status is OFFLINE.
- **S-02:** Claiming one's existing hardware returns 200 and the same Device UUID; a provided valid name updates it, while omission preserves its name.
- **S-03:** Claiming another user's hardware returns 409 with code DEVICE_ALREADY_CLAIMED and performs no ownership or name mutation.
- **S-04:** Invalid hardware identifiers, invalid optional names, malformed bodies, or unexpected fields return the established 400 error contract without writes; anonymous requests return 401.
- **S-05:** Concurrent claims of the same normalized key create at most one Device; a unique-key collision is resolved by re-reading ownership and returning the same-owner 200 or foreign-owner 409 result rather than exposing a storage error.

### R-02 — Pair or unpair a plant

- **S-06:** PATCH /api/plants/:plantId/pair-device validates the plant UUID through ownedPlant and device UUID through ownedDevice; missing or foreign plants/devices return 404 NOT_FOUND without mutation, and anonymous callers return 401.
- **S-07:** A body containing deviceId null clears the owner's Plant.deviceId and returns 200 with the updated existing Plant API representation; repeating unpair succeeds.
- **S-08:** Pairing an owned device clears that device from every other plant holding it before assigning it to the target, atomically in prismaPg.$transaction; replacing a target's previous device succeeds and returns the updated Plant representation.
- **S-09:** Concurrent pairing to the same device leaves at most one plant assigned, with bounded retries for serialization conflicts; failures roll back both unpair and assignment. Retry exhaustion returns a controlled 409 PAIRING_CONFLICT; unrelated database failures use the existing sanitized 500 contract.
- **S-10:** Missing deviceId, non-UUID strings, non-string/non-null values, and extra body fields return 400 without writes. Existing CRUD, health updates, and demo seeding retain their response and ownership behavior.

### R-03 — Resolve latest plant telemetry

- **S-11:** Authenticated GET /api/plants/:plantId/telemetry returns 200 with paired false, device null, and telemetry null for an owned unpaired plant, without querying MongoDB.
- **S-12:** For an owned paired plant and owned associated device, lookup uses prisma.sensorReading.findFirst with deviceId equal to Device.macAddress and timestamp descending; return 200 with paired true, the standard Device object, and a TelemetryPayload.
- **S-13:** Soil moisture strictly below Plant.minMoisture is dry, strictly above Plant.maxMoisture is overwatered, and both boundaries and intermediate values are optimal. Preserve ISO timestamps, raw/lux null fallback to zero, environment field mapping, and existing light thresholds of 500 and 50,000 lux.
- **S-14:** An owned paired device with no matching reading returns 200 with paired true, its Device object, and telemetry null. Invalid plant IDs return 400; absent/foreign plants or foreign associated devices return 404; anonymous requests return 401 before telemetry reads.
- **S-15:** PostgreSQL or MongoDB failures return sanitized errors through the existing handler. Existing UUID-based telemetry endpoints and demo consumers continue to work unchanged; this MAC-only BFF does not promise to retrieve their UUID readings.

### R-04 — Integration and verified delivery

- **S-16:** server.ts mounts devicesRouter at /api/devices; both plant subroutes use existing authenticated route middleware and the error envelope of HttpError, without relying on the nonexistent req.auth.userId.
- **S-17:** Backend Node tests pass and TypeScript reports no errors after each endpoint; meaningful new tests cover claim races, pairing rollback/retry, ownership rejection, and BFF mapping. Commit each verified endpoint with a conventional message, including claim router registration with the claim endpoint.

## Architecture

### Structure

```
backend/src/routes/devices.ts             new authenticated claim router
backend/src/routes/plants.ts              pairing and telemetry subroutes
backend/src/server.ts                     devices router registration
backend/src/lib/ownership.ts              optional transaction client support
backend/tests/                           claim, pairing, BFF regression tests
```

### Key components and data flow

Use res.locals.auth.user.id, requireAuth, asyncRoute, bodyObject, resourceId, ownedPlant, and ownedDevice. The repository has no req.auth.userId. Claim uses PostgreSQL's existing unique macAddress index and UUID defaults or Node's randomUUID, handling Prisma unique-key contention by re-reading the winning row. Device serialization exposes only the specified fields and ISO dates.

Pairing uses an interactive PostgreSQL transaction with Serializable isolation and at most three attempts for P2034. Extend ownership helpers with an optional typed transaction client if needed so ownership checks are repeated inside the transaction. Read and write through tx, scope target writes by userId, clear other holders of the selected verified device, then assign the target. Default ReadCommitted is insufficient because Plant.deviceId has no unique constraint. No raw SQL is introduced. The guarantee applies to this pairing operation; existing direct database writers are not converted into a global schema invariant.

The BFF fetches the owned Plant with its associated Device, validates device ownership before exposing data, then queries MongoDB by macAddress. TelemetryPayload.deviceId remains the stored hardware key. MongoDB is read only; there is no cross-database transaction. Keep the Plant serializer's current omitted-null deviceId and simulated flag.

### Brownfield evidence, blast radius, and rollback

Load-bearing files read directly: both Prisma schemas, both client wrappers, ownership.ts, plants.ts, telemetry.ts, sensor.ts, server.ts, demo-telemetry.ts, and plants.test.mjs. Existing ownership tests, plant CRUD tests, and demo telemetry tests protect neighboring behavior. Baseline on 2026-10-05: npm test --workspace=backend passed all 73 tests; npx tsc --noEmit -p backend/tsconfig.json exited 0. The suite uses mocks and does not establish live PostgreSQL concurrency correctness.

New routes affect device ownership and plant associations. Rollback is a code revert and removal of new route mounting; no migration rollback is needed. Previously claimed devices and changed pairings persist and must be deliberately repaired through Prisma if business rollback requires it. Mocked transaction tests must assert isolation/retry/rollback behavior; a real PostgreSQL concurrency check should be run against isolated fixtures when test credentials are available and must be reported as unrun if unavailable.

## Success Criteria

| Criterion | How to verify |
| --- | --- |
| Observable endpoint behaviors and failures match S-01 through S-16 | Node route tests with HTTP requests and mocked database clients |
| Concurrent pairing cannot silently produce duplicate assignments | Serializable transaction assertions, conflict/rollback tests, isolated live PostgreSQL check when available |
| Existing backend behavior remains green | npm test --workspace=backend |
| Strict TypeScript compiles | npx tsc --noEmit -p backend/tsconfig.json |
| Delivery is reviewable per endpoint | Three conventional implementation commits with successful verification evidence |

## Out of Scope

Frontend design is unchanged; visual discovery is inapplicable to this backend-only scope. No new dependencies, client upgrades, Prisma migrations, historical key conversion, telemetry ingestion changes, history BFF, freshness policy, sensor calibration, ownership transfer, or device possession verification. No requirements were cut for a time budget.

## Security & Trust Boundaries

Request bodies and resource IDs are untrusted and validated before queries or writes. Identity comes only from the authenticated session; neither userId nor Device ownership is accepted from the body. Both database credentials and JWT signing material remain server-side in existing environment configuration. Foreign resources use 404, while the explicitly requested claim conflict uses 409; internal failures remain sanitized. MAC knowledge alone permits first claim, as specified by the brief.

## Dependencies & Risks

Retain repository Express ^4.21.2 and Prisma/client ^6.19.3. Registry checks on 2026-10-05 returned Express 5.2.1 and Prisma 8.0.0-rc.19 as latest; those are not upgrade targets. Installed generated PostgreSQL types confirm Serializable support. Current Prisma documentation redirects to a newer API, so implement against the installed Prisma 6 client contracts, not newer db.transaction examples.

No prisma-* skill directories were found in .agents/skills or the local Codex skill directory after checking the project database rule; rely on actual schemas/generated types and version-appropriate Prisma guidance during implementation. No new third-party HTTP API contract is introduced: Vercel ingestion is an upstream assumption supplied by the brief, not changed here.

Compatibility decision surfaced to the user: MAC-only BFF versus MAC hardware plus UUID demo support. The draft follows the explicit MAC-only brief unless the user requests the latter; UUID-backed demo plants will have telemetry null through this new endpoint, while their existing routes keep working. Uppercasing assumes upstream ingestion uses uppercase hardware keys. Legacy lowercase records and alternative MAC separator equivalence are not backfilled.
