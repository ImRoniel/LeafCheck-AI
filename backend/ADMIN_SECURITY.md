# Admin backend security and CRUD foundation

The browser continues to use Express through `/api`. Access tokens stay in memory;
refresh credentials use the Secure HttpOnly `__Host-leafcheck-refresh` cookie.
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

Device responses for LEAD_DEV omit the whole owner object and owner-based filters
are forbidden. Claiming devices and mutating plants/pairings/demo telemetry through
mobile-facing routes are also denied for LEAD_DEV. USER ownership checks remain
in effect on those routes. Hardware ingestion retains its separate existing policy.

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

The next frontend step must handle the 202 response and provide an OTP screen;
the existing React login implementation expects a completed 200 response.

## User CRUD and audits

| Endpoint | Contract |
| --- | --- |
| GET `/api/admin/users` | Existing pagination/search/filter envelope; users.read |
| POST `/api/admin/users` | `{email,password,name?,role?,isActive?}`; defaults USER/active; 201 `{data,meta}` |
| PATCH `/api/admin/users/:id` | Nonempty subset of `{name,role,isActive}`; 200 `{data,meta}` |
| DELETE `/api/admin/users/:id` | Empty body; 204 |
| GET `/api/admin/audit` | `{data,pagination,meta}`; audit.read |

The audit query supports `page`, `pageSize` (maximum 100), `action`, `actorId`,
`targetId`, `from` and `to`. Results sort by descending timestamp with an ID tie
break. There is no audit mutation endpoint. Events contain allowlisted metadata,
actor/target IDs, time and IP; no passwords, OTPs, challenge credentials or JWTs.
An actor's deletion sets the audit FK to null while retaining the original actor
ID in immutable event metadata. New logs begin at rollout; old application events
cannot be reconstructed.

Manual creation provisions a confirmed Supabase identity server-side and links
its immutable provider ID to the new application user. The required legacy
password column receives a random unusable credential. Failed PostgreSQL creation
triggers provider cleanup; a failed cleanup returns
`PROVISIONING_CLEANUP_REQUIRED` for operator review. Supabase keys stay server-side.

User updates and their audits commit together. Administrators cannot ban or delete
themselves, and the last active SuperAdmin cannot be demoted. Authorization is
checked again inside serializable mutation transactions.

Deletion first disables the account and records `USER_DELETE_REQUESTED`, then
deletes the provider identity, then deletes application data with a completion
audit. Provider failure returns `USER_DELETE_PENDING` and leaves the account
disabled for a retry. Existing PostgreSQL cascades apply to user-owned data.
Telemetry retains the existing MongoDB retention policy. There is no distributed
transaction spanning Supabase Auth and application PostgreSQL.

## Database and verification

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
