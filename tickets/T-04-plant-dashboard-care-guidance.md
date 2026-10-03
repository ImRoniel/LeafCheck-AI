---
ticket: T-04
status: done
size: M
prd: .prd/prd-v1.md
depends_on: [T-02, T-03]
started: 2026-10-02T12:48:16Z
finished: 2026-10-03T01:37:50Z
---

## Objective

Present the plant health summary and actionable care guidance to the user in a concise mobile-first view, with graceful fallback when telemetry is stale or missing.

## Context

- Relevant files: `frontend/app/plant-profile.tsx`, `frontend/components/dashboard-ai-summary.tsx`, `frontend/components/dashboard-alerts.tsx`, `frontend/services/scan-flow.ts`
- PRD section: `R-04` and `R-05`
- Implements: R-04, R-05

## Requirements

- The plant profile or dashboard must render the latest health summary, relevant environmental context, and actionable care guidance in a mobile-friendly layout.
- When telemetry is stale, absent, or otherwise degraded, the UI must present a clear fallback state instead of making a confident recommendation from incomplete data.
- Client-side state updates must preserve account-scoped data and not expose secret-bearing or provider-adjacent details.

## Acceptance Criteria

- [x] The user can open a plant profile and see health metadata plus the current environmental context from the app state.
- [x] Missing or stale telemetry renders a degraded state rather than a false positive recommendation.
- [x] Plant state refresh after a scan remains scoped to the correct plant and account.
- [x] Type-safe app code continues to compile without introducing contract regressions in the app services.

## Verification

Proves: This verifies the plant dashboard contract and app-level state compatibility for health summaries and stale-data handling.

```bash
cd frontend && npm run typecheck
npm test
cd ../backend && node --import tsx/esm --experimental-test-module-mocks --test tests/scan-cache.test.mjs
```

## Constraints

- Do not add non-essential layout noise or aggressive animation that reduces readability.
- Do not claim a diagnosis confidence the backend did not produce.
