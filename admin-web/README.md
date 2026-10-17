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
npm run build --workspace=admin-web
npm run preview --workspace=admin-web
```

## Scaffold contents

| Route | Page |
| --- | --- |
| `/login` | Email/password sign-in |
| `/dashboard` | Overview placeholder |
| `/users` | User management placeholder |
| `/devices` | Device management placeholder |
| `/audit` | Audit logs placeholder |

The root and unmatched paths redirect to `/login` when signed out and `/dashboard`
when authenticated. `RequireAuth` protects all four dashboard routes, including
audit logs, and waits for session restoration before rendering. Both `ADMIN` and
`LEAD_DEV` are admitted, matching the backend middleware. The topbar displays the
current email and maps `ADMIN` to `SuperAdmin` and `LEAD_DEV` to `Lead_Dev`.
User/device tables and dashboard data remain placeholders.

## Authentication

`useSession()` exposes `user`, `status`, `sessionError`, `login(email, password)`,
`logout()`, and `restoreSession()`.

- Login posts credentials to `/api/auth/login` and validates the response. A
  `USER` account is immediately logged out and receives
  `Unauthorized: Admin access required`. API errors appear on the sign-in form.
- On mount/reload, restoration posts `{}` to `/api/auth/refresh`, then fetches
  `/api/users/me` with the new access token. A missing/expired refresh session
  leaves the user signed out. React Strict Mode shares one restoration attempt.
- Logout posts to `/api/auth/logout` with the Bearer token, then clears local
  state and navigates to `/login`. An expired access token can be refreshed once
  to complete server logout. A server/network failure still clears local state
  and displays that server sign-out could not be confirmed.

Access tokens stay in memory. Refresh credentials remain in the backend's
HttpOnly cookie; neither token is written to localStorage or sessionStorage.

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
A 403 or a failed retry caused by a network error does not clear the session.
A 204 needs no JSON parsing. Pending responses from a previous session are
discarded, so logout cannot be undone by a late refresh. Requests fail clearly
if `VITE_API_URL` is missing.

The backend supports browser password login, refresh, logout, and logout-all in
Supabase mode after Origin and CSRF validation. Registration, OTP, and recovery
remain native-only in that mode. Staff accounts must already be active and linked
to confirmed Supabase identities before they can sign in.

The Node test suite uses mocked fetch responses for token handling, retries,
concurrency, API errors, and invalid session responses. It does not call Render
or a live auth provider.

## Static hosting

`npm run build --workspace=admin-web` writes `admin-web/dist/`. Configure the
web host to proxy `/api/*` to the backend before its SPA fallback. The Vite proxy
is development-only. Serve `index.html` for other non-file paths so direct visits
to routes such as `/users` work with `BrowserRouter`.
