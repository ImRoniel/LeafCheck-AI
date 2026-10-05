---
version: 3
status: built
date: 2026-10-05
---

# Frontend device claiming, pairing and plant telemetry

## Problem

The backend supports authenticated device claiming, plant pairing and a plant-scoped telemetry BFF, but the Expo connection flow still simulates discovery and saves mock assignments locally. Plant Profile separately fetches metadata and device telemetry and can mistake a local mapping for a real pairing. Users need server-confirmed connections and clear unpaired, waiting, loading and failure states.

Source: the user's `$pincer-plan` brief in this session, headed “Context: We have successfully implemented the backend API endpoints for IoT Device Claiming, Plant Pairing, and the Telemetry BFF.” Its requested Scanner → Assignment → Plant Profile flow, three service functions, conflict handling, frontend-only constraint and existing styling are retained below.

Planning profile: standard. This is a brownfield change across authenticated mutations, account state, navigation and telemetry rendering; the current suite is not green and the BFF intentionally omits plant metadata.

## Solution

Use the existing authenticated API client to claim a entered or camera-scanned MAC, retain the returned device UUID in account-scoped global state, and pair it to an owned plant. Read current pairing and latest telemetry exclusively through the BFF on profile focus and refresh. Preserve profile metadata through the existing AppData plant collection, with explicit collection loading/error recovery for deep links; no profile `fetchPlant` or legacy latest-reading request. Retain existing styling and dependencies. The user authorized frontend integration with the words “Please implement the following frontend changes”; this invocation produces the planning artifact for `$pincer-narrow`, not implementation.

Assumption surfaced during discovery: the BFF has no plant metadata. The draft follows the explicit single-request constraint using collection metadata; the optional discovery question proposes a `fetchPlant` fallback only if the user permits it. No fallback is authorized by this draft. Existing collection loading may make its own list request; “single request” refers to the profile's plant/sensor retrieval, not application-wide traffic.

## Scope

| This PRD covers | This PRD does NOT cover |
| --- | --- |
| Typed claim, pair/unpair and BFF client functions and validators | Backend endpoints, schemas, migrations or firmware |
| Manual MAC input and camera barcode/QR input using existing Expo Camera | Bluetooth discovery, invented nearby-device results |
| Scanner → plant assignment → real success → profile navigation | Real Space pairing or guest device claiming |
| Account-scoped pending claimed UUID, busy/errors/cancellation | JWT persistence, new token handling or dependencies |
| BFF profile states, reassignment refresh and metadata preservation | Automatic watering or fabricated sensor readings |

## Requirements

### R-01 — Authenticated API contracts

- **S-01:** `claimDevice(macAddress, name?)` posts `{ macAddress, name? }` to `/api/devices/claim`, validates the returned Device, and retains its UUID separately from its MAC. LC-A50528 and backend-supported colon/hyphen MAC forms are accepted after trimming and normalization; invalid MAC/name input is rejected visibly.
- **S-02:** `pairDeviceToPlant(plantId, deviceId)` patches `{ deviceId }` to `/api/plants/:plantId/pair-device`, accepts a UUID or null, and validates the returned Plant. Null is supported by the service without adding an unsolicited unpair UI.
- **S-03:** `fetchPlantTelemetry(plantId)` gets `/api/plants/:plantId/telemetry` and validates the discriminated paired/unpaired contract, including nullable telemetry and the existing nested metric payload. Malformed successful responses become typed validation failures rather than fake defaults.
- **S-04:** All three functions reuse Bearer authentication, one-time 401 refresh, timeout/cancellation and status-preserving errors. No access JWT is written to storage and HTTP failures are never converted into successful pairing or unpaired state.

### R-02 — Claim and carry a real device

- **S-05:** Entering LC-A50528 or scanning that value submits a single claim and advances directly to assignment with the returned device UUID available in global account state. Existing demo timers and mock hardware lookups are absent from this real path.
- **S-06:** Claim pending state disables duplicate submissions. HTTP 409 displays an alert explaining the device is already claimed by another account, leaves the user on Scanner, and permits correction/retry; other failures have actionable retry messages.
- **S-07:** Camera permission denial allows manual entry. Duplicate scan events do not cause repeated claims. Blur, cancel, unmount or account changes prevent late responses from advancing or leaking a previous account's pending device.

### R-03 — Pair to an owned plant

- **S-08:** Assignment lists existing owned plants, preserves a valid locked contextual plant target, and calls the pairing service with that plant ID and the claimed UUID. Missing claim state, invalid/deleted contextual targets and unsupported Space targets cannot silently select another destination or create a local mock assignment.
- **S-09:** Pairing disables repeat submission, exposes loading and recoverable failure, and reports success only after backend confirmation. The success handoff offers navigation to the paired Plant Profile and requires no mock record.
- **S-10:** Reassigning a device already paired to another plant makes only the intended backend pairing mutation. Update/invalidate collection state so the old plant loses its cached link, refresh pairing state on profile focus, and show a successful assignment message; visiting the old plant shows “No sensor paired”. A failed collection refresh after a successful write must not claim the pairing failed or trigger a second mutation automatically.
- **S-11:** Guest access requires sign-in for real claiming/pairing. Existing manual plant care and image scanning remain available; existing local Space/demo records never establish server pairing.

### R-04 — Unified profile telemetry states

- **S-12:** Profile focus/refresh issues one BFF read for pairing/latest readings, shows a spinner or existing skeleton while pending, and cancels stale responses when the plant or session changes. Profile and PlantTelemetry do not call `fetchPlant`, `useSensorData` or the legacy latest endpoint for this read.
- **S-13:** `paired: false` displays a “No sensor paired” card and “Pair a Sensor” action carrying the current plant target into Scanner; local mapping and demo data cannot override this state.
- **S-14:** `paired: true` displays `device.name`. Non-null telemetry shows temperature Celsius, humidity percentage, soil moisture percentage and lux using the nested backend fields; valid zero values remain zero. Null telemetry displays “Waiting for first sensor reading...” without fabricated metrics.
- **S-15:** BFF failure has a visible retry state distinct from unpaired/waiting. Any retained readings must be labelled stale/error; no previous plant's readings appear during navigation.
- **S-16:** PlantTelemetry accepts the unified payload and callbacks for parent refresh instead of a deviceId-driven latest-fetch prop. Care guidance still receives the real readings or null. History, if retained, loads only through explicit user action using the hardware MAC, never the Device UUID and never an automatic extra profile request.
- **S-17:** Existing name/image/species/location, edit/delete, thresholds, care guidance and image scanning use AppData metadata. Deep links wait for collection hydration, expose collection retry on failure and handle genuinely missing plants. Demo seeding/local mapping actions no longer influence real pairing/latest state on this screen; existing demo features outside this path remain outside scope.

### R-05 — Verification and delivery

- **S-18:** Frontend typecheck and meaningful API/flow tests cover claim 409, Bearer headers, UUID versus MAC, pairing failure/reassignment, account cancellation and all BFF states. Update mock-specific flow assertions for the real path; preserve unrelated tests and document baseline failures separately from new regressions.
- **S-19:** Run Expo locally and verify authenticated Scanner → Assignment → Plant Profile against the existing backend: new claim, same-owner reclaim, another-owner conflict, waiting for a first reading, populated readings, reassignment and old-plant unpaired state. Record actual observations and missing credentials/hardware/backend prerequisites; starting Metro alone is not end-to-end verification.

## Architecture

### Structure and components

Primary frontend paths: `services/api.ts`, `services/validators.ts`, `types/`, `context/app-data.tsx`, `app/device-connection/scanner.tsx`, `assignment.tsx`, `success.tsx`, `app/plant-profile.tsx`, `components/plant-telemetry.tsx` and their frontend tests. Selection must be bypassed or guarded so a legacy route cannot supply mock IDs to real assignment. Entry/route types and management links may need compatibility adjustments within frontend only.

AppData owns an ephemeral pending claimed Device inside its existing account-remounted provider and collection invalidation after pairing. It must not reuse the local plant→device mapping store as server authority. Assignment validates targets from the owned plant collection. Profile owns BFF loading, cancellation and retry; PlantTelemetry renders its payload. Global collection metadata remains the source of profile details and uses existing edit/delete refresh behavior.

Data flow: MAC input → shared authenticated transport → claimed Device UUID → pending account state → selected plant → pairing PATCH → confirmed success and collection refresh → focus-triggered BFF → profile states and metric cards.

### Verified backend contract (read-only inspection)

`backend/src/routes/devices.ts` returns a bare serialized Device (201 on create, 200 on same-owner reclaim, 409 on another owner's claim). `backend/src/lib/device.ts` serializes id, name, macAddress, userId, status and ISO timestamps. `backend/src/routes/plants.ts` returns a serialized Plant for pairing; telemetry returns exactly `{ paired: false, device: null, telemetry: null }` or `{ paired: true, device, telemetry }`. Telemetry fields are `environment.temperatureCelsius`, `environment.humidityPercentage`, `soilMoisture.percentage`, `lightLevel.lux`, timestamp and hardware-MAC `deviceId`. These are local integration contracts, not an external API inferred from memory. No database changes or queries are planned.

### Brownfield protection and rollback

The shared transport, account-remount behavior and profile navigation are load-bearing. Existing API, auth, mock connection, accessibility, guidance and history tests protect them, though many mock assumptions will need replacement for this path. Initial frontend typecheck passed; the default suite failed before changes (230 passed, 42 failed in the first run), and repeat results differed. A serial run (`node --import tsx --test --test-concurrency=1 tests/*.test.ts` from frontend) reported 32 passing files and three failing files: scanner-care-task-feedback, scanner-lifecycle and scanner-pre-validation. Logs are in `/tmp/leafcheck-plan-frontend-tests.log` and `/tmp/leafcheck-plan-frontend-serial.log`; the cause is not established. Do not promise a green baseline without results.

Blast radius is frontend connection navigation, plant collection linkage and profile sensor rendering. Backend ownership and atomic reassignment remain authoritative. Rollback reverts only the frontend integration commits; claims/pairings already stored by the backend remain real state and must not be undone by local storage restoration.

## Visual Direction

Calm, clear, familiar. Preserve the current light theme, green accents, existing typography, device screen steps and Action/Notice/MetricCard components. Use visible disabled/busy states and accessible alerts/status announcements. Avoid a redesign, mock discovery language, permission dead ends and success copy that implies automatic watering.

## Security & Trust Boundaries

Entered/scanned MACs, route parameters and JSON responses are untrusted; validate at the frontend boundary and use existing response parsers, while backend ownership checks remain authoritative. Route UUIDs and cached links are not authorization. Access JWT stays in memory; native refresh credentials remain in SecureStore and web refresh uses existing secure cookies. Provider/API secrets remain server-side. Session changes invalidate pending claims and asynchronous writes; messages use existing sanitized error patterns.

## Success Criteria

| Criterion | Verification |
| --- | --- |
| Strict frontend compiles | `npm run typecheck --workspace=frontend` |
| Contract and UI regressions covered | `npm test --workspace=frontend`, targeted changed-path checks; compare documented baseline failures |
| Real connection flow works | Expo local run with existing backend, authenticated accounts and seeded/physical MAC readings; record S-19 observations |
| Backend untouched, existing visual patterns retained | Inspect frontend-only implementation diff and PRD scenarios |

## Dependencies & Risks

No new dependencies or upgrades. Registry checks on 2026-10-05 report latest Expo 57.0.26, React Native 0.87.1 and Expo Router 57.0.24; this plan retains the installed/declared project versions instead of upgrading. Camera capability already exists. Real verification requires a running authenticated backend, both existing databases and a suitable device MAC; populated-reading verification also requires available telemetry. Scanner is currently simulated, so camera acquisition and accessible manual input are actual implementation work. BFF metadata omission and existing guest/Space demo destinations are explicitly handled above.

## Out of Scope

Backend edits, Prisma/schema work, new external APIs, firmware, Bluetooth discovery, real Space pairing, automatic watering, redesign and dependency upgrades. No delivery budget or scope cuts were supplied. No implementation or Expo end-to-end result is claimed by this planning phase. Do not commit unless the user explicitly asks, per project rules.
