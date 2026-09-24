# Demo telemetry

`POST /api/plants/:id/seed-telemetry` requires a valid bearer JWT and an owned plant. It returns the updated plant, including `deviceId` and `simulated: true`. Foreign and missing plants both return 404. Plants already linked to another device return 409; hardware links and readings are never replaced.

The first call creates a dedicated PostgreSQL device with a deterministic UUID, a synthetic `DEMO:<plant UUID>` MAC identifier, and `SIMULATED` status. Subsequent calls reuse it. Firmware ingestion rejects these virtual devices.

Each successful call replaces the virtual device's MongoDB batch with exactly 193 readings, covering 48 hours at 15-minute intervals through generation time. A PostgreSQL plant-row lock serializes seed requests across application instances. MongoDB replaces the batch in a transaction, with stable ObjectIds as an additional duplicate guard. No schema migration is required.

## Curve assumptions

- Fixed UTC+8 tropical indoor day, independent of server timezone.
- Temperature rises from 24°C at 05:00 to 31°C at 15:00.
- Humidity inversely follows temperature between 80% and 55%.
- Light is zero from 18:00 to 06:00, with a smooth daylight curve peaking at 12,000 lux at noon.
- Soil moisture dries gradually, with one 18-point watering addition (17.88-point net increase between samples).
- Values are deterministic for a given device and generation time; reseeding moves the window to the current time.

## UI

Open an owned plant profile and choose **Generate Demo Readings**. The profile displays **Simulated sensor data — no hardware connected**, reloads latest/history readings, and refreshes shared plant state. Server linkage takes precedence over local device mappings. Four metric cards display up to 200 samples, sorted oldest to newest, with local-time endpoints, range/latest summaries, horizontal scrolling, and accessible per-sample values.

## Verification and deployment

Run `npm --prefix backend test` and `npm --prefix frontend test` from the repository root. Demo tests use actual JWT verification and mocked database adapters; they do not validate live database locking or transaction rollback.

MongoDB must support transactions (a replica set, such as MongoDB Atlas). Before deployment, smoke-test against PostgreSQL and MongoDB: seed twice and concurrently, then retrieve `/api/telemetry/:deviceId/history?limit=200` and confirm 193 rows, one virtual device, and matching latest timestamps. Inspect the four charts on the target native/web platforms.

PostgreSQL and MongoDB do not share a distributed transaction. If PostgreSQL commit fails after MongoDB succeeds, a demo batch can temporarily remain unlinked; retrying reuses the deterministic device and reading IDs and repairs the link without accumulating batches. Plant deletion does not introduce new cross-database cleanup in this change.
