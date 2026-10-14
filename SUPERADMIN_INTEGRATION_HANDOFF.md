# LeafCheck AI — SuperAdmin Integration Handoff

**Prepared:** 2026-10-12. **Source revision:** `369b75ccf6c6735067f47b9a9ed77f7951823bcf`.
**Audience:** the implementation team/AI for the separate `LeafCheck-AI-SuperAdmin` repository.
**Scope:** source-based integration specification; no application changes, migrations, admin endpoints, or commits were made for this handoff.

Sections 1–5 describe **existing implementation**. Section 6 is a **proposed contract, not an available API**. Sections 7–9 distinguish source/local evidence from deployment settings that require operator confirmation. Sample records are illustrative, not exported account data. Environment variable values, credentials, password hashes, and tokens are deliberately excluded.

The SuperAdmin repository and its reported React 19 + Vite + Express 5 + SQLite implementation were described by the project owner; that repository was not available for inspection. Its five `503 NOT_CONNECTED` sections are an integration gap: this backend has no `/api/admin/*` namespace. Calling a nonexistent upstream admin route currently returns **404**, not that console's local `503 NOT_CONNECTED`.

## 1. System Overview

LeafCheck AI helps users organize indoor plants, identify species from photographs, save AI health reports, manage care tasks, and pair ESP32 sensors for environmental monitoring. The mobile dashboard highlights plants with saved `warning`/`critical` health statuses, care due dates, recent scans, and sensor status. Plant profiles combine saved scan guidance with separately refreshed telemetry. Named spaces are a frontend organization feature; there is no PostgreSQL `Space` model.

### 1.1 Architecture and sources of truth

```text
Phone / Expo web app
  React Native + React 19 + Expo 57 + Expo Router
  Auth/session coordinator; account-scoped local UI state
           ⇅ HTTPS JSON / bearer access token
Render web service: LeafCheck-AI
  Node.js / TypeScript / Express 4.21.2
  https://leafcheck-ai.onrender.com
           ├── prismaPg ⇄ PostgreSQL
           │   User, Device, Plant, AuthSession, RefreshToken,
           │   PlantIdentification, PlantSpecCache, AIAnalysis, CareTask
           ├── prisma ⇄ MongoDB Atlas
           │   sensorReadings: append-only environmental readings
           ├── optional Pl@ntNet: species identification hint
           ├── optional Perenual: botanical reference lookup/cache
           ├── Gemini: living-plant/species verification + diagnosis
           └── optional Cloudinary: scan photograph storage

ESP32: SHT31 + BH1750 + soil ADC
           └── HTTPS POST /api/telemetry → Render → MongoDB
               Registered printed identifier, e.g. LC-A50528

Proposed admin integration:
SuperAdmin browser ⇄ SuperAdmin Express server / BFF
                           ⇅ authenticated /api/admin/*, NOT YET BUILT
                       Render backend ⇄ its two databases
```

The LeafCheck backend runs Express **4**, even though its `@types/express` dependency is version 5. Do not port Express 5 assumptions into this repository. PostgreSQL is authoritative for users, roles, ownership, pairing, saved scans, and server care tasks. MongoDB is authoritative for readings. SuperAdmin SQLite may hold its own sessions/cache, but must not become the source of truth for LeafCheck operator identities or device authorization.

### 1.2 Repository map

| Path | Integration relevance |
| --- | --- |
| `backend/src/server.ts` | Router mounts, CORS, body limits, rate limiting, liveness |
| `backend/prisma/schema.postgres.prisma` | Complete relational model definitions |
| `backend/prisma/schema.prisma` | Mongo `SensorReading` model and physical field mapping |
| `backend/src/lib/prisma-pg.ts` | `prismaPg`: PostgreSQL client from custom generated output |
| `backend/src/lib/prisma.ts` | `prisma`: Mongo client from `@prisma/client` |
| `backend/src/routes/*.ts` | Seven route modules; inventory in section 5 |
| `backend/src/lib/auth*.ts`, `password*.ts`, `password-worker.mjs` | Auth, token lifecycle, Argon2id |
| `backend/src/lib/ownership.ts`, `plant-pairing.ts` | Owner checks and transactional pairing |
| `backend/src/lib/telemetry-payload.ts`, `demo-telemetry.ts` | Physical/demo normalization and generation |
| `backend/src/lib/diagnosis-telemetry.ts`, `scan-persistence.ts` | Saved input provenance and atomic relational scan writes |
| `frontend/services/api.ts`, `validators.ts`, `session.ts` | Existing client contracts, validation, refresh/retry |
| `frontend/context/app-data.tsx`, `local-state.tsx`, `spaces.tsx` | Server collection and local organization state |
| `frontend/services/dashboard-summary.ts`, `sensor-overview.ts` | Current freshness and display classifications |
| `frontend/services/plant-profile-guidance.ts` | Diagnosis provenance badge rules |
| `hardware/firmware/src/main.cpp`, `config.template.h` | Actual ingest payload and default 15-second cadence |
| `backend/prisma/migrations/` | Two committed PG migrations; incomplete relative to current schema |

Use **both** Prisma clients. Importing only `@prisma/client` accesses MongoDB, not PostgreSQL. Do not connect a web browser directly to either database or publish connection strings in a Vite bundle.

### 1.3 Limits of account-wide visibility today

- Guest plants and guest activity are local and do not create backend users or records.
- Named-space metadata, space colors/archive flags, local avatar, care schedules, and some task-completion state live in account-scoped AsyncStorage. `Plant.location` persists a named location for authenticated plants. An admin cannot reconstruct empty spaces or all mobile care-task counts from PostgreSQL alone.
- There are no backend endpoints for email/password changes, account deletion, notification preferences, theme, language, temperature units, avatar sync, privacy-policy management, or help/support. UI roadmap rows do not imply backend functionality.
- AR is described in older project material, but is not a backend contract. There is no pH sensor reading; pH fields describe botanical reference ranges only.
- Existing user endpoints remain owner-scoped even when the caller's `User.role` is `ADMIN` or `LEAD_DEV`.

### 1.4 Scanner and diagnosis data flow

New image: validate ownership/image → optional Pl@ntNet (whole attempt bounded to 8 seconds, resize ≤1024px and <1,000,000 bytes) → Gemini checks subject/species → concurrently fetch Perenual/cache and latest linked Mongo reading → Gemini diagnosis → parse/validate report care actions → save plant, identification, analysis, tasks, health in one PostgreSQL transaction.

Gemini currently defaults to **`gemini-2.5-flash`**, overridable with `GEMINI_MODEL`; older descriptions naming 2.0 Flash are not the current default. Each Gemini request has a 45-second timeout. Perenual enrichment has a shared 10-second deadline and is optional. A Mongo/cache database failure in the concurrent enrichment step can still abort the scan; only optional provider failures and the second diagnosis stage have explicit degradation paths.

Saved-image retry: `POST /api/scan` with `{ "plantId": "<owned-plant-UUID>", "reusePreviousImage": true }`. It reuses the saved identity/photo, skips first-stage identification, fetches the **latest actual linked device reading server-side**, and creates a new analysis. The mobile caller does not need to inject sensor readings.

Second-stage diagnosis failure does **not** discard the confirmed living plant: response is `201`, `success: true`, `diagnosisError: true`, a safe message/code, saved photo/identity, a null report, no new tasks/notification. Existing plant health is preserved; a new plant stays `unknown`. Other failures, such as first-stage Gemini failure or persistence failure, are HTTP errors. Artificial/non-plant subjects return `200` with no saved plant/analysis/tasks.

Saved diagnosis badges describe `AIAnalysis.telemetrySnapshot`, not current pairing: fresh physical → `Sensor-Enhanced AI`; stale physical → `Image + Older Sensor Readings`; absent/unverified provenance → `Image-Only AI`; simulated → `Demo-Assisted AI`. Fresh means age between -1 minute and +30 minutes **at diagnosis capture time**, not today's time. Stale readings are included as historical context, not silently considered current. Current Growing Conditions can legitimately differ from saved diagnosis inputs.

## 2. Data Models — PostgreSQL via Prisma

Source: `backend/prisma/schema.postgres.prisma`. Nine models; enum `Role = USER | ADMIN | LEAD_DEV`. No model has a custom `@@map`, so Prisma uses the model names as table names. Scalar `String` IDs are stored as PostgreSQL text, with Prisma-generated UUID defaults; they are not annotated native PostgreSQL UUID columns. `DateTime` values become ISO UTC strings in JSON; `Float` is double precision; `Json` is JSONB.

Table convention: `?` means nullable; `[]` is a virtual to-many relation, not a scalar column. `—` means no declared default. Relation fields are virtual; their scalar FK columns are listed separately. `@updatedAt` is Prisma-managed, not a database SQL default.

### 2.1 User

| Field | Prisma type / nullable | Default / constraint / relation |
| --- | --- | --- |
| id | String, required | PK, `uuid()` |
| email | String, required | Unique; registration trims/lowercases |
| name | String? | — |
| password | String, required | —; encoded Argon2id hash, never plaintext |
| isActive | Boolean, required | `true` |
| role | Role, required | `USER` |
| createdAt | DateTime, required | `now()` |
| updatedAt | DateTime, required | `@updatedAt` |
| devices | Device[] | Reverse of `Device.user` |
| plants | Plant[] | Reverse of `Plant.user` |
| sessions | AuthSession[] | Reverse of `AuthSession.user` |
| careTasks | CareTask[] | Reverse of `CareTask.user` |
| analyses | AIAnalysis[] | Reverse of nullable `AIAnalysis.user` |

**Sensitive:** password must be completely excluded from admin DTOs, logs, exports, and search. Email/name are personal data: mask emails in lists and limit full identity to authorized detail views. `isActive` is checked at login, token refresh, and every authenticated request; disabling a user blocks those paths. There is no `isAdmin`, avatar, email-verification flag, phone field, or last-login timestamp.

### 2.2 AuthSession

| Field | Prisma type / nullable | Default / constraint / relation |
| --- | --- | --- |
| id | String, required | PK, `uuid()` |
| userId | String, required | FK → User.id |
| user | User, required | `userId`; delete User → Cascade |
| client | String, required | —; application writes `native` or `browser` |
| createdAt | DateTime, required | `now()` |
| expiresAt | DateTime, required | —; application sets 30-day absolute deadline |
| revokedAt | DateTime? | — |
| refreshTokens | RefreshToken[] | Reverse of `RefreshToken.session` |

Indexes: `(userId, revokedAt)`, `(expiresAt)`. **Sensitive:** session identity/security metadata. Admin lists should expose counts; detailed sanitized session metadata should exclude session IDs unless an explicit operational need is approved. There are no IP, user-agent, last-used, or MFA fields.

### 2.3 RefreshToken

| Field | Prisma type / nullable | Default / constraint / relation |
| --- | --- | --- |
| id | String, required | PK, `uuid()` |
| tokenHash | String, required | Unique; SHA-256 hash of opaque refresh token |
| sessionId | String, required | FK → AuthSession.id |
| session | AuthSession, required | `sessionId`; delete session → Cascade |
| createdAt | DateTime, required | `now()` |
| consumedAt | DateTime? | —; populated on successful rotation |

Index: `(sessionId)`. **Sensitive:** never return `tokenHash`, raw refresh tokens, or access JWTs from admin data APIs. A displayed `******` still must not be backed by a credential in the JSON response. Raw refresh tokens are not stored in this table.

### 2.4 Device

| Field | Prisma type / nullable | Default / constraint / relation |
| --- | --- | --- |
| id | String, required | PK, `uuid()` |
| name | String, required | — |
| macAddress | String, required | Unique; printed sensor identifier or `DEMO:<plantId>` |
| userId | String, required | FK → User.id |
| user | User, required | `userId`; delete User → Cascade |
| status | String, required | `"OFFLINE"`; not an enum |
| createdAt | DateTime, required | `now()` |
| updatedAt | DateTime, required | `@updatedAt` |
| plants | Plant[] | Reverse of `Plant.device` |

**Sensitive/operational:** owner identity and device identifier should be restricted to authorized staff. MAC is not a secret and does not prove physical possession. Firmware ingest does not update `status` or `updatedAt`; an `OFFLINE` database value can coexist with fresh live readings. There is no `lastSeenAt`, ingest credential, approved whitelist flag, firmware version, or revoked-device flag. Every existing Device has a user owner; unlinked is not the same as unowned.

### 2.5 Plant

| Field | Prisma type / nullable | Default / constraint / relation |
| --- | --- | --- |
| id | String, required | PK, `uuid()` |
| name | String, required | — |
| species | String, required | — |
| location | String? | —; named-space label, no Space FK |
| userId | String, required | FK → User.id |
| user | User, required | `userId`; delete User → Cascade |
| deviceId | String? | FK → Device.id (UUID), not MAC |
| device | Device? | `deviceId`; delete Device → SetNull |
| healthStatus | String, required | `"healthy"`; application uses healthy/warning/critical/unknown |
| minMoisture | Float, required | `30.0` |
| maxMoisture | Float, required | `80.0` |
| lastScannedAt | DateTime? | — |
| imageUrl | String? | —; delivery URL or scan JPEG data URL |
| createdAt | DateTime, required | `now()` |
| updatedAt | DateTime, required | `@updatedAt` |
| identifications | PlantIdentification[] | Reverse relation |
| analyses | AIAnalysis[] | Reverse relation |
| careTasks | CareTask[] | Reverse relation |

**Sensitive:** photo, location, identity association, health reports. Exclude image base64 from admin list payloads; return a thumbnail/delivery URL or `imageAvailable` instead. Manual-create endpoint initializes health to `unknown` despite the schema default. Moisture thresholds are percentages and currently meaningful for calibrated demo readings; physical ADC is not calibrated.

There is no unique constraint on `deviceId`. Pairing code uses a serializable transaction to detach the same device from other plants before attaching it, but existing schema/data can still represent multiple plant relations. Admin/overview DTOs must use `plants: []`, not assume a singular relation. New-scan device attachment is a separate write path; do not infer a database-enforced one-to-one relationship.

### 2.6 PlantSpecCache

| Field | Prisma type / nullable | Default / constraint / relation |
| --- | --- | --- |
| id | String, required | PK, `uuid()` |
| speciesName | String, required | Unique, exact cache key |
| commonName | String? | — |
| idealLuxMin | Int? | — |
| idealLuxMax | Int? | — |
| idealTempMinC | Float? | — |
| idealTempMaxC | Float? | — |
| idealHumidityMin | Float? | — |
| idealHumidityMax | Float? | — |
| idealPhMin | Float? | — |
| idealPhMax | Float? | — |
| wateringFrequency | String? | — |
| sunlight | String? | — |
| rawJson | Json? | —; reference provider response |
| createdAt | DateTime, required | `now()` |
| updatedAt | DateTime, required | `@updatedAt` |

No relations. **Sensitive:** not normally user personal data; inspect/redact unstructured provider JSON before administrative export. Lux ranges are approximate sunlight mappings, not measured values. Humidity ranges are currently null because this provider does not supply them. pH is a species reference, never measured telemetry. Cache lookup has no expiry policy.

### 2.7 PlantIdentification

| Field | Prisma type / nullable | Default / constraint / relation |
| --- | --- | --- |
| id | String, required | PK, `uuid()` |
| plantId | String, required | FK → Plant.id |
| plant | Plant, required | `plantId`; delete Plant → Cascade |
| speciesName | String, required | — |
| commonName | String? | — |
| confidence | Float, required | —; normalized fraction 0–1 |
| imageUrl | String? | — |
| rawResponse | Json? | — |
| createdAt | DateTime, required | `now()` |

**Sensitive:** photos and provider JSON linked to a user; omit raw response by default. Despite an old schema comment, records may contain Gemini-adjusted identification or saved-image retry metadata, not exclusively Pl@ntNet output. Current scan persistence saves the photo to Plant, not necessarily `PlantIdentification.imageUrl`; retry confidence is 0 because identity was reused, not re-scored.

### 2.8 AIAnalysis

| Field | Prisma type / nullable | Default / constraint / relation |
| --- | --- | --- |
| id | String, required | PK, `uuid()` |
| plantId | String, required | FK → Plant.id |
| plant | Plant, required | `plantId`; delete Plant → Cascade |
| userId | String? | FK → User.id; legacy records can be null |
| user | User? | `userId`; delete User → Cascade |
| healthStatus | String, required | — |
| diagnoses | Json, required | —; current scan writes `[]` |
| recommendations | Json, required | —; current scan writes `[]` |
| rawAnalysisText | String? | —; actual diagnostic report, null on diagnosis failure |
| speciesName | String? | — |
| telemetrySnapshot | Json? | —; actual diagnosis inputs, see section 3.4 |
| idealSpecs | Json? | —; reference/cache snapshot |
| notificationTime | DateTime? | — |
| notificationReason | String? | — |
| isArchived | Boolean, required | `true` |
| archivedAt | DateTime? | `now()` despite being nullable |
| createdAt | DateTime, required | `now()` |
| careTasks | CareTask[] | Reverse of nullable `CareTask.analysis` |

Indexes: `(userId, isArchived)`, `(plantId)`. **Sensitive:** report text, telemetry, image/owner context, free-form JSON. Current archives derive `diagnosisError` from null/blank report text; that flag and the transient provider error code/message are **not columns**. Existing archive route filters direct `userId`, so older null-owner rows can be missed. Proposed admin user totals should scope analyses through `plant.userId` to include those legacy rows.

### 2.9 CareTask

| Field | Prisma type / nullable | Default / constraint / relation |
| --- | --- | --- |
| id | String, required | PK, `uuid()` |
| plantId | String, required | FK → Plant.id |
| plant | Plant, required | `plantId`; delete Plant → Cascade |
| userId | String, required | FK → User.id |
| user | User, required | `userId`; delete User → Cascade |
| analysisId | String? | FK → AIAnalysis.id |
| analysis | AIAnalysis? | `analysisId`; delete analysis → SetNull |
| title | String, required | — |
| taskType | String, required | `"WATERING"` |
| description | String? | — |
| status | String, required | `"PENDING"` |
| urgency | String, required | `"routine"` |
| dueDate | DateTime, required | — |
| completedAt | DateTime? | — |
| createdAt | DateTime, required | `now()` |
| updatedAt | DateTime, required | `@updatedAt` |

Indexes: `(userId, status, dueDate)`, `(plantId)`. Runtime task types: `WATERING`, `FERTILIZING`, `PRUNING`, `REPOTTING`, `PEST_CONTROL`, `LIGHT_ADJUSTMENT`, `OTHER`. Status: `PENDING`, `COMPLETED`, `SKIPPED`. Urgency: `routine`, `immediate`, `urgent`. These are strings, not PostgreSQL enums. **Sensitive:** owner and potentially free-form descriptions. Existing undo/skip updates do not clear a previous `completedAt` because they write `undefined`; use `status` as the current completion truth.

### 2.10 Migration and cross-database caveats

The committed baseline migration creates User/Device/Plant/cache/identification/analysis; the auth migration adds `isActive`, sessions, and refresh tokens. They do **not** fully describe current `CareTask` and newer `AIAnalysis` fields. The package exposes `db:push:pg`, but repository presence does not prove how production was synchronized. Before adding admin tables, inspect migration state and verify the actual production schema through the authorized operator workflow; do not assume applying only these two migrations reproduces the current schema. Use reviewed migrations for new admin changes, with backups and a staging rehearsal.

PostgreSQL cascades do not remove Mongo readings, Cloudinary assets, or frontend local state. Deleting a Plant leaves its owned Device and historical Mongo readings. There is no distributed transaction spanning PostgreSQL and MongoDB; demo seeding and telemetry ingestion perform cross-database operations with possible partial failure.

## 3. Data Models — MongoDB Atlas

### 3.1 Database and collection

The backend uses the database path in **`DATABASE_URL`**. The inspected local configuration names the database **`Cluster0`**; this is the URL's database path, not proof of the Atlas cluster's name or the Render database selection. Production database name must be confirmed from Render's configured connection string without copying credentials into the handoff. `MONGODB_DB`/`MONGODB_URI` are present locally but unused by this backend and do not override Prisma's database selection.

The only collection declared and accessed by the application is **`sensorReadings`**, mapped from Prisma `SensorReading`. Atlas/system collections or collections written by other applications were not inspected. Do not confuse this collection with PostgreSQL device inventory.

### 3.2 Full implemented document schema and requested compatibility fields

| Raw BSON field | Prisma field/type | Required / behavior |
| --- | --- | --- |
| `_id` | `id: String` with ObjectId mapping | Required; Mongo-generated ObjectId; HTTP serializes string `id` |
| `deviceId` | `deviceId: String` | Required; physical MAC or demo UUID |
| `temperature` | `temperature: Float` | Required; °C |
| `humidity` | `humidity: Float` | Required; relative humidity % |
| `soilMoisture` | `soilMoisture: Float?` | Nullable/may be absent historically; physical writes null, demo percentage |
| `soilMoistureRaw` | `soilMoistureRaw: Int?` | Nullable/may be absent; physical uncalibrated 12-bit ADC |
| `lightLux` | `lightLux: Float?` | Nullable/may be absent; canonical physical lux |
| `lightLevel` | `lightLevel: Float?` | Nullable/may be absent; legacy physical alias or demo lux |
| `deviceTimestamp` | `timestamp: DateTime`, `@map("deviceTimestamp")` | Required BSON Date; default now |
| `receivedAt` | **No current Prisma field** | Not written by this backend; cannot be assumed present |
| `source` | **No current Prisma field** | Not written by this backend; derive source from joined Device |

Illustrative physical raw document (Extended JSON for BSON types):

```json
{
  "_id": { "$oid": "650000000000000000000001" },
  "deviceId": "LC-A50528",
  "temperature": 27.4,
  "humidity": 63.2,
  "soilMoisture": null,
  "soilMoistureRaw": 2280,
  "lightLux": 850.5,
  "deviceTimestamp": { "$date": "2026-10-12T08:40:00.000Z" }
}
```

`lightLevel` may be null/absent on that physical document. Neither `receivedAt` nor `source` belongs in an example presented as an existing stored field. If SuperAdmin's direct Mongo reader expects them, it must tolerate absence and label the source as **derived**, or those fields must be added in a separately approved backend/firmware change. Unknown external writers may have extra fields; that is not evidence that this backend fills them.

### 3.3 Identity, timing, and metric normalization

1. PostgreSQL `Device.id` and `Plant.deviceId` are relational UUID strings. Physical Mongo `deviceId` stores **`Device.macAddress`**, e.g. **`LC-A50528`**, not that UUID. Current read routes take a UUID path parameter, authorize that Device, then translate to the Mongo key.
2. Demo Device: deterministic UUID derived from `leafcheck-demo:<plantId>`; PostgreSQL MAC is `DEMO:<plantId>`; Mongo `deviceId` is **Device.id**. Demo records are seeded only by the authenticated owner-scoped endpoint. Raw UUID shape alone is not a reliable classification of arbitrary historical data.
3. Physical identifiers accepted are `LC-` plus six hex characters, six colon-separated hex octets, or six hyphen-separated octets, case-insensitive. Claim/ingest uppercase the identifier, but do not canonicalize colon versus hyphen formats; do not silently treat different registered strings as identical.
4. The raw timestamp field is **`deviceTimestamp`**, while Prisma calls it **`timestamp`**. Current firmware supplies no timestamp; the backend writes `new Date()` on receipt. Thus the misleading raw name is currently server-authoritative ingestion time, not an ESP32 clock. Demo readings have generated historical timestamps. There is no separate transport-latency measurement.
5. Physical soil values are ADC, not percentages: read `soilMoistureRaw`, with legacy `soilMoisture` fallback interpreted as raw ADC. Normalized physical percentage is null and moisture status `unavailable`. Do not infer watering need from uncalibrated ADC or display e.g. 2280%.
6. Physical lux: `lightLux ?? lightLevel ?? null`; demo lux: `lightLevel ?? null`. Zero lux is valid; missing data remains null, not zero. Temperature and humidity are finite numeric measurements, not pH or Fahrenheit.
7. Freshness used by current app/backend helpers: valid timestamp, no more than 30 minutes old, and no more than 1 minute in the future. Backend read APIs still return stale readings; current display code classifies them as delayed. Mongo failure and no readings are different conditions.
8. Join an owned/all-account Device first, then look up its appropriate Mongo key. Mongo-only reads cannot establish owner, account activation, pairing, or whitelist authorization. Orphan readings and older physical UUID-keyed rows need an explicit reconciliation/backfill plan; current physical readers do not fallback to UUID.

For optional future ingestion fields, add nullable `receivedAt: DateTime?` and an explicit source value, and validate a device-origin timestamp separately before using it. Define a versioned payload and migration/backfill strategy first; today's validator rejects `receivedAt`, `source`, and `deviceTimestamp` in POST bodies.

### 3.4 Saved diagnosis telemetry snapshot

`AIAnalysis.telemetrySnapshot` is PostgreSQL JSON, independent of subsequent pairing/telemetry. New scans save this exact conceptual shape or null:

```ts
type DiagnosisTelemetrySnapshot = {
  deviceId: string;             // Mongo key: physical MAC or demo UUID
  timestamp: string;            // ISO UTC of reading
  capturedAt?: string;          // ISO UTC when diagnosis inputs were assembled
  simulated?: boolean;         // explicit on newly saved snapshots
  temperature: number;
  humidity: number;
  soilMoisture: number | null;
  soilMoistureRaw: number | null;
  lightLux: number | null;
};
```

Archive serialization normalizes historical snapshots, accepts legacy `lightLevel`, and checks identifiers/finite values. New-scan response also includes `telemetry`, whose scalar lux key is `lightLevel`; do not confuse that with the normalized read API's `lightLevel: { lux, status }`.

### 3.5 Index and retention caveat

Declared index is `(deviceId, timestamp DESC)` in Prisma, physically `(deviceId, deviceTimestamp DESC)`. Confirm actual Atlas indexes were synchronized; a declared schema index is not deployment proof.

`MONGO_TELEMETRY_RETENTION_DAYS` controls `backend/src/lib/ttl.ts`. Positive values attempt a TTL index named `ttl_telemetry_retention`, but the raw command currently targets **`timestamp`**, not mapped **`deviceTimestamp`**. This does not expire normal documents lacking a raw `timestamp`. Unset/non-positive values only skip index creation; they do not remove a previously existing TTL index. Index-option conflicts are logged as already existing without reconciling duration. Inspect actual Atlas indexes and effective retention before promising historical coverage. This handoff does not change any index.

## 4. Authentication & Authorization

### 4.1 Token and password lifecycle

| Item | Existing behavior |
| --- | --- |
| Password storage | Argon2id (`hash-wasm`), version 19; 65,536 KiB memory, 3 iterations, parallelism 1, 32-byte hash, random 16-byte salt |
| Password verification | Bounded stored parameters; timing-safe comparison; dummy full KDF for missing/invalid account hash |
| Access token | `jose` HS256 JWT, `typ: JWT`, claims `sub` (User.id), `sid` (AuthSession.id), `iss`, `aud`, `iat`, `exp` |
| Access lifetime | Hard-coded 15 minutes; response `expiresIn: 900` seconds |
| Refresh token | Random 32 bytes, 43-character base64url opaque string; only SHA-256 hex hash stored |
| Session lifetime | Hard-coded 30 days from session creation; absolute expiry is not extended by refresh |
| Refresh rotation | Single-use consumption in PG transaction, row lock, replacement token; replay revokes the session |
| Revocation | Every protected request reads session/User; revoked, expired, inactive, or mismatched user → 401 |
| User identity | Current database user in `res.locals.auth.user`, session ID in `res.locals.auth.sessionId` |
| Role freshness | No role claim in JWT; current role comes from database on protected requests |

Registration always sets `USER`. Supplying `role`, `isAdmin`, or `userId` is rejected as an unexpected field. Roles do not confer cross-account permissions anywhere currently. There is no admin-only middleware, MFA, operator invitation, or role-management API. There is already a backend logout-all endpoint even though mobile account-lifecycle UI may defer that feature.

Native refresh uses SecureStore; browser access tokens remain in memory and refresh uses the secure cookie. **Implementation discrepancy:** the native session coordinator also currently mirrors the access token to SecureStore key `access_token` (`frontend/services/access-token-storage.native.ts`), despite the project's intended memory-only access-token rule. The admin implementation should keep upstream tokens server-side and not copy this persistence choice into browser storage.

### 4.2 Required auth configuration

- `AUTH_JWT_SECRET`: mandatory randomly generated base64url string, at least 43 characters and at least 16 distinct characters. The backend uses its UTF-8 bytes as the HMAC key; it does not base64-decode it.
- `AUTH_JWT_ISSUER`, `AUTH_JWT_AUDIENCE`: mandatory, each at most 200 characters.
- `AUTH_ALLOWED_ORIGINS`: optional comma-separated **exact HTTPS origins**, without paths or trailing slash. No whitespace trimming; omit spaces around commas. Empty means browser-origin requests are not authorized, while correctly marked originless native requests can work.
- `AUTH_HASH_WORKERS`, `AUTH_HASH_QUEUE_LIMIT`: optional KDF resource controls. Details in section 7.

Token TTLs, cookie name, and hash parameters are not configurable by additional TTL environment variables in current code. Do not assume common variables like `JWT_SECRET` or `REFRESH_TOKEN_SECRET` are read.

### 4.3 Accepted transports

**Every protected resource:** `Authorization: Bearer <access JWT>`, exact Bearer format, token at most 2048 characters. A refresh cookie alone cannot authenticate resource routes. No API key authentication exists for admin or account APIs.

**Native/server-to-server `/api/auth/*`:** send `Content-Type: application/json` and `X-Auth-Client: native`. Do not include `Origin`, `Cookie`, or `Sec-Fetch-Site`: any of those forces browser mode. Login/register return access token, refresh token, expiry, safe user. Refresh sends `{ "refreshToken": "<opaque-token>" }` and receives a new pair.

**Browser `/api/auth/*`:** exact allowed `Origin`, `X-CSRF-Protection: 1`, credentialed requests. These checks apply to register/login/refresh/logout/logout-all, not just refresh. Browser responses omit refresh token JSON and set:

```text
__Host-leafcheck-refresh
HttpOnly; Secure; SameSite=Strict; Path=/; no Domain
Max-Age: 30 days
```

Browser refresh body is `{}` and requires exactly one named refresh cookie. Cookie max-age is renewed, but the database session's original 30-day expiry still wins. All auth/protected responses set `Cache-Control: no-store`.

### 4.4 Recommended SuperAdmin connection pattern

Use the SuperAdmin Express backend as a **BFF (backend for frontend)**. Authenticate an actual PostgreSQL operator through the upstream native/server transport, verify `GET /api/users/me`, and use the returned operator's upstream token on new admin routes. The BFF owns upstream credentials, serializes refresh per operator session, and gives the browser its own secure HttpOnly session cookie with CSRF protection. Do not forward browser Origin/Cookie/Sec-Fetch headers upstream when using native auth mode. Encrypt persisted upstream refresh credentials; never expose them through Vite public environment variables, localStorage, browser logs, or SQLite exports.

Serialize refresh: two simultaneous requests using the same refresh token can trigger replay revocation. Refresh once on a 401, retry once, and clear the session if still unauthorized. Do not automatically retry an ambiguously timed-out refresh with the same token; the server may have already consumed it. Preserve the new refresh token before releasing waiting requests.

An unrelated admin domain and `leafcheck-ai.onrender.com` are cross-site. CORS approval alone does not make `SameSite=Strict` refresh cookies travel cross-site. A direct-browser design therefore needs a separately reviewed same-site deployment or cookie/CSRF redesign. The BFF avoids requiring browser cookies to the LeafCheck domain, although its own browser endpoints still require authentication and CSRF defenses.

### 4.5 Admin role gate and bootstrap proposal

**No User schema change is needed:** `role` and `isActive` already exist. Proposed `requireAdmin` runs `requireAuth`, then allows active roles `ADMIN` and `LEAD_DEV`, else `403 ADMIN_REQUIRED`. Do not trust a role supplied by the client, SQLite, or a decoded-but-unverified JWT. Existing owner-scoped routes remain unchanged.

Proposed first-release policy: both operator roles may read section-6 endpoints. `LEAD_DEV` controls future role assignment/operator provisioning; such writes are outside the seven proposed read endpoints. Bootstrap the first operator through a controlled, audited Prisma-based maintenance procedure against an existing verified user; never add a public registration role parameter. Require MFA before expanding destructive admin actions.

A separate admin JWT audience/signing key and shorter operator sessions can be added later, but need new issuance/verification paths. Changing the existing `AUTH_JWT_AUDIENCE` globally would invalidate mobile tokens; a new admin audience cannot be enabled solely by changing that variable.

## 5. Complete Existing API Endpoint Inventory

**27 distinct method/path contracts:** 26 across seven `backend/src/routes/*.ts` files plus `/health`. Repeated middleware/handler registrations for the same method/path are one endpoint. All paths below include server mounts. There are currently **zero admin-only endpoints**. Non-auth queries are generally not exhaustively validated; only documented query keys affect behavior. Bodies validated with `bodyObject` reject unknown keys.

### 5.1 Shared response contracts

These notation definitions specify existing payload shapes; optional `?` properties are omitted when nullish by a serializer, while `| null` is explicit null. JSON dates are ISO UTC strings. JSON columns may contain arbitrary JSON values, not guaranteed provider schemas.

```ts
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type HealthStatus = "healthy" | "warning" | "critical" | "unknown";
type TaskStatus = "PENDING" | "COMPLETED" | "SKIPPED";

type SafeUser = {
  id: string; email: string; name: string | null;
  role: "USER" | "ADMIN" | "LEAD_DEV";
  createdAt: string; updatedAt: string;
}; // Does NOT include password or isActive.

type Tokens = { accessToken: string; expiresIn: 900; refreshToken?: string };
// refreshToken exists only for native mode. Login/register add user: SafeUser.

type DeviceDTO = {
  id: string; name: string; macAddress: string; userId: string;
  status: string; createdAt: string; updatedAt: string;
};
type PlantDTO = {
  id: string; name: string; species: string; deviceId?: string;
  simulated: boolean; location?: string; imageUrl?: string;
  minMoisture: number; maxMoisture: number; healthStatus: HealthStatus;
  lastScannedAt?: string; createdAt: string; updatedAt: string;
}; // No userId; simulated is derived from deterministic demo ID, not a PG column.

type TelemetryPayload = {
  deviceId: string; // PostgreSQL UUID, unlike raw Mongo/diagnosis snapshot keys
  timestamp: string;
  soilMoisture: {
    percentage: number | null; rawAnalogValue: number | null;
    status: "optimal" | "dry" | "overwatered" | "unavailable";
  };
  lightLevel: { lux: number | null; status: "insufficient" | "optimal" | "excessive" | "unavailable" };
  environment: { temperatureCelsius: number; humidityPercentage: number };
};
type PlantMini = { id: string; name: string; species: string };
type CareTaskRecord = {
  id: string; plantId: string; userId: string; analysisId: string | null;
  title: string; taskType: string; description: string | null;
  status: string; urgency: string; dueDate: string; completedAt: string | null;
  createdAt: string; updatedAt: string;
};
type AnalysisRecord = {
  id: string; plantId: string; userId: string | null; healthStatus: string;
  diagnoses: JsonValue; recommendations: JsonValue; rawAnalysisText: string | null;
  speciesName: string | null; telemetrySnapshot: DiagnosisTelemetrySnapshot | null;
  idealSpecs: JsonValue; notificationTime: string | null; notificationReason: string | null;
  isArchived: boolean; archivedAt: string | null; createdAt: string;
};
type SensorOverviewEntry = {
  device: DeviceDTO; plants: { id: string; name: string }[];
  demo: boolean; readingError: boolean; telemetry: TelemetryPayload | null;
};
```

Physical normalized moisture status is always `unavailable`. Demo percentage uses plant thresholds (default 30/80). Light status is `insufficient` below 500 lux, `excessive` above 50,000 lux, otherwise `optimal`; missing lux yields `unavailable`. These are display heuristics, not species-specific scientific limits.

### 5.2 Health — `backend/src/server.ts`

| Method/path | Auth | Request | Success response | Purpose |
| --- | --- | --- | --- | --- |
| GET `/health` | Public | No body/query | 200 `{status:"ok", service:"leaf-check-ai-backend", timestamp:ISO}` | Process liveness; does not query databases/providers. |

### 5.3 Authentication — `backend/src/routes/auth.ts`

All five paths require the native/browser transport rules in section 4.3; "public" means no access JWT, not bypassing Origin/CSRF/client-mode validation.

| Method/path | Auth | Request body/query | Success response | Purpose |
| --- | --- | --- | --- | --- |
| POST `/api/auth/register` | Public + client-mode checks | `{email:string,password:string,name?:string\|null}`; no query | 201 `Tokens & {user:SafeUser}`; browser refresh cookie | Create normal USER and session. |
| POST `/api/auth/login` | Public + client-mode checks | `{email:string,password:string}`; no query | 200 `Tokens & {user:SafeUser}`; browser refresh cookie | Verify active account and create session. |
| POST `/api/auth/refresh` | Refresh credential + client-mode checks | Native `{refreshToken:string}`; browser `{}` + cookie; no query | 200 `Tokens`; browser replacement cookie; no user object | Rotate single-use refresh token within original session. |
| POST `/api/auth/logout` | User JWT + client-mode checks | `{}` (omitted body accepted); no query | 204, no JSON; clear refresh cookie | Revoke current session. |
| POST `/api/auth/logout-all` | User JWT + client-mode checks | `{}` (omitted body accepted); no query | 204, no JSON; clear refresh cookie | Revoke all current user's non-revoked sessions. |

Email: string ≤254 characters before normalization, valid basic email regex, trim/lowercase. Password: 8–128 Unicode code points. Optional registration name: null/omitted allowed; otherwise nonblank trimmed name, original string length ≤100. Unknown keys rejected. Refresh token must be 43 base64url characters. Errors include `400 INVALID_INPUT`, `409 EMAIL_CONFLICT`, `401 INVALID_CREDENTIALS`/`INVALID_SESSION`, `403 ORIGIN_REJECTED`, `503 AUTH_BUSY`, and auth limiter 429.

### 5.4 Users — `backend/src/routes/users.ts`

| Method/path | Auth | Request body/query | Success response | Purpose |
| --- | --- | --- | --- | --- |
| GET `/api/users/me` | User JWT | None | 200 `SafeUser` | Return current verified user identity/role. |
| PATCH `/api/users/me` | User JWT | `{name:string\|null}`; key required, non-null same validation as registration | 200 `SafeUser` | Change/clear own display name. |

No list-all-users, user-by-ID, email/password change, activation, role assignment, or deletion endpoint exists.

### 5.5 Plants — `backend/src/routes/plants.ts`

Each `:id` is an owned Plant UUID; invalid syntax → 400, missing/foreign owner → 404. Ownership is both prechecked and scoped on mutations.

| Method/path | Auth | Request body/query | Success response | Purpose |
| --- | --- | --- | --- | --- |
| POST `/api/plants` | User JWT | CreatePlantInput below | 201 `PlantDTO` | Create owned manual plant with `unknown` health. |
| GET `/api/plants` | User JWT | None; no pagination/filter contract | 200 `PlantDTO[]`, ordered updatedAt descending | List own plants. |
| GET `/api/plants/:id` | User JWT + owner | No body/query | 200 `PlantDTO` | Get own plant. |
| PATCH `/api/plants/:id` | User JWT + owner | Partial CreatePlantInput; ≥1 field | 200 `PlantDTO` | Edit own plant metadata/moisture thresholds. |
| DELETE `/api/plants/:id` | User JWT + owner | None | 204, no JSON | Delete plant and PG dependent records. |
| PATCH `/api/plants/:id/health` | User JWT + owner | `{healthStatus:"healthy"\|"warning"\|"critical"\|"unknown"}` | 200 `{id,healthStatus}` | Set saved health and lastScannedAt. |
| PATCH `/api/plants/:id/pair-device` | User JWT + plant/device owner | `{deviceId:UUID\|null}` | 200 `PlantDTO` | Pair/reassign owned Device, or unlink with null. |
| GET `/api/plants/:id/telemetry` | User JWT + plant/device owner | None | 200 `{paired:false,device:null,telemetry:null}` OR `{paired:true,device:DeviceDTO,telemetry:TelemetryPayload\|null}` | Fetch pairing and latest reading, including no-reading state. |
| POST `/api/plants/:id/seed-telemetry` | User JWT + owner | Body ignored; send `{}`; no query | 200 `PlantDTO` with demo device association | Replace demo history and link virtual device. |

`CreatePlantInput`: required nonblank trimmed `name` ≤100, `species` ≤200; optional `location` ≤100, `imageUrl` ≤2048, `minMoisture`/`maxMoisture` finite numbers 0–100. URL must be HTTP/HTTPS without embedded credentials; empty optional strings are accepted. PATCH does not accept null to clear these strings; use empty string where supported. No `minMoisture <= maxMoisture` cross-check. `deviceId`, `userId`, `healthStatus`, and all other body keys are rejected here.

Pairing uses serializable PG transaction with up to three conflict attempts; conflict → `409 PAIRING_CONFLICT`. Seed uses deterministic demo Device, creates 193 historical 15-minute samples over 48 hours using UTC+8 patterns, and rejects an existing physical pairing (`409 HARDWARE_LINKED`) or conflicting ownership. Seed's cross-DB work is not atomic. No Device deletion/unclaim endpoint exists; unpairing clears `Plant.deviceId`, not the Device ownership.

### 5.6 Devices — `backend/src/routes/devices.ts`

| Method/path | Auth | Request body/query | Success response | Purpose |
| --- | --- | --- | --- | --- |
| GET `/api/devices/overview` | User JWT | None; no pagination | 200 `SensorOverviewEntry[]`, device name then ID ascending | List all owned devices, including unlinked and demo, with latest telemetry. |
| POST `/api/devices/claim` | User JWT | `{macAddress:string,name?:string}` | 201 new `DeviceDTO`, or 200 already-owned/reclaimed `DeviceDTO` | Register/claim device identifier for current user. |

Claim MAC formats are in section 3.3; uppercase stored, no leading/trailing whitespace normalization. Optional name: nonempty after trim, ≤100 trimmed characters; default name is MAC. Unknown body fields rejected. Another owner's registered MAC → `409 DEVICE_ALREADY_CLAIMED`; unique MAC constraint resolves races. There is no hardware challenge, HMAC, provisioning approval, or physical-possession check.

Overview queries `Device where userId` with `plants where userId`, then queries Mongo in batches of four. No readings yields `telemetry:null,readingError:false`; Mongo/serialization failure yields `telemetry:null,readingError:true` for that row, while other devices still load. PG inventory failure fails the endpoint. It returns stored `status`, not a computed online/offline state. Existing diagnostics log safe stage/code/model/column information without DB URLs or credential-bearing messages.

### 5.7 Telemetry — `backend/src/routes/telemetry.ts`

| Method/path | Auth | Request body/query | Success response | Purpose |
| --- | --- | --- | --- | --- |
| POST `/api/telemetry` | **Public**, registered physical MAC check | HardwareTelemetryInput below | 201 raw Prisma SensorReading JSON below | Store physical sample under MAC with server time. |
| GET `/api/telemetry/:deviceId/latest` | User JWT + owned Device **UUID** | No query/body | 200 `TelemetryPayload`; 404 if no reading | Return latest own device measurement. |
| GET `/api/telemetry/:deviceId/history` | User JWT + owned Device **UUID** | `limit` default50 clamped1–200; `offset` default0 clamped≥0 | 200 HistoryResponse below | Paginate own device measurements newest-first. |

```ts
type HardwareTelemetryInput = {
  deviceId: string;             // REGISTERED physical printed identifier, not UUID
  temperature: number;         // finite, -40..125 °C
  humidity: number;            // finite, 0..100 %RH
  soilMoisture: number;        // required legacy raw ADC field, 0..4095
  soilMoistureRaw?: number | null; // optional integer ADC, 0..4095
  lightLux?: number;           // finite, >=0
  lightLevel?: number;         // accepted legacy alias, finite, >=0
}; // Require >=1 lux alias; both provided must agree; unknown keys rejected.

type StoredReadingResponse = {
  id: string; deviceId: string; temperature: number; humidity: number;
  soilMoisture: number | null; soilMoistureRaw: number | null;
  lightLevel: number | null; lightLux: number | null; timestamp: string;
}; // Prisma field names, NOT raw BSON _id/deviceTimestamp.

type HistoryResponse = {
  data: {
    id: string; deviceId: string; timestamp: string; temperature: number; humidity: number;
    soilMoisture: number | null; soilMoistureRaw: number | null; lightLevel: number | null;
  }[];
  pagination: { total: number; limit: number; offset: number; hasMore: boolean };
}; // deviceId is PG UUID; lightLevel is normalized scalar lux, not object.
```

`soilMoisture` must be an integer unless numeric `soilMoistureRaw` is supplied; the raw field wins on ingestion. Both are still range-validated. Current firmware sends both equal raw ADC values and `lightLux`. Ingestion verifies Device existence only, not owner activation, Device.status, or an approved flag; no JWT or secret is checked. Unknown MAC → 404; malformed body → 400 `{error,details:string[]}`; virtual hardware ingestion prohibited. History's parsing is loose (`parseInt`, invalid/zero values default), not strict query-schema validation. No date-range query contract.

### 5.8 Scanner/archives/tasks — `backend/src/routes/scan.ts`

**All four endpoints share the `/api/scan` 10-per-15-minute IP limiter, including archive/task reads and task updates.** This makes them unsuitable for continuous admin polling.

| Method/path | Auth | Request body/query | Success response | Purpose |
| --- | --- | --- | --- | --- |
| POST `/api/scan` | User JWT; owned supplied plant/device | ScanInput below | 201 SavedScanResponse; nonliving 200 NonlivingScanResponse | Identify/diagnose/save living plant, or retry saved-photo diagnosis. |
| GET `/api/scan/archives` | User JWT; owned optional plant | `plantId?:UUID`, `days?:"7"\|"30"`; no other supported filters | 200 `(AnalysisRecord & {plant:PlantMini,diagnosisError:boolean})[]` | Return current user's up to 50 archived analyses newest-first. |
| GET `/api/scan/tasks` | User JWT; owned optional plant | `plantId?:UUID`; no status/date/pagination filters | 200 `(CareTaskRecord & {plant:PlantMini})[]`, max50 | Return own tasks, status ascending then dueDate ascending. |
| PATCH `/api/scan/tasks/:id` | User JWT + task owner | `{status:"PENDING"\|"COMPLETED"\|"SKIPPED"}` | 200 `CareTaskRecord`, without nested plant | Update own task completion/skip state. |

Archive days filter uses `createdAt >= now - N days`. Arrays are truncated at 50, not fully paginated. Archive ownership currently filters `AIAnalysis.userId`. Task ID is owner-filtered but lacks the UUID-format precheck used on plant/device routes. CompletedAt is set on COMPLETED and left unchanged on PENDING/SKIPPED.

```ts
type ScanInput = {
  imageBase64?: string; reusePreviousImage?: boolean;
  plantId?: string; deviceId?: string; location?: string;
};
// Fresh photo requires canonical raw JPEG base64; no data: prefix, <=7 MiB decoded.
// reusePreviousImage:true requires owned plantId and ignores supplied imageBase64.
// Supplied deviceId is PG UUID; for existing plant it must equal actual pairing.
// location is trimmed, <=100 chars, used on NEW plant creation only.

type CareTaskOutput = {
  title: string; taskType: string; description: string;
  urgency: "routine" | "immediate" | "urgent"; dueDate: string;
}; // Scan response task outputs intentionally omit persisted IDs.

type SavedScanResponse = {
  success: true; subjectKind: "living_plant";
  photoSaveFailed: boolean; diagnosisError: boolean;
  diagnosisMessage?: string; diagnosisCode?: string;
  plant: { id: string; name: string; species: string; deviceId: string | null };
  identification: { speciesName: string; commonName: string | null; confidence: number };
  diagnostic: {
    id: string; healthStatus: string; rawAnalysisText: string | null;
    telemetryFreshness: string; createdAt: string;
  };
  telemetry: {
    temperature: number; humidity: number; soilMoisture: number | null;
    soilMoistureRaw: number | null; lightLevel: number | null; timestamp: string;
  } | null;
  telemetrySnapshot: DiagnosisTelemetrySnapshot | null;
  careTasks: CareTaskOutput[];
  notification: { notifyAt: string; reason: string } | null;
};
type NonlivingScanResponse = {
  success: true; subjectKind: "artificial_plant" | "non_plant";
  plant: null; identification: null;
  diagnostic: { id: string; healthStatus: "unknown"; rawAnalysisText: string; telemetryFreshness: string };
  telemetry: null; careTasks: []; notification: null;
}; // No telemetrySnapshot/createdAt/diagnosisError/photoSaveFailed here.
```

Saved-photo reuse only loads saved JPEG data URLs or HTTPS `res.cloudinary.com` delivery URLs, with no credentials/port/redirect, bounded to 8 seconds and 7 MiB. An arbitrary manual HTTP image URL cannot be reused. Errors include `NO_SAVED_IMAGE`, `SAVED_IMAGE_UNAVAILABLE`, `INVALID_IMAGE`, `IMAGE_TOO_LARGE`, `SCAN_AI_CONFIGURATION`, `SCAN_AI_BUSY`, `SCAN_AI_UNAVAILABLE`, `SCAN_FAILED`. Diagnosis-stage failures are sanitized/logged with full stack plus stage/status, but are surfaced as successful-save flags; monitor must distinguish those application-level failures from HTTP 5xx.

### 5.9 Standalone AI — `backend/src/routes/ai.ts`

| Method/path | Auth | Request body/query | Success response | Purpose |
| --- | --- | --- | --- | --- |
| POST `/api/ai/analyze` | User JWT; owned optional plantId | `{imageBase64?:JPEG-base64,telemetry?:TelemetryPayload,plantId?:UUID,notes?:string}`; notes ≤2000 | 200 AIAnalyzeResponse below | Generate unsaved foliar advice from client-supplied image/telemetry/notes. |

All four body fields are optional, so `{}` is accepted. If telemetry is supplied, its soil object/finite percentage-or-null/status are validated; light and environment are optional. Raw ADC, telemetry deviceId/timestamp, range checks, and telemetry-to-plant ownership matching are not fully validated. The backend does **not** fetch Mongo readings here. Treat this endpoint's supplied telemetry as unverified client input; do not use it as the admin diagnosis retry path. No database report/task/health write occurs.

```ts
type AIAnalyzeResponse = {
  success: true; healthStatus: "healthy" | "warning" | "critical";
  diagnoses: {
    diseaseName: "Gemini AI Foliar Analysis"; confidence: 0.9;
    severity: "low" | "moderate" | "high";
    symptoms: ["Visual inspection completed by Gemini AI"]; description: string;
  }[];
  recommendations: {
    action: "Review AI Diagnosis Report"; urgency: "routine" | "immediate" | "urgent"; details: string;
  }[];
  rawAnalysisText: string; timestamp: string;
};
```

Health is inferred heuristically from provider text (critical first, then warning/concern/disease), not a validated structured report. Provider failures use HTTP 502/503 and `{success:false,healthStatus:"unknown",diagnoses:[],recommendations:[],timestamp,error,code}`. Input validation errors use the shared `{error,code}` format.

### 5.10 Error, absence, and integration handling

Common middleware errors: `{error:string,code:string}` for HttpError; invalid JSON `400 INVALID_JSON`; large body `413 BODY_TOO_LARGE`; unexpected error `500 INTERNAL_ERROR`. Some legacy route catches return only `{error}`. Ingestion validation includes `details`. Scan pipeline failures add `success:false`. Rate-limit responses are in section 9. There is no universal `data` envelope today.

Handle 204 without parsing JSON. Treat absent optional keys separately from null. A missing reading is not a lost device, and partial overview `readingError:true` is not successful telemetry. Unknown routes → `404 {error:"Route not found"}`. Current user routes do not accept admin impersonation or another user's ID query to bypass scope.

## 6. Proposed New Admin Endpoints — NOT IMPLEMENTED

Implement this namespace in the **LeafCheck backend**, then adapt the SuperAdmin Express service to consume it. All seven endpoints below are read-only in the initial scope; whitelist/role/deactivation/unpairing writes are separate future contracts, not implied by the list APIs. Existing customer tokens/owner scopes stay unchanged.

### 6.1 Common exact contract and policy

- Mount `/api/admin` behind `requireAuth` → proposed `requireAdmin` (`ADMIN` or `LEAD_DEV`). Set `Cache-Control: no-store`. Authenticated `USER` → 403; invalid/expired session → 401. BFF must not map these to a generic disconnected state.
- Default pagination: `page=1`, `pageSize=25`; strict decimal integer page≥1 and pageSize1–100. `skip=(page-1)*pageSize`, `take=pageSize`; empty results are 200 with `total:0,totalPages:0`. Reject unknown/repeated query parameters and invalid enum/date/UUID values with 400. Search `q` trims, max100 characters, case-insensitive contains; empty equals no search. Never log raw search text containing personal data.
- Dates are ISO UTC with offset accepted/normalized to UTC. Ranges are `[from,to)`; `from < to`. UUID IDs use the same resource validation as existing code. Stable ordering always adds ID as a tie-breaker. Count and page queries use a PostgreSQL transaction for relational consistency; PostgreSQL/Mongo combined views have no atomic cross-DB snapshot.
- List response: `{data:T[],pagination:{page,pageSize,total,totalPages},meta:{schemaVersion:1,asOf:ISO}}`. Additional documented metadata is additive. Detail/monitor: `{data:T,meta:{schemaVersion:1,asOf:ISO}}`.
- Proposed errors: `{error:string,code:string,requestId:string}` with 400 `INVALID_INPUT`, 401 `INVALID_SESSION`, 403 `ADMIN_REQUIRED`, 404 `NOT_FOUND`, 429 `RATE_LIMITED`, 503 `ADMIN_DATA_UNAVAILABLE`/`OBSERVABILITY_NOT_CONFIGURED`. Generate/return `X-Request-ID`; do not include upstream stack, DB host, credentials, or raw request body. SuperAdmin may retain `NOT_CONNECTED` for its own missing upstream configuration, but must distinguish it from upstream auth/data errors.
- Select explicit fields; never serialize Prisma User/AuthSession/RefreshToken indiscriminately. Mask email local part after the first character (`operator@example.test` → `o***@example.test`); full email is allowed only in authorized user detail. IDs/MACs are operational identifiers, not ingest secrets. All examples below use synthetic records.

### 6.2 GET `/api/admin/users`

**Params:** common `page`, `pageSize`, `q`; optional `role=USER|ADMIN|LEAD_DEV`, `isActive=true|false`; `sort=createdAt|updatedAt|name|email` default `createdAt`, `order=asc|desc` default `desc`. q matches email/name; no wildcard SQL or arbitrary sort expressions. No body.

**Exact response example:**

```json
{
  "data": [{
    "id": "00000000-0000-4000-8000-000000000001",
    "name": "Example User",
    "emailMasked": "u***@example.test",
    "role": "USER",
    "isActive": true,
    "createdAt": "2026-10-01T00:00:00.000Z",
    "updatedAt": "2026-10-12T08:40:00.000Z",
    "counts": { "plants": 11, "devices": 2, "pendingCareTasks": 5 }
  }],
  "pagination": { "page": 1, "pageSize": 25, "total": 1, "totalPages": 1 },
  "meta": { "schemaVersion": 1, "asOf": "2026-10-12T09:00:00.000Z" }
}
```

`name` may be null; all counts are integers. Password, tokens, session IDs, provider JSON, and full email are absent.

**Queries:** `prismaPg.user.findMany({where,select:{id,email,name,role,isActive,createdAt,updatedAt,_count:{select:{plants:true,devices:true,careTasks:{where:{status:"PENDING"}}}}},skip,take,orderBy})` and `.count({where})` in one transaction. Map selected email to masked value and remove original before serializing. **Schema addition:** none. Add relevant search/index optimizations only after query analysis; count all PG records, not capped customer endpoint arrays.

### 6.3 GET `/api/admin/users/:id`

**Params:** required User UUID path, no query/body. Return 404 for absent user. Always return maximum 10 recent plants, 10 devices, 10 analyses, and 10 tasks; provide total/truncated per collection. This is a summary detail contract, not an unbounded account export. Lists order `updatedAt DESC,id ASC` for plants/devices, `createdAt DESC,id ASC` for analyses, `dueDate ASC,id ASC` for tasks.

**Exact response example:**

```json
{
  "data": {
    "user": {
      "id": "00000000-0000-4000-8000-000000000001", "name": "Example User",
      "email": "user@example.test", "role": "USER", "isActive": true,
      "createdAt": "2026-10-01T00:00:00.000Z", "updatedAt": "2026-10-12T08:40:00.000Z"
    },
    "counts": {
      "plants": 1, "devices": 1, "analyses": 1,
      "careTasks": { "pending": 1, "completed": 0, "skipped": 0 },
      "sessions": { "active": 1, "revoked": 0, "expired": 0 }
    },
    "plants": {
      "items": [{ "id": "00000000-0000-4000-8000-000000000002", "name": "Snake Plant",
        "species": "Dracaena trifasciata", "location": "Balcony", "healthStatus": "warning",
        "deviceId": "00000000-0000-4000-8000-000000000003", "imageAvailable": true,
        "lastScannedAt": "2026-10-12T08:40:00.000Z", "updatedAt": "2026-10-12T08:40:00.000Z" }],
      "total": 1, "truncated": false
    },
    "devices": {
      "items": [{ "id": "00000000-0000-4000-8000-000000000003", "name": "Balcony sensor",
        "macAddress": "LC-A50528", "storedStatus": "OFFLINE", "source": "PHYSICAL",
        "updatedAt": "2026-10-01T00:00:00.000Z" }],
      "total": 1, "truncated": false
    },
    "analyses": {
      "items": [{ "id": "00000000-0000-4000-8000-000000000004", "plantId": "00000000-0000-4000-8000-000000000002",
        "healthStatus": "warning", "diagnosisError": false, "telemetrySource": "IMAGE_ONLY",
        "telemetryTimestamp": null, "createdAt": "2026-10-12T08:40:00.000Z" }],
      "total": 1, "truncated": false
    },
    "careTasks": {
      "items": [{ "id": "00000000-0000-4000-8000-000000000005", "plantId": "00000000-0000-4000-8000-000000000002",
        "title": "Check soil moisture", "status": "PENDING", "urgency": "routine",
        "dueDate": "2026-10-13T08:00:00.000Z", "completedAt": null }],
      "total": 1, "truncated": false
    }
  },
  "meta": { "schemaVersion": 1, "asOf": "2026-10-12T09:00:00.000Z" }
}
```

Nullable fields: user.name, plant.location/deviceId/lastScannedAt, analysis.telemetryTimestamp, task.completedAt. `telemetrySource` enum `PHYSICAL_FRESH|PHYSICAL_STALE|DEMO|IMAGE_ONLY` uses saved provenance and capture time, with unverified legacy provenance as IMAGE_ONLY. `source` in devices is PHYSICAL or DEMO. Session counts are disjoint: revoked if revokedAt non-null; otherwise expired if expiresAt≤asOf; otherwise active. Report body, images, session IDs, password, and token hashes are absent. Log this sensitive identity read when audit infrastructure is added.

**Queries:** `user.findUnique` with explicit identity select; owner-filtered `plant`, `device`, `careTask` queries/counts; `aIAnalysis` scope `where:{plant:{userId:id}}` to include legacy nullable owner; `authSession.count` with disjoint conditions; transaction for PG consistency. `diagnosisError` from null/blank `rawAnalysisText`; select text only for this computation, do not include it in response. **Schema addition:** none. If staff need to browse beyond the capped arrays, separately add paginated `/api/admin/users/:id/plants|analyses|tasks` contracts; do not overload this endpoint or claim those routes exist today.

### 6.4 GET `/api/admin/devices`

**Params:** common page/pageSize/q; optional `userId:UUID`, `linked=true|false`, `source=PHYSICAL|DEMO`; `sort=name|createdAt|updatedAt` default `name`; `order=asc|desc` default `asc`. q matches Device.name/macAddress and linked Plant.name. No online filter in v1: cross-DB derived-status filtering would require a globally resolved candidate set/denormalized last-seen state before pagination. Return **all owned devices**, including unlinked and inactive owners.

**Exact response example:**

```json
{
  "data": [{
    "id": "00000000-0000-4000-8000-000000000003", "name": "Balcony sensor", "macAddress": "LC-A50528",
    "owner": { "id": "00000000-0000-4000-8000-000000000001", "name": "Example User", "emailMasked": "u***@example.test", "isActive": true },
    "plants": [{ "id": "00000000-0000-4000-8000-000000000002", "name": "Snake Plant", "healthStatus": "warning" }],
    "source": "PHYSICAL", "storedStatus": "OFFLINE", "connectionStatus": "ONLINE",
    "lastReadingAt": "2026-10-12T08:59:45.000Z", "readingAgeSeconds": 15, "readingError": false,
    "telemetry": { "temperatureCelsius": 27.4, "humidityPercentage": 63.2, "soilMoisturePercentage": null, "soilMoistureRaw": 2280, "lightLux": 850.5 },
    "createdAt": "2026-10-01T00:00:00.000Z", "updatedAt": "2026-10-01T00:00:00.000Z"
  }],
  "pagination": { "page": 1, "pageSize": 25, "total": 1, "totalPages": 1 },
  "meta": { "schemaVersion": 1, "asOf": "2026-10-12T09:00:00.000Z", "freshnessWindowSeconds": 1800, "futureToleranceSeconds": 60, "telemetryDegraded": false }
}
```

Owner.name may be null; plants may be empty; telemetry, lastReadingAt, and readingAgeSeconds may be null; individual nullable telemetry metrics remain null. `readingAgeSeconds` is signed floor((asOf-readingTime)/1000), preserving future timestamps. `connectionStatus` enum: `ONLINE` for fresh physical; `OFFLINE` for stale physical; `NO_READINGS` when physical has none; `UNKNOWN` on lookup failure or unverifiable/far-future timestamp; `SIMULATED` for demo inventory when lookup succeeds, with or without samples. Lookup errors take precedence over demo label for connectionStatus; source still says DEMO. "ONLINE" means recent data, not a confirmed socket/ESP32 heartbeat.

**Queries:** `device.findMany/count` with relational owner/plant explicit selects; `plants.some`/`none` filters; prefix `DEMO:` classifies source. Join page devices to `prisma.sensorReading.findFirst({where:{deviceId:demo?device.id:device.macAddress},orderBy:{timestamp:"desc"}})` with bounded concurrency as overview already does. Per-device Mongo errors return row UNKNOWN and `meta.telemetryDegraded:true`, not whole inventory failure. PG failure returns 503. **Schema addition:** none for v1. For high-scale global online sorting/filtering, propose `Device.lastTelemetryAt:DateTime?` plus a carefully reconciled ingestion update; it is not authoritative until cross-DB partial-failure semantics are defined.

### 6.5 GET `/api/admin/devices/whitelist`

**Existing meaning:** no standalone whitelist exists. The effective ingest authorization is simply "a matching physical Device record exists." The initial endpoint must make this limitation visible rather than inventing manufacturing approval.

**Params:** common page/pageSize/q, optional `userId:UUID`; q matches Device.macAddress/name. Stable `macAddress ASC,id ASC`; no body. Exclude `macAddress startsWith "DEMO:"`. Define `/whitelist` before any future `/devices/:id` route.

**Exact response example:**

```json
{
  "data": [{
    "deviceId": "00000000-0000-4000-8000-000000000003", "macAddress": "LC-A50528", "name": "Balcony sensor",
    "ownerId": "00000000-0000-4000-8000-000000000001", "ownerIsActive": true,
    "ingestionAllowed": true, "authorizationBasis": "REGISTERED_DEVICE", "proofOfPossessionVerified": false,
    "registeredAt": "2026-10-01T00:00:00.000Z"
  }],
  "pagination": { "page": 1, "pageSize": 25, "total": 1, "totalPages": 1 },
  "meta": { "schemaVersion": 1, "asOf": "2026-10-12T09:00:00.000Z", "policy": "REGISTERED_DEVICE", "independentWhitelist": false }
}
```

**Queries:** `device.findMany/count` where `NOT:{macAddress:{startsWith:"DEMO:"}}`, optional owner/search, explicit owner activation select. Validate each stored identifier against the ingest MAC formats; a malformed legacy non-demo identifier remains visible but has `ingestionAllowed:false`. `proofOfPossessionVerified:false` means no such verification is implemented, not that a stored proof was checked. **Schema addition:** none to report current effective authorization. Valid registered devices retain `ingestionAllowed:true` even for inactive owners under today's implementation; do not imply account deactivation stops telemetry.

**Recommended later authorization model:** a separate PostgreSQL `DeviceWhitelist` enables preapproved-but-unclaimed physical hardware: `id:String @id @default(uuid())`, `macAddress:String @unique`, `state:DeviceWhitelistState` (`APPROVED|REVOKED`, default APPROVED), `approvedById:String?` and `approvedBy:User?` with SetNull, `approvedAt:DateTime @default(now())`, `revokedAt:DateTime?`, `reason:String?`, `createdAt:DateTime @default(now())`, `updatedAt:DateTime @updatedAt`. Add the inverse User relation and state index. Do not use the customer claim endpoint to autoapprove the table. Claim AND ingest must enforce approved state and device authentication; maintain existing-owner constraints. A simpler `Device.ingestionEnabled:Boolean @default(true)` supports revoking already claimed devices but cannot represent unclaimed preprovisioned hardware because Device.userId is required. Neither design exists now; v1 stays an explicitly labelled registered-device inventory until policy/migration approval.

### 6.6 GET `/api/admin/api-monitor`

No persistent request metric collection/table or structured access-log aggregator exists. Existing console diagnostics and AIAnalysis counts cannot provide reliable API request counts, latency, or provider quota. Do not manufacture zero-valued charts when instrumentation is absent.

**Params:** `from?:ISO`, `to?:ISO`, `bucketMinutes?:1|5|60` default5; require from/to together or omit both (default last60 minutes ending asOf). Maximum range24 hours; maximum1440 buckets. No body. Route groups use stable mounted templates such as `/api/plants/:id`, not URLs containing IDs/query strings. Window counts include `/api/*` requests, including denied/limited/failed requests; health checks reported separately through probes.

**Exact response example after instrumentation:**

```json
{
  "data": {
    "window": { "from": "2026-10-12T08:00:00.000Z", "to": "2026-10-12T09:00:00.000Z", "bucketMinutes": 5 },
    "coverage": { "available": true, "startedAt": "2026-10-12T00:00:00.000Z", "retentionDays": 30, "complete": true, "captureScope": "COMPLETED_RESPONSES", "droppedRecords": 0 },
    "summary": { "requestCount": 120, "successCount": 105, "redirectCount": 0, "clientErrorCount": 12, "serverErrorCount": 3, "serverErrorRate": 0.025, "averageLatencyMs": 42.5 },
    "routes": [{ "method": "GET", "route": "/api/admin/devices", "requestCount": 10, "clientErrorCount": 0, "serverErrorCount": 1, "serverErrorRate": 0.1, "averageLatencyMs": 85.2 }],
    "buckets": [{ "from": "2026-10-12T08:00:00.000Z", "to": "2026-10-12T08:05:00.000Z", "requestCount": 10, "serverErrorCount": 1, "averageLatencyMs": 31.8 }],
    "health": {
      "status": "ok", "backend": "ok", "postgres": "ok", "mongo": "ok", "checkedAt": "2026-10-12T09:00:00.000Z",
      "providers": { "gemini": "not_probed", "plantnet": "not_probed", "perenual": "not_probed" }
    }
  },
  "meta": { "schemaVersion": 1, "asOf": "2026-10-12T09:00:00.000Z" }
}
```

The example shows one bucket for brevity; the implemented response must return **every** bucket covering the requested window, including zero-count buckets. Empty bucket averageLatencyMs is null; error rates are fractions 0–1, null when requestCount=0. Averages are null for empty windows. Summary counts classify final status 2xx, 3xx, 4xx, 5xx respectively. v1 captures completed final responses only (`captureScope:"COMPLETED_RESPONSES"`); disconnected requests without a final response are outside these counts. `coverage.complete` describes retained instrumented time coverage for that scope, not network disconnect capture. `droppedRecords` is a cumulative persisted integer; conservatively set complete:false if it is nonzero until interval-specific loss accounting is available.

If requested dates predate instrumentation or retained data, `coverage.complete:false`, report the actual startedAt/retention and partial observed totals. Provider status is `not_probed`, not "healthy" based on key presence; no paid AI calls on dashboard polling. Component status enums `ok|error|timeout`; overall `ok|degraded`. Database probe errors can make health degraded while existing metric data is still returned. Missing instrumentation/table/config → 503 `OBSERVABILITY_NOT_CONFIGURED`; metric store failure → 503 `ADMIN_DATA_UNAVAILABLE`.

**Minimal schema/instrumentation proposal:**

- `ApiRequestMetric`: `id:String @id @default(uuid())`, `requestId:String`, `createdAt:DateTime @default(now())` (response completion time), `method:String`, `route:String` (template or safe sentinels for unmatched/pre-routing failures), `statusCode:Int`, `durationMs:Float`, `userId:String?` as optional scalar identifier without cascade, `diagnosisError:Boolean @default(false)` to count successful saves with AI failures separately if needed. Index `(createdAt)`, `(route,method,createdAt)`, `(requestId)`. Do not store request/response bodies, Authorization/Cookie headers, full URL/query, passwords, base64 images, raw token/session IDs, or stack traces here.
- Install timing/request-ID middleware **before** CORS, limiters, and JSON parsers; use monotonic timing and response `finish`, capture resolved route later, batch writes with a bounded queue. Record instrument start/redeploy continuity in `AdminObservabilityState` described below. Retain 30 days via scheduled PG deletion with Prisma; database memory/file logs on Render are not durable. Failed/dropped metric writes must be counted and visible in coverage metadata, not silently ignored.
- `AdminObservabilityState`: `key:String @id` (`api-metrics` or `audit-log`), `startedAt:DateTime`, `retentionDays:Int`, `droppedRecords:Int @default(0)`, `updatedAt:DateTime @updatedAt`. No User relation. Monitor coverage includes this persisted droppedRecords counter; do not label complete if writes were dropped unless interval-specific loss accounting can prove coverage. Keep known instrumentation outages visible; startedAt alone does not establish uninterrupted collection.
- Query `apiRequestMetric.aggregate` for count/average; filtered counts for 4xx/5xx; `groupBy` route/method for route totals/averages; time-bounded aggregate queries per bucket or preaggregated bucket table for scale. Do not average bucket averages to compute global average; use total durations/counts. No raw SQL required. Bounded read-only probes use PG `user.findFirst({select:{id:true}})` and Mongo `sensorReading.findFirst({select:{id:true}})` with deadlines; do not disclose returned IDs.

`diagnosisError` must be communicated by scan route to metric middleware (e.g. res.locals), not inferred from HTTP status. It does not make 201 a serverError; optionally expose a separate `diagnosisFailureCount` in a contract revision. There is no historical API traffic backfill from current tables.

### 6.7 GET `/api/admin/audit-log`

No audit table or comprehensive sensitive-action log exists. AIAnalysis is a plant report, not an admin/security audit record. Console messages cannot establish a complete actor history.

**Params:** common page/pageSize; optional `actorUserId:UUID`, `targetId:string` length1–100, `action` from the enum below, `outcome=SUCCESS|FAILURE`, `from:ISO`, `to:ISO`. No q. Date defaults last30 days ending asOf, optional one bound uses its default; max90-day window. Order `createdAt DESC,id DESC`. Out-of-retention range returns known retained records and coverage metadata, not invented history.

**Exact response example after audit logging exists:**

```json
{
  "data": [{
    "id": "00000000-0000-4000-8000-000000000006", "createdAt": "2026-10-12T08:30:00.000Z",
    "actor": { "userId": "00000000-0000-4000-8000-000000000001", "roleAtAction": "USER", "emailMasked": "u***@example.test" },
    "action": "DEVICE_PAIRED", "target": { "type": "PLANT", "id": "00000000-0000-4000-8000-000000000002" },
    "outcome": "SUCCESS", "requestId": "example-request-001",
    "metadata": { "deviceId": "00000000-0000-4000-8000-000000000003", "previousDeviceId": null }
  }],
  "pagination": { "page": 1, "pageSize": 25, "total": 1, "totalPages": 1 },
  "meta": { "schemaVersion": 1, "asOf": "2026-10-12T09:00:00.000Z", "coverageStartedAt": "2026-10-12T00:00:00.000Z", "retentionDays": 365, "complete": true }
}
```

Actor can be null for unauthenticated/system actions; actor.userId/emailMasked can be null after deletion or unknown account, while roleAtAction preserves snapshot or is null. requestId may be null for controlled maintenance actions. Metadata is allowlisted redacted JSON, not an arbitrary serialized request. Action enum proposed: `ACCOUNT_REGISTERED`, `ACCOUNT_LOGIN`, `ACCOUNT_LOGOUT`, `ACCOUNT_LOGOUT_ALL`, `ACCOUNT_NAME_UPDATED`, `ACCOUNT_STATUS_CHANGED`, `ACCOUNT_ROLE_CHANGED`, `DEVICE_CLAIMED`, `DEVICE_RENAMED`, `DEVICE_PAIRED`, `DEVICE_UNPAIRED`, `DEVICE_WHITELIST_CHANGED`, `ADMIN_USER_VIEWED`, `ADMIN_ACCESS_DENIED`. Future actions must extend the allowlist, not silently change meanings.

**Schema proposal:** `AuditLog`: `id:String @id @default(uuid())`, `createdAt:DateTime @default(now())`, `actorUserId:String?`, `actor:User? @relation(fields:[actorUserId],references:[id],onDelete:SetNull)`, `actorRole:Role?`, `actorEmailMasked:String?`, `action:AuditAction`, `targetType:String`, `targetId:String`, `outcome:AuditOutcome` (`SUCCESS|FAILURE`), `requestId:String?`, `metadata:Json?`. Add `User.auditLogs:AuditLog[]` inverse relation. Index `(createdAt,id)`, `(actorUserId,createdAt)`, `(action,createdAt)`, `(targetType,targetId,createdAt)`. Add `AdminObservabilityState` key `audit-log` for known start/retention. Proposal retention365 days requires operator policy confirmation and scheduled Prisma deletion/export.

**Queries:** `auditLog.findMany/count({where,skip,take,orderBy})`, explicit field projection, actor identity already masked at event time, map actor and target shape above. Implement logging hooks at actual auth/account/claim/pair/unpair/role/whitelist mutations; success events commit in the same PostgreSQL transaction as the sensitive change. Pairing must log every auto-detached previous plant, not just the selected plant. Failed login/denied admin actions have separate bounded sanitized event writes; never record attempted passwords or full email. Maintenance operator bootstrap must record its own action. Preserve logs after User deletion via SetNull. Missing audit infrastructure → 503 `OBSERVABILITY_NOT_CONFIGURED`; no plausible historical backfill from current associations.

### 6.8 GET `/api/admin/admins`

**Params:** common page/pageSize/q; optional `role=ADMIN|LEAD_DEV`, `isActive=true|false`; order `createdAt DESC,id ASC`. q matches email/name. No body. This lists operator identities from **PostgreSQL User**, not SuperAdmin SQLite admins.

**Exact response example:**

```json
{
  "data": [{
    "id": "00000000-0000-4000-8000-000000000007", "name": "Example Operator", "emailMasked": "o***@example.test",
    "role": "ADMIN", "isActive": true, "activeSessionCount": 1,
    "createdAt": "2026-10-01T00:00:00.000Z", "updatedAt": "2026-10-12T08:40:00.000Z"
  }],
  "pagination": { "page": 1, "pageSize": 25, "total": 1, "totalPages": 1 },
  "meta": { "schemaVersion": 1, "asOf": "2026-10-12T09:00:00.000Z" }
}
```

`name` may be null. **Queries:** `user.findMany/count` with `role:{in:["ADMIN","LEAD_DEV"]}`, optional narrowed role, active/search, explicit identity select; filtered relation `_count.sessions where revokedAt:null,expiresAt>asOf`. Include inactive operators unless filtered. **Schema addition:** none. SQLite may map its session to PG User.id, but must not manufacture upstream roles, rewrite operator IDs, or independently grant admin access. This read endpoint does not create/edit/deactivate operators; future lifecycle endpoints must require approved operator policy, audit, and MFA.

### 6.9 Implementation order and acceptance matrix

1. Confirm deployed PG schema and bootstrap a controlled test operator. Add/verify `requireAdmin` tests before exposing any data.
2. Implement users/detail/devices/effective whitelist/admins with explicit DTOs. No new schema needed for these first read endpoints.
3. Add reviewed observability/audit migrations and instrumentation, then enable monitor/log contracts. Before that, those two endpoints must clearly report unavailable instead of mock success.
4. Connect SuperAdmin server to the upstream auth/session/endpoint contracts; make SQLite a local session/cache concern. Preserve existing direct-Mongo history only with a documented read-only adapter and correct join rules, or prefer backend normalization.
5. Add true hardware provisioning/device authentication only after policy approval; registered-MAC lookup is not sufficient device security.

Required integration tests: no-token401; inactive/revoked/expired401; normalUSER403; ADMIN/LEAD_DEV authorized reads; role downgrade takes effect immediately; password/hash/token fields absent even in detail/errors; pagination totals/search; both MAC and demo-UUID joins; unlinked/multi-plant devices; stale/future/missing readings; partial Mongo outage; registered-device policy truth; out-of-retention monitor/audit coverage; CORS/client-mode behavior; serialized refresh/replay; successful plant-save diagnosis failure is distinct from HTTP failure. Test new tables/migrations against staging, not an application database via disposable integration runners.

## 7. Environment Variables

**Names only are listed below; no values from environment files are reproduced.** Default behavior/requirements are source descriptions, not deployed variable values. `backend/src/lib/env.ts` loads backend `.env` relative to src/dist, with `override:false`; Render environment takes precedence.

### 7.1 All backend runtime/Prisma variables

| Name | Sensitive? | Source use / requirement | Present in inspected local backend .env? | Render status |
| --- | --- | --- | --- | --- |
| DATABASE_URL | **Yes**, Mongo credentials | Required Mongo Prisma connection; database path selects DB | Yes | Unverified |
| POSTGRES_URL | **Yes**, PG credentials | Required PG Prisma runtime connection | Yes | Unverified |
| DIRECT_URL | **Yes**, PG credentials | PG direct datasource connection for tooling/migrations | Yes | Unverified |
| AUTH_JWT_SECRET | **Yes**, signing secret | Required; validated before server start | Yes | Valid setting implied by live service startup; exact config unverified |
| AUTH_JWT_ISSUER | No; security-critical | Required; validated before server start | Yes | Required setting implied by startup; value unverified |
| AUTH_JWT_AUDIENCE | No; security-critical | Required; validated before server start | Yes | Required setting implied by startup; value unverified |
| AUTH_ALLOWED_ORIGINS | No; security-critical | Optional exact HTTPS browser allowlist | No | Unverified |
| AUTH_HASH_WORKERS | No | Optional integer1–8; default min(2, available CPU parallelism) | No | Unverified |
| AUTH_HASH_QUEUE_LIMIT | No | Optional integer0–256; default32 waiting jobs | No | Unverified |
| GEMINI_API_KEY | **Yes**, provider credential | Required valid-format AI Studio key at startup; provider authorization is separate | Yes | Valid-format config implied by startup; provider permission/quota unverified |
| GEMINI_MODEL | No | Optional model override; current code default stated in section1 | No | Unverified |
| PLANTNET_API_KEY | **Yes**, provider credential | Optional identification hint; missing/failure falls back to Gemini | Yes | Unverified |
| PERENUAL_API_KEY | **Yes**, provider credential | Optional reference enrichment | Yes | Unverified |
| CLOUDINARY_CLOUD_NAME | No; account identifier | Optional image storage; used with both credentials | Yes | Unverified |
| CLOUDINARY_API_KEY | **Yes**, credential | Optional Cloudinary auth; never return it | Yes | Unverified |
| CLOUDINARY_API_SECRET | **Yes**, credential | Optional Cloudinary auth | Yes | Unverified |
| MONGO_TELEMETRY_RETENTION_DAYS | No | Optional retention setting; current TTL caveat in section3.5 | Yes | Unverified |
| PORT | No | Listen port; default3000; bind0.0.0.0 | No | Expected platform-provided; actual setting unverified |
| NODE_ENV | No | Client singleton/log behavior; hosting/runtime mode | No | Unverified |

The public health probe confirmed a running service. It does not prove values are configured in the Render dashboard specifically rather than another deployment source, the deployed commit matches this revision, database connectivity, or all optional providers. No Render control-plane access/environment export was used. **There is no verified full list of already-configured Render variables.** Operators must check LeafCheck-AI → Environment (and any attached environment groups) against this table without posting values into tickets/chat. Startup logs can establish missing/invalid required auth/Gemini config; optional providers/storage need their own checks.

### 7.2 Additional local names that are NOT consumed by this backend

| Name | Sensitive? | Evidence/meaning |
| --- | --- | --- |
| MONGODB_URI | **Yes**, connection credential | Present locally; not referenced by backend source/Prisma |
| MONGODB_DB | No | Present locally; does not select Prisma database |
| LEAFCHECK_DEVICE_API_KEY | **Yes**, unused secret | Present locally; no firmware-ingest/admin API validation uses it |
| LEAFCHECK_DEVICE_HMAC_SECRET | **Yes**, unused secret | Present locally; no HMAC verification uses it |
| TELEMETRY_DEBUG | No | Present locally; no runtime reader found |

These names may belong to another/older integration. Merely setting them in Render does not activate security or change readers. SuperAdmin must not assume these are existing upstream credentials. Their Render configuration is unknown.

### 7.3 Test/build context and frontend distinction

`POSTGRES_PASSWORD` (**sensitive**), `POSTGRES_DB` (not secret), and `LEAFCHECK_SCAN_TEST_CONTAINER` (not secret) are used/passed by disposable PostgreSQL Docker test runners/integration guards. They are not production backend configuration. The generic system environment is forwarded by scripts; forwarding does not mean every possible variable is consumed. Prisma generation/build uses the datasource names listed above. No additional backend runtime admin-secret variable exists.

`EXPO_PUBLIC_API_URL` is frontend configuration, not a backend variable. It can contain the public service URL, never secrets. Define a **new server-only** upstream URL setting in SuperAdmin as needed; it is not an existing LeafCheck backend environment variable. Never use a `VITE_*` variable for PG/Mongo credentials, upstream refresh tokens, or signing keys.

## 8. Deployment Context

### 8.1 Service and observed availability

- Backend base URL: **https://leafcheck-ai.onrender.com**.
- Render web service name: **LeafCheck-AI**, supplied by the project owner.
- Read-only probe during handoff: `GET /health` returned HTTP200 with `status:"ok"`, `service:"leaf-check-ai-backend"`, timestamp `2026-10-12T14:24:14.359Z`. This establishes liveness at that time only; no authenticated production data or control-plane settings were queried.
- Owner reports free-tier hosting. Render documents spin-down after **15 minutes without inbound traffic** and wake-up around **one minute**; the project's approximately **50-second** cold start is an expectation, not a guaranteed bound. See [Render free-service documentation](https://render.com/docs/free#spinning-down-on-idle).
- Initial admin read timeout should accommodate cold start (e.g. 90 seconds) and present "Connecting to backend…"; retry safe GETs with bounded backoff. Do not auto-repeat mutation/login/refresh requests after ambiguous timeouts. Active 15-second firmware POSTs can keep the service receiving traffic; idle behavior depends on actual traffic.
- Render filesystem is ephemeral, so console/local-file logs are not a durable audit trail and SuperAdmin SQLite requires its own durable hosting plan if authoritative local sessions/cache need persistence. [Render documents filesystem loss on restart/redeploy/spin-down](https://render.com/docs/free#local-files-lost-on-redeploy).

### 8.2 Build/start and schema deployment

Repository-supported root commands:

```bash
npm ci
npm run build --workspace=backend
npm run start --workspace=backend
```

The build generates both Prisma clients, runs TypeScript, and packages the custom PG client/password worker for `dist`; start runs `node dist/server.js`. If the Render root directory is `backend`, equivalent commands are `npm run build`/`npm start` after an appropriate workspace install. Actual Render root/build/start settings were not inspected; no Render blueprint was found to establish them. Do not replace these with SuperAdmin's Express5/SQLite build.

Build generation does not apply migrations. The committed PG migration history is incomplete relative to schema (section2.10). Confirm safe schema synchronization before new migrations; Mongo `db push` is separate from PG migration tooling. Atlas/PostgreSQL network access/TLS and correct Render connection settings must permit the service. Use Prisma clients for application queries; no raw SQL is proposed in this document.

### 8.3 CORS requirements

`server.ts` accepts no-Origin requests and exact origins from `AUTH_ALLOWED_ORIGINS`, with `credentials:true`. Allowed methods: GET, POST, PATCH, DELETE, OPTIONS. Allowed headers: Content-Type, Authorization, X-CSRF-Protection, X-Auth-Client, X-Client-Platform. PUT is not allowed. No exposed-header configuration currently makes custom/rate-limit headers readable cross-origin in browsers.

For direct browser access, add the exact deployed admin HTTPS origin to `AUTH_ALLOWED_ORIGINS` alongside existing web origins, with no trailing slash/path/spaces. HTTP localhost origins are rejected by auth-config validation; use HTTPS local development or the SuperAdmin BFF. A rejected CORS Origin can surface as generic500 through current error handling, not a guaranteed403. Adding a domain still does not solve Strict cross-site cookies (section4.4).

Server-to-server BFF calls without Origin do not require adding the browser domain to LeafCheck CORS. They still require valid upstream JWT/admin role and must be protected at the BFF browser boundary. New X-Request-ID headers would require an explicit allowed/exposed header update if used by direct browser clients.

### 8.4 Render troubleshooting without exposing secrets

Check deployment revision and build errors first: both generated clients/custom PG runtime and the password worker must be present. Auth/Gemini startup validation runs before listening. Then check health separately from database access. On device overview failures, relevant safe logs are `[Sensor Overview] PostgreSQL inventory failed` and `[Sensor Overview] Reading failed` with stage/code/model/column. Missing columns suggest schema drift; Mongo connectivity/auth errors suggest incorrect DATABASE_URL, Atlas network access, or deployment connection settings.

For scan diagnosis failures, inspect `[Scan] Gemini diagnosis failed` with redacted full stack, stage, provider status; provider quota429 is translated to busy503 when fatal, or successful-save diagnosisError at the second stage. `[Startup] TTL index enforcement failed`/TTL logs do not prove effective retention due to mapping caveat. Do not paste raw telemetry route Prisma error logs or full provider URLs before redacting credentials and personal data; some legacy error catches log raw error objects.

## 9. Security & Rate Limiting

### 9.1 Existing controls

| Layer | Current implementation |
| --- | --- |
| HTTP hardening | Helmet; Render HTTPS termination; Express trust proxy1 |
| Global limiter | IP-based in-memory store, **300 requests / 15 minutes** across routes |
| Scan limiter | IP-based, **10 requests / 15 minutes** for every `/api/scan` path/method |
| Auth limiter | IP-based, **20 requests / 15 minutes** for every `/api/auth` path |
| Limit headers | Draft8 standard RateLimit headers; legacy headers disabled |
| Global429 body | `{error:"Too many requests. Please try again later."}` |
| Scan429 body | `{error:"Too many scan requests. Please try again later."}` |
| Auth429 body | `{error:"Too many authentication requests.",code:"RATE_LIMITED"}` |
| Body limits | 10mb JSON on `/api/scan` and `/api/ai/analyze`; 16kb on other routes |
| Auth | Strict HS256 verification/claims; DB-backed active session + user checks |
| Credential hashing | Argon2id password hash; SHA-256 high-entropy refresh token hashes |
| Cookies/CSRF | HttpOnly Secure Strict host-only refresh cookie; allowed Origin + custom CSRF header on auth |
| Ownership | User-based PG scoping; missing/foreign resources concealed as404 |
| Input validation | Known body keys, bounded images/strings/ranges, resource IDs on most routes |

Limiters reset on process restart, do not aggregate across instances, and are keyed by shared source IP. A SuperAdmin BFF concentrates many operators behind its one egress IP; coordinate polling/caching and avoid auth refresh storms. Default firmware cadence is 15 seconds (60 samples per device per15-minute window); five sensors sharing an IP can alone consume all300 global requests, before mobile/admin requests. Propose independent ingest/admin/read rate policies and shared-store limiting for scale, not disabling auth safeguards. There is no separate provider quota limiter on `/api/ai/analyze`.

### 9.2 Existing gaps relevant to an admin console

- Role enum exists, but no admin authorization gate or operator-specific audience/MFA/permissions.
- MAC-only telemetry ingestion is public and spoofable; registered identifiers are not authenticators. `LEAFCHECK_DEVICE_*` secrets are unused, and claim has no proof of possession.
- No explicit whitelist/revocation enforcement or device-secret rotation. Inactive owner does not stop ingest.
- No durable request metrics, audit trail, or admin action history; no reliable last-login/last-seen column.
- CORS is a browser policy, not authorization. Strict cookie site constraints require a BFF or reviewed hosting/auth design.
- Some legacy error logging prints raw objects; new admin endpoints must use sanitized errors and avoid accidental personal-data/credential logging.
- No PG/Mongo cross-DB transaction or automatic deletion/retention coordination; TTL helper currently targets the wrong stored date field.
- No guarantee that actual production schema equals checked-in Prisma schema/migration history; verify deployment before integrating.

### 9.3 Required admin protections to implement with the proposed APIs

1. Server-side role checking on every request using the current active PG identity. BFF uses actual operator sessions, not a shared unrestricted service token or self-asserted SQLite role.
2. Explicit minimal DTOs, masked list emails, no hashes/tokens/base64/provider dumps, pagination caps, allowlisted queries/sorts, and `no-store` for sensitive data. Audit full-identity detail reads and sensitive writes.
3. HTTPS end-to-end, BFF secure HttpOnly cookies, CSRF protections, origin allowlist, server-side token encryption/session expiry/revocation, serialized refresh, and safe timeout behavior.
4. Separate admin rate policy keyed by operator plus IP; strict limits and audit on future mutations. Consider an IP allowlist/VPN as defense in depth if staff have stable access; it does not replace JWT/role verification. Set proxy trust to the actual hosting topology before trusting forwarded IPs.
5. Optional separate admin JWT audience/key and shorter/MFA-backed sessions require explicit additional issuance/verification config and tests; never expose the mobile signing key to the separate repository/browser to mint its own tokens. Upstream remains token issuer.
6. Durable, append-oriented audited actions with controlled retention/access and fail-safe handling; no secrets in metadata. Future destructive operations require deliberate confirmation/least privilege and are outside this handoff's read-only v1.
7. Prefer backend-normalized sensor data for cross-account views. If SuperAdmin retains direct Atlas reads, credentials must be server-only/read-only and restricted to required collections; it must apply the documented identifiers and report absent receivedAt/source truthfully.

## 10. Open Questions for the SuperAdmin Team

The contracts in section6 provide a usable first-release default; these are deployment/product decisions, not reasons to substitute mock data or bypass security.

| Decision | Recommended starting point / what to confirm |
| --- | --- |
| Upstream implementation owner/order | LeafCheck backend team builds role-gated admin APIs first; SuperAdmin BFF consumes them. Confirm release coordination and contract versioning. |
| Operator bootstrap and roles | PG User is identity authority; controlled initial ADMIN/LEAD_DEV bootstrap. Confirm who provisions operators and whether LEAD_DEV alone controls future role writes. |
| Staff identity/MFA | Confirm dedicated staff accounts versus existing customer identities, MFA requirement, operator session timeout, recovery/offboarding. No current MFA endpoint. |
| Auth/deployment topology | Prefer BFF with upstream native/server transport. Confirm admin hostname, durable encrypted token/session storage, browser cookie/CSRF policy, and whether direct same-site auth is ever needed. |
| SQLite's responsibility | Local session/cache only; PG operators remain truth. Decide migration/mapping of any existing SQLite admin records and durable SQLite hosting. |
| Render settings/schema state | Operator must verify actual service tier, commit/build/start/root settings, env presence, PG migration drift, Atlas database/indices. Local database name Cluster0 is not production confirmation. |
| Whitelist semantics | Registered-MAC list is current effective policy. Decide true preprovisioned DeviceWhitelist, revocation, ownership challenge, and signed device requests before exposing management actions. |
| Online/offline meaning | v1 recent-reading window30min with1min future tolerance matches app. Decide if hardware15sec cadence warrants a stricter operational heartbeat window and scalable last-seen storage. |
| Multi-plant device associations | DTOs support plants arrays. Decide whether to enforce actual one-to-one pairing with a schema migration across all write paths. |
| Historical telemetry cleanup | Inspect TTL raw-field mismatch/effective Atlas indexes. Decide legacy UUID-to-MAC backfill, receivedAt/source additions, stale/orphan policy, and retention without deleting valid readings accidentally. |
| API observability | Add request metric instrumentation or approved external aggregator. Confirm durable sink,30-day retention, queue/drop accounting, provider/application-level diagnosis failures, sampling policy, and who can view metrics. |
| Sensitive-action audit | Recommend new PG AuditLog with SetNull actor relation, role snapshot, redacted metadata,365-day initial retention. Confirm compliance/retention/export policy and audit write-failure behavior. Existing actions cannot be reconstructed reliably. |
| Personal-data access | Mask list emails; full identity only on authorized/audited details. Decide whether to restrict identity/report/image access further by role; no credential fields in any view. |
| Admin management actions | The proposed seven GET endpoints are read-only. Decide separate audited contracts for deactivate/reactivate users, operator invitations/roles, device revoke/unclaim/unpair, account erasure; do not use customer owner routes to impersonate users. |
| Local-only app features | Decide whether spaces/schedules/avatar/notifications need server models later. Today admin PG counts will not match all local/guest UI state. |
| Cross-repository verification | Confirm staging URL/operator fixture and executable contract tests for enums/nullability/errors/pagination, plus a smoke test that tolerates Render cold start without leaking credentials. |

### Handoff completion boundary

This document inventories all nine PostgreSQL models, the Mongo reading contract, all27 existing method/path endpoints, every backend runtime/Prisma environment variable plus test/local-only names, and the seven proposed admin read endpoints. It deliberately does not claim new APIs, whitelist enforcement, audit history, request metrics, verified Render environment values, or a migration-ready production schema. Implement and deploy those missing upstream capabilities before replacing SuperAdmin's disconnected sections with live account-wide data.
