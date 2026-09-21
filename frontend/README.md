# LeafCheck AI frontend — Phase 2 authentication

## Setup

The frontend remains on Expo SDK 57 / React Native 0.86. The repository-required
SDK 54 reference and matching SDK 57 SecureStore documentation were consulted;
no SDK downgrade was performed. `expo-secure-store ~57.0.4` matches Expo's bundled
module recommendation. Rebuild the native development client after adding its
config plugin. Android backup exclusions are enabled; iOS uses device-only,
when-unlocked keychain accessibility without a biometric prompt.

From the repository root, install the locked workspace dependencies with your
normal approved setup procedure. Configure `frontend/.env` using `.env.example`,  
then run `npm run android --workspace=frontend` or
`npm run web --workspace=frontend`. Do not put database/provider credentials or
JWT secrets in Expo public variables. No backend generation/migration is required
by the frontend code changes; server deployment is a separate operator action.

During implementation npm 11.6.2 failed its workspace installed-tree update with
an Arborist `location` error. Lockfile-only resolution succeeded, and a frontend
local install (`npm install --prefix frontend --workspaces=false
--package-lock=false --ignore-scripts --install-strategy=shallow`) installed
SecureStore without backend lifecycle scripts or root-manifest edits. Dependency
audit reported moderate advisories; no forced upgrades were applied.

## Verified contract and deployment requirements

Only the permitted server authentication deployment document and auth route were
read. Their contract overrides the provisional platform-selector assumption:

- Native auth selector: `X-Auth-Client: native`; requests omit browser credentials.
- Browser auth: `X-CSRF-Protection: 1`, browser-provided allowed Origin, and
  `credentials: include`. JavaScript never sets Origin or reads the refresh cookie.
- `X-Client-Platform: native|web` is also included, but is **not** the server's
  native selector. A cross-origin proxy/server must allow the actual headers.
- All auth POST bodies are explicit JSON. Browser refresh sends `{}` and does not
  require a bearer token. Native refresh sends only `refreshToken`.
- Login/register return an access token; only native responses contain refresh
  credentials. Access tokens remain in memory. No credential is persisted to
  localStorage, sessionStorage, or AsyncStorage.
- Logout uses bearer authentication and `{}`, and accepts an empty 204 response.
- Profile GET requires bearer authentication. The permitted document does not
  specify its response envelope: the client validates either `{id,email,name}`
  or `{user:{id,email,name}}`, discarding unrelated fields. Verify this inference
  against a live response. Name-only PATCH is documented but optional profile
  editing is not exposed in this phase.

Browser auth requires same-site **HTTPS** frontend/API deployment, an exact
frontend origin in `AUTH_ALLOWED_ORIGINS`, and credentialed CORS when origins
differ. The Secure, HttpOnly, SameSite=Strict `__Host-` cookie is incompatible with
unrelated-site deployment and ordinary HTTP development. Use an HTTPS proxy for
browser auth testing. Native emulators may use `http://10.0.2.2:3000`; physical
phones need a reachable LAN endpoint. Use HTTPS for deployed native traffic.

## Session behavior

- A framework-independent coordinator binds to the existing API singleton without
  importing React. AuthProvider wraps account-keyed AppDataProvider and navigation.
- Native restore loads SecureStore, rotates, durably saves the replacement, then
  fetches `/api/users/me`. SecureStore failures are explicit; access is never
  published before persistence succeeds. Ambiguous rotation failures require a
  fresh sign-in instead of replaying a potentially consumed refresh token.
- Profile network failures retain the rotated credential and offer a profile-only
  retry; rejected credentials return to sign-in. Guests never fetch private plants,
  telemetry, analysis, or cloud scans.
- Private 401s share one rotation and receive at most one retry. Late 401s reuse
  a newer token. Auth endpoints, 403s and network failures do not trigger automatic
  retries. Canceling one request never cancels a shared rotation. Timeouts and
  cancellation retain typed errors; paid mutations are not blindly replayed.
- Browser tabs serialize cookie-changing auth requests with Web Locks, and use
  BroadcastChannel plus a nonsecret storage event for logout notification. The
  fallback for unavailable Web Locks is **fail closed**, not an unsafe storage
  lease. Browser sign-in is unavailable there; native sign-in and guest mode remain
  alternatives. Tokens are never broadcast or stored in browser JSON storage.
- Logout clears local identity immediately and cancels private requests. If the
  server is unreachable, revocation/cookie clearing cannot be guaranteed; an error
  explains the limitation. Account-keyed remounting removes private UI state,
  polling, captured images and scan reports. In-flight generations suppress late
  writes. Device maps use separate guest/account namespaces; legacy unscoped maps
  are intentionally not migrated or automatically attached to an account.
- Login/register are available to guests. Private detail/settings screens are
  guarded. Terms are public. Registration combines first/last name, checks password
  confirmation and explicit policy acceptance, and never trims passwords.
- Password recovery, OTP, account deletion, plant creation, archives and report
  retrieval remain unavailable. Profile is read-only apart from sign-out.

## Verification and remaining live acceptance

Run from the root:

```powershell
npm run test --workspace=frontend
npm run typecheck --workspace=frontend
npm run lint --workspace=frontend
```

Tests mock transport/storage; they do not contact databases or AI providers.
Coverage includes original gateway/poller/scan regressions plus session rotation,
concurrent/stale 401s, canceled waiters, 403 exclusion, mutation network errors,
SecureStore failures, cookie bootstrap, logout cancellation and guest denial.

Live acceptance still requires an HTTPS browser deployment and iOS/Android builds:
cookie acceptance/CORS, multiple real tabs and tab termination during refresh,
native keychain failures/restart, back/deep links during restore and logout,
account switching, camera permissions, scan cancellation, offline revocation and
the inferred profile envelope. Static/unit checks are not a claim that those live
flows or production database concurrency have been verified.

Local verification: 25 automated tests passed, TypeScript and Expo lint passed,
and `expo install --check` reported compatible dependencies. A production web
export was attempted but failed in Metro/Expo's Windows route-context resolution:
the generated module path contained a doubled drive prefix (`c:\C:\...`). This
prevents claiming a successful web build in this environment. Resolve and rerun
the export in the deployment environment before release; no SDK downgrade or
unreviewed Metro patch was applied.

Sensor values may be absent or stale. Lux is not PAR/PPFD; pH is not live telemetry.
Device mappings are local, unverified associations, not device authentication.
Diagnosis is advisory and scans can leave server-side intermediate records after
timeouts. Backend and hardware implementation/deployment remain outside this work.
