---
ticket: T-01
status: done
size: M
prd: .prd/prd-v1.md
depends_on: []
started: 2026-10-02T12:26:45Z
finished: 2026-10-02T12:31:33Z
---

## Objective

Establish the authenticated user and owner-scoped plant boundary so every later ticket works from a trusted identity and resource model.

## Context

- Relevant files: `backend/src/routes/auth.ts`, `backend/src/routes/plants.ts`, `backend/src/lib/auth.ts`, `backend/src/lib/ownership.ts`
- PRD section: `R-01` and `R-05`
- Implements: R-01, R-05

## Requirements

- Registration and login must create or validate sessions using the existing authenticated user model and must reject invalid credentials without revealing privileged details.
- Plant creation, listing, and access must be scoped to the active user and reject unauthorized attempts with a consistent resource-not-found or access failure.
- Server secrets and provider credentials must remain server-side. Preserve the existing platform-specific session contract: native clients receive refresh tokens only for storage in expo-secure-store (Keystore/Keychain), while web clients use Secure HttpOnly SameSite refresh cookies and never receive refresh tokens in JSON. Short-lived access tokens remain in memory on both platforms.

## Acceptance Criteria

- [x] A valid user can register, log in, and create a plant linked to that account.
- [x] Invalid credentials or malformed registration payloads return a clear rejection and do not create duplicate state.
- [x] A different user cannot read or mutate another user’s plant records.
- [x] Server secrets and provider credentials are absent from client-facing responses; native refresh tokens are stored only in SecureStore, web refresh tokens are delivered only through Secure HttpOnly SameSite cookies (never JSON), and access tokens remain in memory.

## Verification

Proves: This verifies the authentication and ownership boundary, including the reject path for bad credentials and cross-account access.

```bash
cd backend && node --import tsx/esm --experimental-test-module-mocks --test tests/auth.test.mjs tests/plants.test.mjs tests/security.test.mjs tests/ownership.test.mjs
cd ../frontend && node --import tsx --test tests/session.test.ts
```

## Constraints

- Do not broaden this ticket into provider or telemetry workflow changes.
- Do not weaken the owner-scoping model or invent a public device-provisioning path.

## Authorization

- User clarification (2026-10-02): "Yes, clarify T-01 to preserve native SecureStore tokens and web HttpOnly cookies. Update the ticket to reflect this, then continue."
