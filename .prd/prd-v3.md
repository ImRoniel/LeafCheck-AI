---
version: 3
status: draft
date: 2026-10-03
---

# Restore usable authentication for scanner testing

Planning profile: standard. Authentication spans client networking, browser security, credential storage, session restoration and PostgreSQL. The failing platform is not yet confirmed, so a configuration correction needs investigation and integration evidence rather than an assumed password fix.

## 1. Problem

Original brief: "I CANNOT TEST IT BECAUSE I CANT LOGIN, PERHAPS WE ANALYZE THE AUTHENTICATION AND FIX THE BUGS". Follow-up: "I have manually run npx prisma generate and verified the typecheck passes. The Prisma client is now fully generated for Linux. Please resume planning the login bug fix".

Login prevents the user from reaching the scanner and completing PRD v2's platform trials. Preserve PRD v1/v2 and their evidence; this is a separate authentication change. Prisma generation and typechecking are resolved according to the user; generation is not proof that the configured database is reachable or its authentication schema is current.

Confirmed findings from this checkout:

- `frontend/.env.example` contains embedded whitespace in its actionable API URL. `resolveApiBaseUrl` checks only the scheme prefix, so malformed URLs can reach fetch and appear as generic connection failures.
- Safe inspection of loaded backend configuration found zero allowed browser origins. Calling the actual `clientMode` guard with the local HTTP preview origin and CSRF header returned `403 ORIGIN_REJECTED`, before credential verification. This establishes a local browser configuration blocker, not the cause of an unidentified native failure.
- Browser auth requires exact HTTPS origins, Secure HttpOnly SameSite Strict refresh cookies and Web Locks. Direct HTTP preview/backend instructions do not provide a complete supported browser setup.
- Existing auth tests mock PostgreSQL and mount routers separately. They protect credential/session logic but do not prove deployed CORS, browser cookie persistence, database connectivity or physical-device API reachability.

The user's exact platform, visible message and registration behavior remain unanswered. No credential mismatch, password-hash incompatibility or JWT defect has been established. No real user password, refresh token, database URL or provider secret was printed or used for login.

## 2. Solution

Trace the failing login from configured endpoint through transport, origin policy, credential validation, token persistence and profile loading. Fix confirmed configuration/validation defects, provide reproducible supported native and HTTPS browser setup, and add integration regressions at the boundaries missed by the current suite. Preserve the existing authentication architecture and visual design. Use a disposable test account for any real login trial; keep credential values out of evidence. Do not weaken browser security to make an unsupported HTTP deployment pass.

Assumption pending discovery answers: this is a behavior/setup fix with the current login appearance, not a redesign. The original request authorizes investigation and a scoped corrective plan; new infrastructure provisioning, dependency installation, database changes and security-policy changes are not implied.

## 3. Scope

| This PRD covers | This PRD does NOT cover |
| --- | --- |
| API URL validation and correct example/setup instructions | Authentication-provider replacement or dependency upgrades |
| Diagnosis of actual platform-specific login/registration failure | Password reset, OTP, social login or new account features |
| Correct configuration of existing browser origin/cookie and native storage contracts | Insecure cookie fallback, CORS wildcard or browser native-mode bypass |
| Safe auth error/retry behavior and integration coverage | Scanner lifecycle changes or waiver of PRD v2 camera evidence |
| Read-only database/client prerequisite diagnosis | Database migration/reset, account deletion, password resets or secret rotation |

## 4. Requirements

### R-01 — Validate and document a reachable API configuration

- **S-01:** Given a valid configured API endpoint for an emulator, physical device or supported browser deployment, when the client initializes and login is submitted, then it sends the request to the intended normalized endpoint; the example configuration contains no embedded whitespace or machine-specific private address.
- **S-02:** Failure path: malformed endpoints, unsupported schemes, embedded credentials and invalid authority are rejected before credential transmission, with a safe recoverable configuration failure rather than an uncaught initialization crash or misleading invalid-password result. Operator diagnostics identify the failing category without printing endpoint credentials or secrets.
- **S-03:** Preserve: environment configuration remains authoritative; existing documented emulator defaults and trailing-slash normalization continue working. Physical-device instructions explicitly require a reachable configured host; Expo tunnel access is not presented as API reachability.

### R-02 — Make supported browser authentication reproducible

- **S-04:** Given a supported secure browser context and reachable same-site HTTPS API with an explicitly configured exact frontend origin, when a test user logs in and requests their profile, then the session becomes authenticated; reload restores it using the HttpOnly refresh cookie. Setup instructions explain TLS termination and origin configuration consistently without requiring a new dependency or hardcoded host.
- **S-05:** Failure path: an unlisted origin, missing CSRF header, unsupported insecure context or absent Web Locks produces a bounded safe error and no authenticated state. A browser request cannot select native token mode through a header; after correcting supported setup, retry succeeds.
- **S-06:** Preserve: access JWTs stay in memory; browser refresh tokens never enter JSON responses or JavaScript storage. Secure HttpOnly SameSite Strict host-cookie properties, exact-origin CORS and cross-tab coordination remain intact. Arbitrary HTTP/LAN browser auth is not enabled.

### R-03 — Preserve native credential handling and recoverable login behavior

- **S-07:** Given reachable API configuration and valid credentials for an active native test account, when login completes, then the refresh token is securely persisted and the profile is validated before private navigation is enabled; the scanner is accessible after any existing onboarding requirements. Logout clears local credentials and revokes the session through the existing contract.
- **S-08:** Failure path: wrong credentials, server unavailability, secure-storage failure or profile failure yields an appropriate safe message, releases submission locks and permits the existing retry/sign-in/guest recovery path without issuing duplicate authentication or exposing partial authenticated UI. Profile retry after successful token issuance does not resubmit the password or create a second session.
- **S-09:** Preserve: email normalization, exact password whitespace, Argon2 compatibility, inactive-user rejection, single-flight refresh, replay revocation, account isolation and guest restrictions continue passing existing tests.

### R-04 — Establish the actual blocker and verify the integrated path

- **S-10:** Given the reported failing platform and configuration, when diagnosis is performed, then evidence identifies the failing boundary and a regression reproduces any code defect before its correction. If the blocker is configuration alone, record the supported correction and actual login outcome rather than claiming an unobserved password bug. A read-only prerequisite check distinguishes client availability, DB connectivity and auth-schema availability without modifying data.
- **S-11:** Failure path: startup/configuration/database/origin failures remain distinguishable in safe operator diagnostics and generic to unauthenticated callers. Missing prerequisites are reported explicitly; passing mock tests never substitutes for a real login trial. Any required platform access that is unavailable remains unverified and blocks its delivery claim.
- **S-12:** Preserve: full frontend/backend tests and typechecks pass; PRD v2 scanner regressions stay green. Successful authentication unblocks scanner access but does not establish camera correctness or close PRD v2's outstanding platform obligations.

## 5. Architecture

### Structure and ownership

Expected paths: `frontend/services/api.ts` (endpoint validation), `frontend/.env.example` and frontend setup docs (configuration), `frontend/services/session.ts`, `frontend/services/browser-coordination.ts`, `frontend/app/login.tsx` and `frontend/app/_layout.tsx` (only confirmed session/error defects), `backend/src/lib/auth-config.ts` and `backend/src/server.ts` (configuration diagnostics/integration), existing auth/session/API tests and focused new integration tests.

Read-only database inspection follows the available Prisma client skill and installed Prisma 6 patterns, not the skill's newer adapter examples. PostgreSQL `User`, `AuthSession` and `RefreshToken` hold auth state through `prismaPg`; MongoDB holds sensor readings. Both schemas were read. No schema change is proposed.

### Data flow and recommendation

Configured endpoint → client URL validation → login submission → supported browser origin/CSRF or explicit native mode → credential verification → existing session creation → secure refresh persistence → profile validation → existing Router guards → private app/scanner.

Keep the current API/session/storage abstractions. Recommend an existing trusted HTTPS frontend/API arrangement for browser testing; document its contract and exact allowed origin. Keep native explicit reachable-host setup separate. New TLS proxy provisioning or tooling is a material decision if no supported HTTPS arrangement exists; prepare that proposal and obtain authorization before adding infrastructure. Permitting insecure browser cookies is excluded.

Provider validation currently exits the entire backend before listening when AI credentials are invalid. Treat it as a startup prerequisite to diagnose, not a confirmed login defect. Decoupling AI startup would change existing provider fail-fast behavior and requires a separate architecture decision; this draft preserves it.

### Verification baseline, blast radius and rollback

Planning baseline on 2026-10-03: `npm test --workspaces` passed 163 frontend and 60 backend tests outside the sandbox. The user independently reports generated Linux Prisma clients and passing typechecks. Targeted frontend API/session tests also passed. No live database login or native/browser login trial was performed during planning. No current `ARCHITECTURE.md` was found; source and Prisma schemas take precedence over README's older database overview.

The load-bearing boundaries are shared API construction, startup config, browser refresh rotation, native SecureStore and root route gating. Changes here can affect all authenticated screens and registration. Revert scoped source/docs/test changes to roll back; no database migration or credential changes are planned. Any discovered need to mutate deployed DB state is surfaced before implementation.

## 6. Success Criteria

| Criterion | Verification |
| --- | --- |
| Actual login blocker is documented and corrected | Safe reproduction on reported platform; real test-account login and profile request |
| Endpoint/config regression covered | URL/config tests for malformed and valid platform configurations |
| Browser security and native storage preserved | Existing auth/session tests plus real HTTP origin/preflight/profile integration assertions |
| Login restores and recovers correctly | Platform trial: login, profile/private screen, reload/restore, failure/retry, logout |
| Candidate-wide regressions green | `npm test --workspaces`, frontend typecheck, backend `tsc --noEmit` |
| Scanner can be reached again | Authenticated test-account entry; camera trials remain under PRD v2 |

Do not put credentials, tokens, environment dumps or request-body captures in logs/screenshots. Record exact tested platform and secure-context arrangement. Mocks cannot prove browser cookie acceptance or real PostgreSQL availability.

## 7. Out of Scope

No design overhaul, auth bypass, insecure refresh storage, raw SQL, dependency upgrades, schema migration, real-account modification, password reset/OTP implementation, unrelated audit repairs or camera changes. No requirement was cut or deferred. No time budget was supplied. PRD v2 remains completed in implementation and blocked in evaluation.

## 8. Visual Direction

Keep the current calm, clear, familiar login/register presentation, existing typography, colors and controls. Preserve busy-state feedback and actionable safe error/retry UI. Do not expose operator setup details, hosts, database configuration or secrets in product flows. A design preference question was asked; keeping the current design is an assumption while its answer remains pending.

## 9. Security & Trust Boundaries

Credentials, route input, HTTP headers and provider responses are untrusted. Backend validation, ownership and session checks remain authoritative. Hashing/signing and database/provider secrets remain server-side; native refresh credentials use SecureStore and browser refresh credentials use Secure HttpOnly cookies. No token is persisted to browser storage. Generic public errors stay separate from secret-free operator diagnostics. Never log passwords, JWTs, refresh credentials or raw Prisma error data.

## 10. Dependencies & Risks

No new package or version change is proposed. Local installed contracts govern implementation. Read-only registry checks on 2026-10-03 returned Expo 57.0.26, Expo Router 57.0.24, jose 6.2.12 and Express 5.2.1; these are latest-registry observations, not an upgrade plan. The repo retains its existing Express 4 and Prisma 6 architecture.

External contract verification: [Web Locks documentation](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API) describes secure-context support and origin-scoped locks; [Set-Cookie documentation](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie) describes Secure/HttpOnly/SameSite and host-cookie requirements. Keep browser/server behavior consistent with these contracts.

Remaining risks: actual device/platform unknown; TLS certificates and same-site deployment unavailable in this environment; DB generation does not establish connectivity/migrations; browser cookie restrictions and secure-storage availability differ from mocks. Existing dependency-audit findings remain separate work. Platform uncertainty must be resolved before claiming end-to-end delivery. This planning request does not authorize changing security policy or provisioning an external service.
