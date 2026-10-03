---
ticket: T-07
status: done
size: M
prd: .prd/prd-v2.md
depends_on: [T-06]
timeout: 600
started: 2026-10-03T06:33:05Z
finished: 2026-10-03T06:42:06Z
---

## Objective

Integrate session cleanup with scanner X, results Back, and route lifetime so reopening always presents a fresh usable camera and late work cannot affect it.

## Context

- Relevant files: `frontend/app/(tabs)/scanner.tsx`, `frontend/components/scan-viewfinder.tsx`, `frontend/hooks/use-scan.ts`, `frontend/tests/scanner-lifecycle.test.ts`, `frontend/tests/bottom-nav-regression.test.ts`.
- Implements: R-01, R-02, R-03
- Scenario ownership: S-01–S-09 at the screen/camera boundary, using T-06's flow cleanup.
- Depends on T-06. Existing generic Screen Back and general navigation semantics must remain unchanged.

## Requirements

- Use coordinated idempotent cleanup for explicit X and navigation departure, results Back, and unmount. Invalidate the session before clearing photo URI/base64, capture flag/lock, readiness, errors, and scan-flow state; disable/unmount the preview on exit.
- Gate capture and camera callbacks by current session/mount identity. A new visit waits for its own ready event; an old callback/finalizer cannot set readiness/error, release a newer lock, clear busy state, issue further work, or play success audio/haptics.
- Preserve X back/home fallback, fresh route targets, auth/permission/focus/foreground gates, Retake, New Scan, and in-session synchronization retry. Reject missing/oversized image payloads before submission with existing safe messages.
- Add behavioral regressions for each PRD scenario, including three successful close/reopen/capture cycles, exit from error/results, close during unresolved capture/scan/synchronization, old success/failure after a new operation starts, duplicate taps, and denied/recovered permission or mount failures.

## Acceptance Criteria

- [x] X and results Back/route exit clear every transient camera and scan field, unmount the preview, and retain saved records; repeated cleanup works without waiting for old work.
- [x] Three close/reopen cycles after success and failure each show a fresh preview and permit another scan after the current ready event, with no stale photo/report/spinner/error.
- [x] Delayed picture and permission/camera callbacks, capture/retry finalizers, and scan feedback from old sessions cannot mutate the new session or bypass duplicate protection; both late success and rejection are tested.
- [x] Permission denial, camera failure, unauthenticated/unfocused/background capture, missing image data, and oversized images remain safely rejected; permission recovery and fresh camera mount restore scanning.
- [x] Targeted and untargeted reentry, Retake, New Scan, Retry Sync, and background report retention retain their PRD behavior. Frontend tests and TypeScript pass.

## Verification

Proves: the complete frontend suite, including real scanner/hook close-reopen and asynchronous race regressions, exercises all nine scenarios and preserves surrounding navigation/scan contracts; mocked camera tests do not prove physical-device release.

```bash
set -euo pipefail
npm test --workspace=frontend
npm run typecheck --workspace=frontend
```

## Evaluation Obligations

- C-04: on a supported physical mobile device and camera-capable browser, run three flower-scan/close/reopen/second-capture cycles; repeat close during capture/analysis, after failure, and via results Back. Observe camera release, current-camera readiness, and permission recovery. Record exact platforms and any unverified cases.
- C-05: save before/after screenshots with scenario, platform, viewport, and observations. Review unchanged layout, missing stale overlays, error/permission UI, and fresh preview. Screenshots alone do not establish camera release.
- C-06: run the full workspace test gate on the implementation candidate. The earlier missing generated backend client remains a setup prerequisite; any failure is reported, never waived or counted as a pass.

## Constraints

- No redesign, dependency upgrades, API changes, stored-data deletion, or device-discovery scanner changes. Preserve `.gitignore` secret exclusions and existing environment conventions.
- Use lifecycle isolation rather than forcing a whole-app reload. No manual camera-cache deletion or new background-retention policy.
- Manual evaluation evidence is separate from the executable ticket receipt; absent hardware/browser access remains explicitly unverified.
