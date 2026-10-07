---
ticket: T-14
status: done
size: S
prd: .prd/prd-v4.md
depends_on: []
timeout: 600
started: 2026-10-07T13:38:04Z
finished: 2026-10-07T13:39:43Z
---

## Objective
Characterize the existing post-intro startup routes before changing load-bearing guards.

## Context
Enabling work for all three requirements; implements no scenario by itself. Read frontend/app/_layout.tsx, frontend/context/auth.tsx, frontend/context/local-state.tsx, frontend/app/setup/_layout.tsx and existing garden-navigation/session-transition tests.

## Requirements
- Add frontend/tests/startup-characterization.test.ts using the existing component-loading test pattern with typed fixtures. Exercise actual root routing rather than asserting source identifiers.
- Cover anonymous, restoring, restore error, guest, authenticated pending/completed/skipped setup, local loading/error and persisted setup redirects. Establish the current authenticated intro exclusion as a named characterization; T-16 must update that expectation intentionally.
- Capture guest navigation effects and reduced-motion behavior. Preserve .env ignore/example conventions; do not touch secrets.

## Acceptance Criteria
- [x] Tests fail if account setup guards, restore recovery or guest behavior regress.
- [x] Current behavior is documented without production routing changes; fixtures contain no credentials.

## Verification
Proves: Existing observable startup routing and setup restoration are protected before the gate change; this is characterization, not proof that the bug is fixed.
```bash
set -euo pipefail
cd frontend
node --import tsx --test --test-concurrency=1 tests/startup-characterization.test.ts tests/session-transitions.test.ts tests/garden-navigation.test.ts
```

## Constraints
Follow AGENTS.md: strict TypeScript without `any`, existing hooks/router and credential boundaries. No implementation beyond PRD v4, publishing, pushing or merging. Local commits for Pincer evaluation are authorized by AGENTS.md. Never claim planned tests or review obligations have already passed.
