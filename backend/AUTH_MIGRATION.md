# Supabase auth: additive mobile implementation

This change adds email-code registration, optional email-code login and password
recovery behind `AUTH_PROVIDER=supabase`. The deployed setting remains `legacy`.
No account import, identity linking, session cleanup or production cutover is part
of this change. Email change, logged-in password change and administrator work
remain deferred.

## Configuration

Render already has the required `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
`SUPABASE_SECRET_KEY` and `AUTH_PROVIDER=legacy`. Keep the existing legacy JWT,
origin and database settings. No additional frontend environment variables are
needed: native clients use `EXPO_PUBLIC_API_URL` to call Render directly.
Provider keys and credentials never go to Expo.

Before testing the Supabase path on an isolated staging project:

1. Enable Email and Confirm email in Supabase Authentication → Sign In / Providers.
2. Keep the working custom Gmail SMTP configuration. No SMTP credentials are
   required in Render; Supabase sends the mail.
3. In Authentication → Email Templates, configure **Confirm signup**, **Magic
   Link**, and **Reset Password** to display `{{ .Token }}`. Do not use a
   confirmation-link button as the only way to complete these flows. Set the
   email OTP length to **8**; use a short expiration such as 600 seconds and
   keep Supabase email/verification rate limits enabled. An invite delivery test
   alone does not verify these three templates.
   The matching HTML sources are [confirm-signup.html](supabase/templates/confirm-signup.html),
   [magic-link.html](supabase/templates/magic-link.html), and
   [reset-password.html](supabase/templates/reset-password.html). Paste each body
   into the corresponding hosted dashboard template. `{{ .Token }}` must remain
   unchanged so Supabase renders the complete configured eight-digit code,
   including leading zeros; templates do not set the OTP length themselves.
4. Set the access JWT expiration to 900 seconds. The BFF enforces a maximum token
   age of 15 minutes and a maximum session age of 30 days, including free plans.
5. Use the same project's primary PostgreSQL connection for application data and
   the separate auth read client. The database role must be able to SELECT
   `auth.sessions` and `auth.users`; replica lag must not delay revocation.
6. An asymmetric signing key uses the project's pinned JWKS URL. Existing HS256
   Supabase tokens are verified by the Supabase Auth `/user` endpoint. Do not
   copy or replace the application's legacy `AUTH_JWT_SECRET` with Supabase's
   JWT secret. Both paths additionally check the live session and database user.

There is no Vercel proxy, OAuth redirect, external deep-link callback, new browser
cookie flow or provider SDK in Expo. Codes are entered in native screens and
submitted to Express. Existing legacy browser cookies retain their behavior;
the new Supabase path accepts native auth requests only.

## Schema and deployment sequence

`prisma/schema.postgres.prisma` adds only nullable `User.supabaseUserId` (unique)
and `User.emailVerifiedAt`. The required password column is unchanged.
`prisma/schema.auth-read.prisma` is a query-only projection of Supabase-owned
tables; **never run migrate or db push with this schema**. Its facade exposes
only reads. The application database credential retains its existing permissions;
this facade is not a separately provisioned read-only database role.

`npm run build --workspace=backend` generates and packages both PostgreSQL
clients and compiles the API. Legacy queries explicitly select pre-existing
columns, so the new application can run with `AUTH_PROVIDER=legacy` before the
additive migration is applied. Existing login/register/refresh/logout contracts
and legacy session rotation are preserved in that mode. No migration runs at
server startup or as part of the build.

Future operator sequence, outside this implementation:

1. Deploy the build with `AUTH_PROVIDER=legacy` and verify legacy authentication.
2. Apply **only** the reviewed PostgreSQL additive migration through the normal
   migration process. Do not reset or recreate the database.
3. Rehearse an import on a temporary isolated database and Supabase project, using
   staging mailboxes. An application database copy alone is insufficient if Auth
   still points at the production project.
4. Review an explicit import/linking plan for the preserved account before any
   account import. Link a provider ID to the existing application row; never
   replace its primary key or relink Plant/Device/AIAnalysis rows by email.
5. Only after that approval and successful acceptance, change the provider switch
   for cutover. Legacy sessions are rejected in Supabase mode but are not deleted.

The preserved account is `cuaresmaroniel27@gmail.com`, application User.id
`2da2cd1a-e594-43cc-a165-552342882246`, with 2 plants, 2 devices and 5 scans.
No runtime module automatically maps an existing application email to a provider
identity. A collision requires explicit migration. New provider users get a new
application User only after successful confirmation, role USER, and a random
unknowable Argon2 credential to satisfy the required legacy password column.

Returning `AUTH_PROVIDER` to `legacy` restores legacy credential handling while
the additive columns remain harmless. No session rows need restoring because
this change never deletes or rewrites them. Supabase password resets do not
rewrite legacy hashes: rollback would restore the account's **old legacy
password**, not its subsequently changed Supabase password. Newly registered
Supabase accounts cannot use their Supabase password for legacy login.

## Native endpoint contracts

All auth requests send `X-Auth-Client: native`, JSON bodies, no browser cookies;
all auth responses are `Cache-Control: no-store`.

| Endpoint | Body | Success in Supabase mode |
| --- | --- | --- |
| GET `/api/auth/capabilities` | none | 200 `{provider,emailOtp,passwordRecovery}` |
| POST `/api/auth/register` | `{email,password,name?}` | 202 verification challenge; no tokens or application User yet |
| POST `/api/auth/login` | `{email,password}` | Existing 200 token envelope + safe application user |
| POST `/api/auth/refresh` | `{refreshToken}` | Existing 200 `{accessToken,refreshToken,expiresIn}` |
| POST `/api/auth/logout` | `{}`, bearer access token | Existing empty 204, only after live revocation confirmed |
| POST `/api/auth/logout-all` | `{}`, bearer access token | Existing empty 204, all provider sessions revoked |
| POST `/api/auth/forgot-password` | `{email}` | Generic 202 `{message,resendAfter:60}` |
| POST `/api/auth/reset-password` | `{email,code,newPassword}` | Empty 204; recovery credentials never returned; all provider sessions revoked |
| POST `/api/auth/otp/request` | `{email}` | 202 login challenge; never creates a provider user |
| POST `/api/auth/otp/resend` | `{email,type}` | 202 challenge (generic recovery message for recovery) |
| POST `/api/auth/otp/verify` | `{email,code,type}` | 200 existing token envelope + safe application user |

A challenge is `{status:"verification_required",email,purpose,resendAfter:60}`;
`purpose` is `registration` or `login`. Codes are eight-digit strings (leading
zeros preserved), passwords are 8–128 Unicode characters with whitespace kept,
and unknown JSON fields are rejected. Recovery and passwordless initiation give
the same response for unknown or unmigrated accounts and send no mail for those
accounts. These new POST routes return 503 while the legacy switch is active;
capabilities hides the corresponding login controls. Supabase registration's
verification challenge is the deliberate provider-specific response; legacy
registration still returns its original 201 session.

OTP requests carry the exact Supabase type: `signup` for registration, `magiclink`
for email-code login, and `recovery` for recovery. The backend forwards it without
substituting a different type. Existing purpose-only clients remain supported;
conflicting `type` and `purpose` values are rejected. Register, password login,
refresh, logout and password reset contracts are unchanged.

Registration and email-code login navigate from the pending verification state,
with email, type and display message in native route parameters. The public
navigator stays mounted during authentication transitions; account and guest
isolation still remount private data. Successful verification opens Home only
after the session and application profile are loaded. A wrong or expired code
returns `400 INVALID_CODE` with “Invalid or expired code. Request a new one.”
Resend retains the original type, uses a minimum 60-second deadline in memory,
and keeps that deadline across screen remounts. Supabase also enforces its email
rate limits. Password recovery continues through the existing reset-password
screen and endpoint, with `type=recovery` on its native route.

Expo holds access tokens only in the coordinator's memory. SecureStore holds
only the refresh token. Old `access_token` entries are deleted without reading
them, and cold starts refresh before loading the application profile. Navigation
never unlocks private screens merely because a stored credential exists.
Pending verification contains only email/purpose/cooldown in memory. Email codes
and passwords never go into navigation parameters or persistent storage.

## Read-only rehearsal report

From the repository root, after generating the clients:

```sh
npm run auth:migration:dry-run --workspace=backend -- --output ../docs/auth-phase1-dry-run.json
```

Only `--output <path>` is supported; no import/apply mode exists. The script
performs Prisma reads, rejects model mutation operations, compares before/after
fingerprints and writes only the local JSON report. It never calls an Auth API
that sends email, imports a hash, links an identity or deletes a session. Run it
against a quiescent database if comparing whole-table counts. Concurrent changes
are flagged rather than repaired. No password hashes, salts, refresh tokens or
API keys are emitted.

The verified local report showed `identityMatches:true`, observed counts
`{plants:2,devices:2,scans:5}`, `databaseWrites:0`, `preservation.unchanged:true`,
`additiveMigration:"pending"`, and no matching Supabase identity. Live totals were
3 users, 28 sessions and 112 refresh tokens; they differ from the older snapshot
in the planning conversation. The Argon2 header has `m,p,t` parameter order, so a
future import plan must review canonical ordering without changing the hash.

## Verification and live acceptance

```sh
npm test --workspace=backend
npm test --workspace=frontend
npm run build --workspace=backend
npm run typecheck --workspace=frontend
```

Backend tests use a stateful simulated Auth service, signed JWTs, live-session
read doubles and the real Express routes; they cover one-time registration and
recovery codes, password replacement/old-password rejection, passwordless login,
identity collisions, database roles, account disabling, expiration and immediate
logout. Legacy tests explicitly run with the legacy provider. Frontend tests
exercise the real screens, API client and coordinator, including verification
retry/cancel, refresh-only restoration, and denial of persisted access tokens.

These tests do not certify real Supabase SMTP/template configuration or iOS and
Android Keychain behavior. On an isolated staging project/device, complete a new
registration using the delivered code, restart to restore via refresh, log in by
email code, reset a password, reject the old password, confirm old access/refresh
tokens fail immediately, and verify the preserved account's relations before and
after an approved rehearsal. Never reset or import the preserved production
account just to test this implementation.

Official references: [email templates](https://supabase.com/docs/guides/auth/auth-email-templates),
[session revocation](https://supabase.com/docs/guides/auth/sessions),
[signing keys](https://supabase.com/docs/guides/auth/signing-keys).
