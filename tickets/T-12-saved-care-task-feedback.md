---
ticket: T-12
status: done
size: M
prd: .prd/prd-v3.md
depends_on: [T-11]
timeout: 600
started: 2026-10-04T07:11:06Z
finished: 2026-10-04T07:15:32Z
---

## Objective
Show an understandable saved-task result and prove that generated tasks appear and retain their existing account-synced lifecycle in Care Tasks.

## Context
- Relevant files: `frontend/app/(tabs)/scanner.tsx`, `frontend/services/scan-flow.ts`, `frontend/app/(tabs)/tasks.tsx`, `frontend/hooks/use-care-tasks.ts`, `frontend/services/care-tasks.ts`, `frontend/services/api.ts`.
- Reuse `frontend/tests/helpers/scanner-harness.ts`, `frontend/tests/scanner-lifecycle.test.ts`, `frontend/tests/scan-flow.test.ts`, and existing care-task tests; add `frontend/tests/scanner-care-task-feedback.test.ts` for actual screen handlers.
- Implements: R-03, R-04, R-05
- Scenarios: S-09, S-13, S-14, S-15, S-16
- Depends on T-11. Existing Care Tasks already fetches server rows and merges them with local checks; do not introduce another writer.

## Requirements
- On confirmed save and completed client synchronization, display `Plant saved. N care tasks added.` using response task count, including one review fallback when used. Provide an accessible action navigating to the existing Care Tasks tab.
- Keep retained report and Retry Sync feedback on synchronization failure; do not claim that the garden refresh succeeded. Retry Sync must not resubmit the photo, rerun Gemini or add tasks. Preserve route-close/background/session fences.
- Exercise task GET on focus, Today/Upcoming grouping, account completion/undo, failed-reload last-good retention and retry, and restoration after a fresh session. Invalid task responses keep existing typed validation/error behavior rather than rendering malformed tasks.
- Preserve existing theme, typography, plant/due details, conditional descriptions, account/local labels, and guest/local checklist behavior. Keep titles short and action-oriented; no raw parser metadata, JSON or new developer wording.
- Add handler/render tests for count/navigation/synchronization failure and relevant existing task/hook regressions; static string searches alone are insufficient.
- During evaluation record a signed-in device/browser demo: scan, observe count, visit My Garden and Care Tasks, complete/undo, restart and re-fetch. Record screenshots/platform/viewport for normal and fallback task output and synchronization/reload errors. Node tests cannot replace visual/camera evidence.

## Acceptance Criteria
- [x] The rendered successful result has the actual saved count and accessible Care Tasks action; two-task and one-review-fallback fixtures produce correct text/navigation.
- [x] Synchronization failure displays Retry Sync without a misleading completed-refresh result; retry and scanner reentry/close do not create another task set or apply stale updates.
- [x] Generated tasks load on focus, group correctly, complete/undo through server IDs, and restore in a fresh client session; failed/malformed reloads retain existing safe feedback and last-good rows.
- [x] Guest/local schedules and completion behavior, condition-preserving details, readable dates and existing visual styling remain intact.
- [x] Automated frontend tests and TypeScript pass; required device/browser and visual observations are recorded separately at evaluation, with unavailable platforms explicitly unverified.

## Verification
Proves: actual scanner rendering/navigation, retained-report Retry Sync, task reload/grouping/completion and local/guest regressions work together; this does not claim physical camera or visual review completion.
```bash
set -euo pipefail
cd frontend
node --import tsx --test tests/scanner-care-task-feedback.test.ts
cd ..
npm test --workspace=frontend
npm run typecheck --workspace=frontend
```

## Constraints
- No frontend report parser, task POST, redesign, notification delivery, pagination project, rescan deduplication, or manual plant-entry AI tasks.
- Keep server status changes distinct from local checklist completion and from health/sensor confirmation.
- Required manual evidence belongs to coverage checks C-06/C-07; missing evidence cannot be represented as a passed automated check.
