# Plant-scoped telemetry: Phase A

Phase A prepares the two schemas and a PostgreSQL migration. Pairing, ingestion,
plant reads, charts and AI scans still use their existing implementation. The
telemetry isolation fix requires the separately approved Phases B, C and D.

## Reconciliation evidence

The authorized read-only PostgreSQL snapshot at
`2026-10-13T16:49:54.659Z` used Repeatable Read and returned:

| Check | Result |
| --- | ---: |
| Device rows | 2 |
| Plants with non-null deviceId | 1 |
| Duplicate device references | 0 (`[]`) |
| Plants referencing a missing device | 0 (`[]`) |

The single read-only MongoDB aggregation at `2026-10-13T16:49:55.505Z` returned:

| Check | Result |
| --- | ---: |
| sensorReadings documents | 117 |
| Documents with a plantId field | 0 |
| Documents with a pairingId field | 0 |
| Documents with either field | 0 |
| Documents matching currently paired MACs | 117 |

The currently paired MAC was `LC-A50528`. Field-existence checks counted explicit
nulls too. Matching this MAC does not prove which plant owns any past reading.
Repeat reconciliation at cutover; this snapshot is not a permanent invariant.

## Schema contract

`DevicePairingHistory` uses the existing UUID-as-TEXT IDs. Each row links one
device and one plant with a UTC `[pairedAt, unpairedAt)` interval; a null end
means currently paired. PostgreSQL enforces foreign keys, nonnegative interval
duration, one open session per device, one open session per plant, and one
current `Plant.deviceId` holder. Both parents expose `pairingHistory` list
relations; the existing `Device.plants` relation remains a list.

The device history foreign key uses `NO ACTION DEFERRABLE INITIALLY DEFERRED`,
preserving history on a direct device deletion while allowing existing
User -> Plant -> history deletion cascades to finish before the transaction
commits. Prisma 6 also cannot represent this deferrability. The migration
executes as one atomic SQL block so duplicate links roll back its DDL and Prisma
can record the original constraint failure.

The native partial indexes and interval CHECK live in migration
`20261014000000_plant_scoped_telemetry`. Deploy PostgreSQL through reviewed
migrations, rather than `db push`: the Prisma 6 schema does not describe those
native constraints. Closed-session overlap prevention, ownership checks and
consistency between open sessions and `Plant.deviceId` belong to the Phase B
writer and the verified importer. Those guarantees are not implemented yet.

MongoDB adds optional `plantId`, `pairingId` and `contextVersion` fields.
The ID fields are PostgreSQL UUID strings, not MongoDB ObjectIds. None has a
default. Phase B must explicitly write `contextVersion: 1` for every new
reading, including known-unpaired readings with null plant/pairing IDs.
Missing or null contextVersion remains legacy/unverified; it must never be
silently interpreted as context-aware data.

The existing `(deviceId, timestamp DESC)` index is retained. New indexes cover
`(plantId, timestamp DESC)` and `(pairingId, timestamp DESC)`. Prisma's timestamp
field maps to MongoDB's `deviceTimestamp`, including in these indexes.
MongoDB index changes use its own schema and Prisma `db push`; PostgreSQL
migrations do not modify MongoDB documents or indexes.

## Verification

From the repository root:

```sh
npm run test:telemetry-schema --workspace=backend
npm run build --workspace=backend
npm test --workspace=backend
```

The schema runner requires local Docker images `postgres:16-alpine` and
`mongo:7.0`. It creates only its own labelled containers, binds random ports to
127.0.0.1, overrides both PostgreSQL URLs and the MongoDB URL, and cleans up
only resources whose ownership label matches this run. It never loads the
application databases as test targets.

Checks exercise the real PostgreSQL migration, existing-row preservation,
partial unique constraints, foreign keys, interval ordering, rollback and
parent deletion behavior. A separate database with deliberately duplicated
current links verifies that migration fails atomically and preserves both
plants without selecting a winner. Real MongoDB checks verify missing/null
legacy fields, explicit context, unchanged documents after index synchronization,
and the mapped index keys. Successful generation/build verifies the new client
types without applying either schema to an application database.

### Recorded Phase A results

| Check | Result |
| --- | --- |
| Both Prisma schemas validated | Passed |
| Generated clients | Prisma 6.19.3; passed |
| Disposable PostgreSQL/MongoDB integration tests | 19 passed, 0 failed |
| Tracked backend source TypeScript check | Passed with the regenerated clients |
| PostgreSQL client packaging | Passed |
| Full backend test command | 165 passed, 14 failures in the pre-existing untracked admin tests |
| Full backend build | Blocked by pre-existing admin.ts importing missing requireAdmin |

The untracked `src/routes/admin.ts` imports `requireAdmin`, which the tracked
`src/lib/auth.ts` does not export. Its 13 admin test cases fail on that import,
and the same file's teardown adds one failure because its server was not
created. These files were present before Phase A and were not changed. The
tracked-source TypeScript check used a temporary configuration with the existing
compiler options and Git-tracked backend source files as roots; it did not
change the repository's tsconfig or conceal the full-build failure. The admin
integration needs a separate correction before the full build/test gate passes.

All schema applications and fixture writes were confined to the disposable
containers. No application database was migrated or backfilled, and no runtime
route or pairing/ingestion helper was changed in Phase A.

## Coordinated cutover after Phases B, C and D

1. Review the completed implementation and repeat both database checks using
   Prisma Client. Stop on duplicates, missing devices or inconsistent ownership;
   obtain approval for a concrete reconciliation script rather than choosing a
   historical owner from updatedAt or a device's latest reading.
2. Check existing PostgreSQL schema and migration metadata using
   [AUTH_DEPLOYMENT.md](AUTH_DEPLOYMENT.md). The project has previously used
   db push; do not blindly apply baseline CREATE statements or mark unknown
   migrations as applied. Phase A does not reconcile earlier schema drift.
3. Drain old pairing, hardware ingestion, demo and scan-created pairing writers
   for the deployment boundary. Apply the reviewed PostgreSQL migration and
   synchronize MongoDB indexes using the correct schema for each database.
   The migration fails on duplicate current links and makes no data repairs.
4. While those writers remain stopped, choose one UTC cutover time T0. A
   separately reviewed Prisma transaction creates an open session for every
   confirmed current pairing starting at T0. Do not start sessions at a plant's
   createdAt/updatedAt or the earliest reading. The migration itself seeds no
   sessions, and Phase A contains no runnable backfill or cutover writer.
5. Activate all context-aware writers and plant-scoped readers together, then
   resume ingestion. Keep the existing hardware payload; plant/pairing context
   comes exclusively from the server. Do not deploy the old scan-created
   pairing path against the new current-holder constraint as the finished fix.
6. Import older pairing intervals only from independently verified evidence.
   Validate ownership, interval ordering and non-overlap for each device and
   plant before allowing any legacy window fallback. Existing AI snapshots may
   already contain another plant's readings and are not sufficient evidence.
7. Any later backfill must operate in bounded, idempotent Prisma batches and
   update only still-untagged documents inside verified intervals. Preserve
   MongoDB _ids, sensor keys, timestamps and measurements. Dry-run counts and
   interval evidence must be reviewed before applying a backfill. Documents
   without provable context remain available as device history and are excluded
   from plant timelines. New version-1 unpaired documents never enter legacy
   fallback.

Unpairing and moving a sensor will close sessions without deleting readings.
Re-pairing will make earlier sessions available as historical context. Current
conditions must come from the active session; freshness by age alone cannot
turn a prior session into a new measurement.
