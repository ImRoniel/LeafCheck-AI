# LeafCheck AI admin web

A standalone browser app built with React, Vite, TypeScript, Tailwind CSS, and
`react-router-dom`. This npm workspace is independent of the Expo mobile app.
Use Node.js 22.12+ (or 20.19+).

From the repository root:

```bash
npm install
cp admin-web/.env.example admin-web/.env
npm run admin-web
```

Vite serves the app at `http://localhost:5174` and requires that port to be free.
With `VITE_API_URL=/api`, it forwards `/api/*` to `API_PROXY_TARGET`, which defaults
to `http://127.0.0.1:4000`, preserving the API path, cookies, and auth headers.
Set `API_PROXY_TARGET` in `admin-web/.env` if your backend uses another port.
The backend's default port is 3000; set `PORT=4000` there to match the proxy default.

For local browser auth, set `NODE_ENV=development` on the backend and include
`http://localhost:5174` in its `AUTH_ALLOWED_ORIGINS` list. Production origins must
use HTTPS. Restart Vite after changing environment variables. All `VITE_*`
variables are public browser values; `API_PROXY_TARGET` is used only by Vite.

```bash
npm run typecheck --workspace=admin-web
npm test --workspace=admin-web
npx playwright install chromium
npm run test:browser --workspace=admin-web
npm run build --workspace=admin-web
npm run preview --workspace=admin-web
```

## Routes and permissions

| Route | Page |
| --- | --- |
| `/login` | Email/password sign-in |
| `/login/otp` | Eight-digit staff email verification |
| `/dashboard` | Four live metrics and Recent Activity for SuperAdmins |
| `/users` | SuperAdmin create/edit/delete, ban/unban, force logout, and email reveal |
| `/devices` | Device inventory and operational management for both staff roles |
| `/diagnostics` | Last five stored readings, accessible to both staff roles |
| `/provisioning` | SuperAdmin hardware approval registry |
| `/settings` | SuperAdmin scanning and device-claim controls |
| `/integrations` | SuperAdmin safe provider configuration and quota availability |
| `/audit` | SuperAdmin audit table |
| `/forbidden` | Explains a staff role restriction |

The root and unmatched paths redirect to `/login` when signed out and `/dashboard`
when authenticated. `RequireAuth` protects dashboard routes and waits for session
restoration before rendering. Each feature route requires its matching permission.
A `LEAD_DEV` direct visit to Users, Provisioning, Settings, Integrations, or Audit
redirects to `/forbidden` without fetching its data. Its sidebar shows Overview,
Devices, and Diagnostics.
The topbar displays the current email and labels `ADMIN` as SuperAdmin and
`LEAD_DEV` as System Administrator.

Lists use the backend's `page`, `pageSize=25`, and (for users/devices) `q` parameters.
Email addresses are masked by default. Reveal emails requests `revealEmails=true`
from the server for the current page; Hide emails drops that option. Full addresses
are never persisted in browser storage. Devices display computed connection status,
labeled status dots, and relative Last Seen timestamps with exact times on hover.
They support operational responses without owner fields. Audit actors/targets show
emails with a deleted-account fallback; original IDs and action codes remain
available on hover. Outcomes come from metadata or known action names, with unknown
actions marked Recorded. Tables include loading,
empty, error/retry and pagination states. The UI prevents banning your own account;
the backend remains authoritative for every permission and mutation.

Devices open an accessible slide-over details panel. Rename submits a changed name,
the device's `updatedAt`, and an audit reason. Unlink requires confirmation and a
reason, and submits both `updatedAt` and the expected pairing identifier. Stale
versions require refreshing and reviewing before retry. ADMIN sees owner details;
LEAD_DEV receives operational fields. Diagnostics display actual measurement times,
temperature, humidity, raw soil ADC, lux, and simulated-device indicators. Missing
values display Unavailable. Refresh fetches stored readings and does not ask the
hardware to take a measurement. `/diagnostics?device=<id>` opens that device directly.

Force Logout confirms a reason before revoking a user's application sessions. It
does not disable the account or claim to delete provider session records. Hardware
provisioning supports pre-registration and versioned approval/revocation with audit
reasons. Settings require confirmation and a reason; saves include only changed
flags and the singleton version. Disabling a service explicitly warns that it
affects all clients. Staff password and email OTP remains required; universal-user
OTP is shown as planned. Provider cards show configured/unverified status and
unavailable quotas instead of inventing provider capacity or issuing analysis calls.

The Overview requests `/admin/stats` for total users, active physical devices,
registered plants, and saved AI analyses. Active means the latest sensor reading
is within the existing 30-minute window (with 60 seconds of future tolerance).
Demo and unregistered devices are excluded. Unavailable connectivity displays
Unavailable instead of zero. Both staff roles may read aggregate totals, but
only ADMIN fetches the five latest audit entries with `pageSize=5`.

The device card shows `X online / Y total`: the total includes all registered
devices, and its note identifies how many are simulated. Online counts exclude
simulated devices. `/admin/health` checks PostgreSQL readiness and MongoDB ping
with independent 2.5-second deadlines; its System Health card refreshes every minute.
If the API cannot be reached, database status is Unknown rather than assumed down.

Device readings and status refresh every 60 seconds while the tab is visible and
on returning to the tab. Background refresh keeps the previous table visible and
displays the last refresh time. Users have a Refresh button; submitting the same
search reloads it. Lists recover to a valid page if concurrent deletions shrink
the result set. Audit filters include action, inclusive local From/To dates, and
optional actor/target IDs; applying or clearing filters resets pagination.

Create and Edit use accessible native dialogs. Edit sends only changed name/role
fields plus the row's `updatedAt`. Ban/unban also includes `updatedAt`. The backend
rejects a stale version with `409 CONFLICT`; Close and refresh discards the stale
draft before another edit. Changing your own role signs you out immediately.
Create includes an Account Active switch, enabled by default. Turning it off sends
`isActive:false` and creates a banned account immediately. Backend-generated provider
IDs and verification timestamps remain outside the form.
Validation errors appear beside their fields, including safe provider password
policy errors. Delete requires typing DELETE
and explains the cascade. A failed deletion can leave an account disabled; the
table refreshes to reflect the backend state and the dialog permits a retry.

Escape, Close, and Cancel remain available during a save/delete and abort its
request. Cancellation or a network timeout does not prove that a write was rolled
back: the UI prompts the administrator to refresh and review before retrying.
The new device, provisioning, settings, and force-logout confirmation dialogs keep
the dialog open while a mutation is pending. Unmounting cancels its request; an
ambiguous network result requires reviewing the server state before retrying.

The interface uses Lucide icons and shared theme-aware surfaces, badges, inputs,
and table styles. The theme toggle defaults to the system preference and stores
only `leafcheck-admin-theme` after an explicit toggle. An early HTML initializer
applies saved dark mode before the app renders. Dialogs trap focus, support Escape,
and return focus to their trigger when it remains present.

## Authentication

`useSession()` exposes `user`, `status`, `sessionError`, `login(email, password)`,
`logout()`, `restoreSession()`, `challenge`, `otpBusy`, `verifyAdminOtp(token, code)`,
`resendAdminOtp()`, and `cancelAdminOtp()`.

- Login posts credentials to `/api/auth/login` and validates the response. A
  `USER` account is immediately logged out and receives
  `Unauthorized: Admin access required`. ADMIN and LEAD_DEV both receive a
  `202 otp_required` response, which stores only the challenge in memory, sets
  `status` to `otp_required` and routes to `/login/otp`; no access token or user is
  accepted before verification. `login()` returns its resulting status.
- OTP verification posts `{challengeToken,code}` to `/api/auth/verify-admin-otp`
  and accepts the final token/user only on 200. Resend and cancel post the pending
  token to `/api/auth/admin-otp/resend` and `/api/auth/admin-otp/cancel`. Resend has
  a 60-second minimum cooldown and retains the server's challenge expiry. Invalid
  codes leave the challenge intact; exhausted/invalid challenges return to login.
  Reloading loses an unverified challenge and returns to login. Cancellation
  clears local challenge state even when server cancellation cannot be confirmed.
- Duplicate submissions are blocked. A 429 displays “Please wait before requesting
  another code.” and disables requests during the cooldown; a longer `Retry-After`
  value is honored. Auth requests are not automatically retried.
- On mount/reload, restoration posts `{}` to `/api/auth/refresh`, then fetches
  `/api/users/me` with the new access token. A missing/expired refresh session
  leaves the user signed out. React Strict Mode shares one restoration attempt.
- Logout posts to `/api/auth/logout` with the Bearer token, then clears local
  state and navigates to `/login`. An expired access token can be refreshed once
  to complete server logout. A server/network failure still clears local state
  and displays that server sign-out could not be confirmed.

Access tokens stay in memory. Refresh credentials remain in the backend's
HttpOnly cookie; neither token is written to localStorage or sessionStorage.

The refresh cookie is a session cookie: login, successful administrator OTP
verification, and refresh omit both Max-Age and Expires. Logout still sends an
expired cookie to delete it. Existing persistent cookies are replaced on the next
successful login or refresh; log out and sign in after updating the backend to
verify the new cookie in browser tools.

Reloading the app restores staff sessions subject to server-side OTP enforcement.
Refresh checks the exact Supabase session's `AdminSessionVerification` before
returning credentials for either staff role. Every ADMIN `/api/admin/*` request
checks it again. Existing LEAD_DEV access tokens can still read operational data
without a proof; writes and refresh require the exact session's proof and return
`ADMIN_VERIFICATION_REQUIRED` when absent. Refresh
does not extend or recreate the eight-hour proof. Restarting the dev servers is
not a browser logout. Browsers with session restore can also retain session
cookies across browser restarts, so this cookie setting cannot guarantee a new
OTP after every restart; see [MDN's session-cookie behavior](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie#expiresdate_optional).

## API utility

`apiFetch(path, options)` accepts paths starting with `/`, relative to
`VITE_API_URL`. It returns a native `Response`; callers parse successful bodies.

```ts
import { apiFetch } from './lib/api'

const response = await apiFetch('/admin/users?page=1&pageSize=25')
const payload: unknown = await response.json()
// Validate the payload before using it in page state.
```

The utility preserves custom headers, adds the memory Bearer token, includes
credentials for backend-managed HttpOnly cookies, and sends
`X-CSRF-Protection: 1`. A protected request returning 401 shares one refresh with
other pending requests, then retries once with the new token. Failed refresh or
a second 401 invokes the Session Provider's logout flow. Auth endpoints never
automatically refresh, preventing loops and keeping invalid login errors inline.
Internal restoration requests can also opt out with `retryOnUnauthorized: false`.

`ApiError` exposes the HTTP `status`, backend `code`, and backend error message.
A permission-denied 403 or a failed retry caused by a network error does not clear
the session. `ADMIN_VERIFICATION_REQUIRED` instead invokes logout, requiring a
fresh password/OTP flow without looping through refresh.

Every fetch has a 10-second `AbortSignal.timeout` combined with caller cancellation.
Writes are never automatically replayed for timeouts or network failures. An
unrecoverable session displays “Your session has expired. Please log in again.”
during sign-out and retains the alert on the login screen.
A 204 needs no JSON parsing. Pending responses from a previous session are
discarded, so logout cannot be undone by a late refresh. Requests fail clearly
if `VITE_API_URL` is missing.

The backend supports browser password login, refresh, logout, and logout-all in
Supabase mode after Origin and CSRF validation, including the three admin OTP
endpoints. General registration, passwordless OTP and recovery remain native-only
in that mode. Staff accounts must be active and linked to confirmed Supabase
identities before they can sign in.

The Node test suite uses mocked fetch responses for token handling, retries,
concurrency, API errors, challenge validation, table responses and permissions.
The Chromium suite starts Vite on an ephemeral local port and intercepts every
API request, exercising the React session/router, OTP failures and cooldowns,
role restrictions, metrics, table actions, email reveal, dialogs and dark mode. Neither suite contacts
Render, Supabase or the local backend.

Set `ADMIN_WEB_SCREENSHOT_DIR=/tmp/admin-web-previews` when running the browser
suite to save selected desktop/mobile previews with mocked data.

## Static hosting

`npm run build --workspace=admin-web` writes `admin-web/dist/`. Configure the
web host to proxy `/api/*` to the backend before its SPA fallback. The Vite proxy
is development-only. Serve `index.html` for other non-file paths so direct visits
to routes such as `/users` work with `BrowserRouter`.

For Vercel, select `admin-web` as the project root, use the Vite preset, and keep
`VITE_API_URL=/api`. Copy `vercel.json.example` to `vercel.json` and replace
`REPLACE_WITH_BACKEND_HOST` with the real backend hostname before deploying. The
API rewrite must precede the SPA fallback. Set the backend's production
`AUTH_ALLOWED_ORIGINS` to the exact HTTPS admin origin and restart it. The existing
Secure HttpOnly SameSite=Strict refresh cookie requires this same-origin browser
API path; setting credentials alone on a cross-site API URL is insufficient.
The example is intentionally inactive until the actual production backend is known.

After configuring a deployment, run this read-only check (no sign-in or writes):

```bash
npm run check:deployment --workspace=admin-web -- https://your-admin-host
```

It verifies SPA deep links, backend JSON authentication denial through `/api`, and
the exact credentialed CORS preflight. Complete a password/OTP login and page reload
in a browser separately to verify HttpOnly cookie continuity. No deployment is
created or modified by the checker.

## Backend admin security integration

Both SuperAdmin and System Administrator sign in with a password plus the backend's
eight-digit email challenge. LEAD_DEV can read and manage operational devices;
platform controls remain ADMIN-only. See [the backend contracts](../backend/ADMIN_SECURITY.md).
