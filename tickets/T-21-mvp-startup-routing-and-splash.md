---
ticket: T-21
status: done
size: M
prd: .prd/prd-v6.md
depends_on: [T-20]
timeout: 600
started: 2026-10-11T02:55:56Z
finished: 2026-10-11T02:58:06Z
---

## Objective
Integrate the strict three-state startup routing with a brief branded Splash on every cold launch while preserving verified auth and account isolation.

## Context
Implements: R-02, R-03, R-04
Owns UI preservation/recovery in S-05/S-06 and S-07–S-12.
Read frontend/app/_layout.tsx, app/index.tsx, app/splash.tsx, app/onboarding.tsx, app/setup/_layout.tsx, context/install-onboarding.tsx, context/auth.tsx, services/session.ts and relevant startup/onboarding tests. Existing startup guards and entry redirects force pending authenticated garden setup; both must change together. Auth restoration validates a SecureStore refresh credential with existing server refresh/profile checks.

## Requirements
- Every cold launch shows existing Splash for at least the existing two-second duration while flag/session checks run. Track this per startup, with timer cleanup; rerenders must not restart it indefinitely.
- After flag read and minimum splash, missing/false reveals slides regardless of auth restore outcome; incomplete intro blocks protected/deep-linked Login/Dashboard navigation. Preserve current slide progression when auth changes.
- Completion writes must succeed before routing. For completed intro, wait for restore then show Login when signed out or Dashboard when authenticated, including pending garden setup. Never treat nonempty credentials as a verified session.
- Remove forced setup destination/guard restrictions in root and entry while preserving explicit setup actions/screens, guest entry and protected account routes. Dashboard handles empty/pending garden state without fabricating setup completion.
- Keep Splash until slow relevant checks resolve; after the brief minimum, malformed/failed flag reads expose storage recovery and auth failures expose existing session recovery. Avoid indefinite splash or protected-route flashes.
- Keep onboarding provider outside account-keyed providers; local hydration errors keep their existing retry behavior. Neither storage errors nor auth generations reset the flag or mutate credentials/garden data.
- Update real component/store tests in install-onboarding-routing.test.ts, install-onboarding-integration.test.ts and startup-characterization.test.ts, plus affected helpers/garden-navigation/spaces-flow assertions. Exercise timer scheduling/cleanup, deferred reads/restores/writes, all flag/session combinations, rejected credentials, guest entry and deep-link/back guards. Use existing session tests as preservation evidence; change session logic only if necessary for this authorized behavior.

## Acceptance Criteria
- [x] Null/false plus anonymous/authenticated/restoring/error session shows slides after Splash with no bypass.
- [x] True plus absent/rejected credential resolves to Login; true plus verified restore resolves to Dashboard even with pending setup.
- [x] Returning and fresh launches show the same branded two-second minimum Splash; slow checks, cleanup and rerenders behave deterministically.
- [x] Read/write failures and auth restoration failures expose recovery without protected Dashboard access or erased data.
- [x] Completion is durable before routing, mid-slide restore cannot reset slides, and final routing waits for unresolved auth.
- [x] Explicit setup, guest, login/register, logout, account isolation and protected routes continue working.

## Verification
Proves: Real startup components/store transitions exercise all destinations, deferred operations and splash timers; session/account/navigation regressions detect weakened auth or broken guest/setup access.
```bash
set -euo pipefail
npm test --workspace=frontend
npm run typecheck --workspace=frontend
```

## Constraints
No storing access JWTs outside memory or onboarding in SecureStore; no backend/database edits, dependency upgrade, artwork/redesign, account data erasure or commits. Tests must assert observable guards/destinations/timing rather than names alone.
