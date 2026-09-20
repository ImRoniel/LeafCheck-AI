# LeafCheck AI frontend integration

Expo SDK 57 UI adapted from the donor prototype. The canonical Express backend,
dual Prisma schemas, firmware, and root workspace configuration remain authoritative.
The SDK 54 reference required by repository instructions and SDK 57 compatibility
reference were reviewed before implementation.

## Local setup

Run from the repository root:

```powershell
npm ci
npm run db:generate:all --workspace=backend
npm run backend
```

Configure backend-only credentials locally: DATABASE_URL (MongoDB), POSTGRES_URL
and DIRECT_URL (PostgreSQL), GEMINI_API_KEY, PLANTNET_API_KEY, and optionally
PERENUAL_API_KEY. Never expose these through Expo public variables. Client generation
does not synchronize schemas; do not run database push against an existing database
without operator approval. Existing user/plant records are required. Device telemetry
requires an existing registered PostgreSQL device.

In a separate terminal, choose one frontend target:

```powershell
$env:EXPO_PUBLIC_API_URL = 'http://10.0.2.2:3000'
npm run android --workspace=frontend
```

```powershell
$env:EXPO_PUBLIC_API_URL = 'http://localhost:3000'
npm run web --workspace=frontend
```

Alternatively copy the frontend environment example to a local environment file.
An explicit URL overrides platform defaults. Physical phones require a LAN address,
Windows firewall access and a compatible Expo client/development build. Web camera
access requires a supported secure context. Native camera verification requires a device.

## Behavior and limitations

- Enter through onboarding and Continue as Guest. Guest entry is not authentication.
  The current backend has no authentication/user filtering: local testing only, not
  safe for public deployment or sensitive data.
- Plants are server-backed; spaces are read-only groups derived from plant locations.
  Account services, plant/space creation, profile changes, archives and notifications
  are unavailable; their mutation controls are disabled.
- Configure an optional device ID for each existing plant in Settings. Mappings are
  stored locally using AsyncStorage and are unverified, not server pairing.
- All application API requests pass through the frontend gateway. No frontend Prisma,
  Supabase, MongoDB, Gemini or direct ESP32 transport is used.
- Latest telemetry uses nested readings; history uses paginated raw readings. Light is
  lux, not PAR/PPFD. pH is not a live sensor reading. Missing history values remain null.
  The existing latest endpoint substitutes zero for missing light/raw moisture; the
  client cannot distinguish those substitutions from real zeros.
- Capture a JPEG for an existing plant, optionally including its locally configured
  device. Images over the conservative 4-million-character base64 cap are rejected.
  The scan saves its report, then the app separately updates health and refetches the
  plant. Synchronization failure retains the report and retries synchronization only.
  Scans are never automatically retried: a failed/timed-out pipeline may have saved
  intermediate records already.
- Scanning does not update the saved species/image. Reports are session-only because
  no report retrieval endpoint exists. Identification confidence is not a health score.
- Provider diagnosis is advisory. Standalone analysis and the primary scan pipeline
  remain distinct APIs; upstream model availability depends on backend configuration.

## Verification

```powershell
npm run test --workspace=frontend
npm run typecheck --workspace=frontend
npm run lint --workspace=frontend
npm run build --workspace=backend
Push-Location frontend
npx expo install --check
npx expo-doctor
npx expo export --platform web
Pop-Location
```

Automated tests cover gateway contracts/errors, no-data handling, request cancellation,
polling races, scan synchronization failure and targeted retries. Manual acceptance
still requires live databases/provider credentials and a camera device: permission
denial, capture/retake, image-only/device-assisted scanning, stale/no telemetry, history
pagination, offline recovery, persistence after reload, navigation and guest gating.
No live database writes/provider scans are performed by the unit tests.

The dependency installation reported 14 moderate advisories. Review npm audit
separately; do not apply forced upgrades to the protected architecture.
