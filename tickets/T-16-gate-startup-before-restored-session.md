---
ticket: T-16
status: done
size: M
prd: .prd/prd-v4.md
depends_on: [T-15]
timeout: 600
started: 2026-10-07T13:43:03Z
finished: 2026-10-07T13:49:43Z
---

## Objective
Integrate splash and introductory onboarding ahead of session-dependent navigation.

## Context
Read frontend/app/_layout.tsx, frontend/app/splash.tsx, frontend/app/onboarding.tsx, frontend/context/auth.tsx and frontend/app/setup/_layout.tsx. Owns S-01–S-05, UI failure handling in S-08, preservation in S-10/S-12 and restore races in S-13.

Implements: R-01, R-02, R-03

## Requirements
- Mount the install provider outside the account-keyed tree. Establish deterministic cold-start routing and gate guest effects, deep links and Back navigation until intro completes.
- For an incomplete installation show the existing splash then all existing slides regardless of auth loading, success, rejection or offline error. Do not reset slide progress when auth generation changes.
- Save completion on the final slide before navigating; disable/coalesce repeated taps and show accessible retry for bootstrap/write failures without leaking raw errors.
- After completion use existing restoring/error/anonymous/guest/authenticated and garden setup behavior. A valid restored session skips login only; pending garden setup still resumes its saved step.
- Add frontend/tests/install-onboarding-routing.test.ts covering real component guards/effects, deferred restore/write races, forbidden direct links and guest navigation. Update existing characterization/navigation fixtures to supply completed install state explicitly.
- Keep splash timing, artwork, slide styling, accessibility and reduced-motion behavior consistent; no credential deletion or backend changes.

## Acceptance Criteria
- [x] Fresh anonymous launch shows splash → all slides → login; fresh valid-session launch shows splash → all slides → saved setup or Home.
- [x] Auth completion during slides, slow restore afterward, invalid credentials and offline recovery cannot flash Home or bypass onboarding.
- [x] Write/read failure and double taps cannot unlock routes; direct links and Back obey the gate.
- [x] Completed installations retain guest behavior, setup resume, account isolation and existing token storage.

## Verification
Proves: Actual root guards, intro actions and asynchronous transitions enforce intro precedence without breaking existing startup behavior.
```bash
set -euo pipefail
cd frontend
node --import tsx --test --test-concurrency=1 tests/install-onboarding-routing.test.ts tests/startup-characterization.test.ts tests/session-transitions.test.ts tests/local-state.test.ts tests/garden-navigation.test.ts
cd ..
npm run typecheck --workspace=frontend
```

## Constraints
Follow AGENTS.md: strict TypeScript without `any`, existing hooks/router and credential boundaries. No implementation beyond PRD v4, publishing, pushing or merging. Local commits for Pincer evaluation are authorized by AGENTS.md. Never claim planned tests or review obligations have already passed.
