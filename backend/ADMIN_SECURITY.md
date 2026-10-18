# Admin backend security and CRUD foundation

The browser continues to use Express through `/api`. Access tokens stay in memory;
refresh credentials use the Secure HttpOnly SameSite=Strict
`__Host-leafcheck-refresh` session cookie. Successful issuance and rotation omit
Max-Age and Expires; logout retains its expired-cookie deletion response.
`AUTH_PROVIDER=supabase` is required for SuperAdmin authentication. The implemented
second step is password plus an eight-digit **email OTP**, not Supabase native
MFA/AAL2. LEAD_DEV retains password authentication and operational device reads.

## Permissions

| Role | Permissions |
| --- | --- |
| ADMIN | users.read, users.manage, devices.read, devices.manage, audit.read |
| LEAD_DEV | devices.read |
| USER | No admin permissions |

Every `/api/admin` request passes current-user authentication, staff authorization,
and `requireAdminVerification` before reaching its route. The verification check
requires ADMIN to have a live, unexpired record for that exact Supabase session;
LEAD_DEV proceeds to its read-only permission check without OTP. Legacy ADMIN
password and refresh requests cannot issue credentials. Verification expires
after eight hours and refresh does not extend it. Access JWTs retain the existing
15-minute maximum age.

Browser refresh also checks this proof before returning any token. An already
refreshed, unexpired JWT still receives `403 ADMIN_VERIFICATION_REQUIRED` on every
admin route if the proof is subsequently removed, expired, or tied to another
session. Cookie persistence does not replace either verification check.

App reloads and dev-server restarts may restore an existing verified session.
Session cookies normally last for the browser session, but browsers may restore
them with their session-restore feature; see [MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie#expiresdate_optional).
An unconditional OTP-on-browser-restart policy cannot be guaranteed by cookie
attributes alone. Existing persistent cookies become session cookies on their
next successful issuance or refresh; signing out and back in replaces them now.

Device responses for LEAD_DEV omit the whole owner object and owner-based filters
are forbidden. Claiming devices and mutating plants/pairings/demo telemetry through
mobile-facing routes are also denied for LEAD_DEV. USER ownership checks remain
in effect on those routes. Hardware ingestion retains its separate existing policy.

## Telemetry hardware trust boundary

`POST /api/telemetry` relies on MAC/Device ID whitelisting: hardware must be
approved in the provisioning registry and claimed before its readings are
accepted. The fixed ESP32 firmware does not send a cryptographic device
credential, so uploads lack cryptographic hardware attestation. Knowing an
approved, claimed identifier is sufficient to impersonate that sensor; the
whitelist does not authenticate the physical sender. This is an acknowledged
firmware constraint for the defense, not a guarantee of telemetry authenticity.
Use controlled hardware and network access during the demonstration.

## Authentication contracts

All browser auth mutations require an exact allowed Origin and
`X-CSRF-Protection: 1`; cookies are included. Native requests retain their existing
explicit client mode. Challenges are bound to their original client and Origin.

| Request | Response |
| --- | --- |
| POST `/api/auth/login`, LEAD_DEV | 200 existing access-token/user envelope and refresh cookie |
| POST `/api/auth/login`, ADMIN | 202 `{status:"otp_required",challengeToken,maskedEmail,expiresAt,resendAfter}`; clears refresh cookie |
| POST `/api/auth/verify-admin-otp` `{challengeToken,code}` | 200 existing token/user envelope and refresh cookie |
| POST `/api/auth/admin-otp/resend` `{challengeToken}` | 202 challenge timing; 429 during cooldown |
| POST `/api/auth/admin-otp/cancel` `{challengeToken}` | 204; repeated cancellation is idempotent |

The password grant's provisional provider session is revoked before sending the
challenge. Challenge tokens contain 256 random bits; only their SHA-256 hashes
are persisted. Neither a challenge nor a successful password alone authorizes an
admin request. The backend looks up the email and expected identity itself.
Only the dedicated verification endpoint can create an admin verification record.

Challenges expire in five minutes and allow five combined verification/resend
attempts. Resends have a persisted 60-second cooldown and do not extend the expiry
or reset attempts. Starting another challenge consumes earlier pending challenges;
starts are limited to five per account per 15 minutes. Verification is consumed
transactionally with its session proof and audit event. Cancellation, replay,
account changes and concurrent attempts cannot authorize a second session.

Role/status changes and password resets increment the account security version
and record a session-creation cutoff. Existing provider and legacy sessions cannot
survive that cutoff, including after an account is unbanned. Pending challenges
and verification records are invalidated. Logout removes verification records and
clears the browser cookie before attempting provider revocation.

The React session provider handles the 202 response, keeps the challenge in memory,
and routes to `/login/otp`. Only successful verification establishes its session.

## User CRUD and audits

| Endpoint | Contract |
| --- | --- |
| GET `/api/admin/users` | Pagination/search/filter envelope; users.read; `revealEmails=true` opts into full emails |
| POST `/api/admin/users` | `{email,password,name?,role?,isActive?}`; defaults USER/active; 201 `{data,meta}` |
| PATCH `/api/admin/users/:id` | `updatedAt` plus a nonempty subset of `{name,role,isActive}`; 200 `{data,meta}` |
| DELETE `/api/admin/users/:id` | Empty body; 204 |
| GET `/api/admin/audit` | `{data,pagination,meta}`; audit.read |
| GET `/api/admin/stats` | Aggregate platform counts; users.read OR devices.read |
| GET `/api/admin/health` | `{postgres:"ok"\|"down",mongo:"ok"\|"down",api:"ok"}`; users.read OR devices.read |

The audit query supports `page`, `pageSize` (maximum 100), `action`, `actorId`,
`targetId`, `from` and `to`. Results sort by descending timestamp with an ID tie
break. There is no audit mutation endpoint. Events contain allowlisted metadata,
actor/target IDs, resolved `actorEmail`/`targetEmail`, time and IP; no passwords,
OTPs, challenge credentials or JWTs. Actor email uses the current User relation;
target emails use one bounded lookup for the page, inside the read transaction.
IDs remain in the response for traceability. Deleted accounts return null emails;
historical emails are not reconstructed or added to stored event metadata.
An actor's deletion sets the audit FK to null while retaining the original actor
ID in immutable event metadata. New logs begin at rollout; old application events
cannot be reconstructed.

User lists always include `emailMasked`. Full `email` is present only when
`revealEmails=true`; false or omission retains the masked response. Existing
SuperAdmin permission/session verification and no-store headers cover both modes.

Stats return `{data:{totalUsers,totalDevices,totalPhysicalDevices,activeDevices,totalActiveDevices,totalPlants,totalAiScans},meta}`.
`activeDevices` is the preferred name; `totalActiveDevices` is retained as a
compatible alias. `totalDevices` includes all registered devices, including demos;
`totalPhysicalDevices` excludes demos so the UI can explain the denominator.
Counts describe currently retained database records, rather than lifetime counters
after deletion. Both staff roles may read aggregate counts; LEAD_DEV still cannot
read user records, full addresses, or audit entries. PostgreSQL counts and
registered physical MACs are read in a RepeatableRead transaction. MongoDB Prisma
groupBy queries (batches of at most 500 MACs) find latest timestamps. Active means
a physical device seen within 30 minutes, allowing 60 seconds of future clock
tolerance. Demo/unregistered devices are excluded. A MongoDB failure returns null
active devices with `meta.telemetryDegraded=true`, retaining other totals. Meta
includes the observation time and freshness window; the two databases are not one
atomic snapshot. These additions require no schema changes or migration.

Health uses the PostgreSQL Prisma client's constant `SELECT 1 AS ready` and the
MongoDB Prisma client's `{ping:1}` command, with independent 2.5-second deadlines.
It returns only readiness states; errors and connection details are never exposed.
It shares the admin router's authentication, verification, permissions and no-store
headers. If PostgreSQL is unavailable for authentication itself, the router denies
the request before readiness runs; the frontend shows database status Unknown.

Manual creation provisions a confirmed Supabase identity server-side and links
its immutable provider ID to the new application user.

`isActive` accepts only a boolean and defaults to true when omitted. An explicit
false creates a banned account, records that status in USER_CREATED, and prevents
application sign-in immediately. Provider IDs and email verification timestamps
are server-managed and rejected if supplied in the create request.

The required legacy password column receives a random unusable credential. Failed PostgreSQL creation
triggers provider cleanup; a failed cleanup returns
`PROVISIONING_CLEANUP_REQUIRED` for operator review. Supabase keys stay server-side.

User updates and their audits commit together. Administrators cannot ban or delete
themselves, and the last active SuperAdmin cannot be demoted. Authorization is
checked again inside serializable mutation transactions.

Every PATCH requires the exact ISO `updatedAt` read from the list/detail response.
The service compares it inside the serializable transaction, before any write or
audit. Mismatches return `409 CONFLICT` with “This user was modified by another
administrator. Please refresh.” Successful changes advance the timestamp even
within one millisecond. No schema migration is required. Clients must submit only
the fields they intend to change; name-only edits must not resend an old role.
Input errors may include allowlisted `fieldErrors` for form feedback. Provider
provisioning maps known weak-password/email codes to safe local messages, rather
than returning upstream diagnostics; public authentication errors remain generic.

Deletion first disables the account and records `USER_DELETE_REQUESTED`, then
deletes the provider identity, then deletes application data with a completion
audit. Provider failure returns `USER_DELETE_PENDING` and leaves the account
disabled for a retry. Existing PostgreSQL cascades apply to user-owned data.
Telemetry retains the existing MongoDB retention policy. There is no distributed
transaction spanning Supabase Auth and application PostgreSQL.

## Database and verification

When `AUTH_PROVIDER=supabase`, startup validates `SUPABASE_URL`,
`SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SECRET_KEY` before listening. Missing or
blank values and malformed Supabase origins stop startup with a safe diagnostic.
The same validator is used for runtime provider requests.

Production can accept local admin requests only when both
`AUTH_ALLOW_LOCAL_ADMIN_ORIGIN=true` and the exact origin `http://localhost:5174`
are configured in `AUTH_ALLOWED_ORIGINS`. Existing HTTPS allowlist entries remain
valid. The opt-in permits no other HTTP origins and leaves browser CSRF checks
in place. Global CORS rejection returns `403 ORIGIN_REJECTED`.

Security tables live in the private `admin_security` schema, outside Supabase's
public Data API. Do not expose this schema or grant client roles access. Existing
domain tables remain in `public`. The provider-owned `auth` schema remains read-only
and must never be migrated through `schema.auth-read.prisma`.

The additive migration was generated with Prisma `migrate dev` against owned,
disposable local PostgreSQL. It adds the private schema, three tables and account
security columns. No database reset or historical migration rewrite is needed.
The hosted migration history also contains `20260831072154_init_leafcheck`, which
is absent locally; retain that history. The reviewed migration
`20261017070253_admin_security_foundation` was applied with `migrate deploy`.
Before/after checks preserved the original user-data fingerprint and counts:
2 users, 2 devices, 2 plants, 5 analyses and 14 care tasks. No provider authentication
requests or emails were sent during hosted database verification.

```sh
npm run build --workspace=backend
npm test --workspaces --if-present
npm run test:admin-security --workspace=backend
npm run test:plant-pairing --workspace=backend
npm run test:plant-telemetry --workspace=backend
npm run test:scan-persistence --workspace=backend
npm run test:telemetry-schema --workspace=backend
```

The security integration runner creates and verifies ownership of its own local
PostgreSQL container, applies the actual new migration, uses a simulated Supabase
provider, and removes its container on completion. Tests cover role restrictions,
the full OTP exchange, challenge races, cancellation during verification, session
invalidation, atomic CRUD audits/creation cleanup, concurrent demotions and audit
retention on deletion. No live Render API or provider emails are used by tests.

Supabase must be configured for eight-digit email codes and a template containing
the complete `{{ .Token }}`. Hosted SMTP delivery and browser OTP acceptance remain
separate integration checks.

## Verification receipt — 2026-10-17

Backend build and `git diff --check` passed. All 858 tests passed:

| Suite | Passed |
| --- | ---: |
| Backend unit / simulated-provider / proxy | 286 |
| Mobile | 487 |
| Admin web | 10 |
| Real PostgreSQL admin security | 7 |
| Real PostgreSQL pairing / ingestion | 12 |
| Real PostgreSQL/MongoDB plant telemetry | 19 |
| Real PostgreSQL/MongoDB scan persistence | 18 |
| Real PostgreSQL/MongoDB migration / telemetry schema | 19 |

All integration databases were owned, disposable local containers and were removed.
The hosted additive migration succeeded and existing data preservation checks passed.
Restart the local backend to load the new handlers before testing the OTP contract.
