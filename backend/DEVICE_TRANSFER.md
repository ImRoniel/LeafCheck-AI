# Device transfer and local deployment

Explicitly unpairing a physical sensor releases it from the account. Its PostgreSQL UUID, hardware MAC, closed pairing intervals, and MongoDB readings survive. Another account can claim the same sensor and then pair it to its own plant. Moves between plants and demo-sensor unlinking retain account ownership.

The migration `20261022000000_device_ownership_transfer` makes device ownership nullable and changes owner deletion to `SetNull`. Existing devices start at claim version zero, retaining access to their original legacy readings. Each acquisition of an unowned device advances its claim version and records its claim time. Same-owner reclaiming preserves both boundaries.

Firmware payloads stay unchanged. The server freezes the claim version alongside the plant/pairing context before inserting a reading into MongoDB. Device latest/history/overview queries require the current claim version and time boundary, so a delayed old-owner insert cannot appear in the next owner's account. Original plant histories continue using their original plant/pairing context. Uploads while the sensor is unowned have null ownership and plant context.

The public operations are:

| Request | Behavior |
| --- | --- |
| `PATCH /api/plants/:id/pair-device` with `{"deviceId":null}` | Atomically closes the pairing and releases physical-device ownership and its provisioning claim pointer. Repeated unpairing is a no-op. |
| `POST /api/devices/:id/release` with `{}` | Releases an already-unlinked physical device belonging to the caller. Returns 204. |
| `POST /api/devices/claim` with `{"macAddress":"LC-A50528"}` | Acquires the retained unowned record and advances its claim version. Existing hardware approval and claim-policy checks still apply. |

Release rejects another account's device with 404, an active plant/pairing with 409, and demo devices with 400. Concurrent acquisitions have one winner. A stale previous-owner release cannot clear a later owner's claim. Device names reset to the hardware identifier when released, keeping previous owners' labels private.

For a device already unlinked under the old implementation, sign in as User A, open **Settings → Connected sensors → Manage Devices**, and select **Release LC-A50528 from your account**. User B can then claim it. The migration preserves existing ownership until an authenticated release; it does not automatically release every device awaiting plant assignment.

Configure the existing `backend/.env` PostgreSQL/MongoDB connections and authentication settings, and the frontend's `EXPO_PUBLIC_API_URL`. Run these commands from the repository root in the backend terminal:

```bash
cd /home/roniel_cuaresma/Leaf-Check-AI
npm run db:migrate:pg --workspace=backend
npm run db:sync:telemetry --workspace=backend
npm run build --workspace=backend
npm test --workspace=backend
npm run start --workspace=backend
```

`db:sync:telemetry` adds only the claim-version index through Prisma Client, preserving separately managed MongoDB indexes, including retention. No migration or schema push runs against the query-only Supabase `auth` projection.

Start the mobile app in a second terminal:

```bash
cd /home/roniel_cuaresma/Leaf-Check-AI
npm run start --workspace=frontend -- --clear
```

The real database transfer suite uses disposable Docker databases. With `postgres:16-alpine` and `mongo:7.0` images available locally, run:

```bash
npm run test:device-transfer --workspace=backend
```

For a live demonstration, have User A unpair/release the sensor, verify it leaves A's inventory while A's plant history remains, then have User B claim the printed hardware ID and pair it. B's live readings begin with B's claim; A's historical plant readings remain accessible only through A's plant.
