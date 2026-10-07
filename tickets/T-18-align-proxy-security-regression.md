---
ticket: T-18
status: done
size: S
prd: .prd/prd-v4.md
depends_on: [T-17]
timeout: 600
started: 2026-10-07T14:49:52Z
finished: 2026-10-07T14:51:39Z
---

## Objective
Repair the release-gate security regression after the pre-existing one-hop proxy configuration change.

## Context
Read backend/src/server.ts and backend/tests/security.test.mjs. Base commit 50fa92d intentionally sets trust proxy to 1; preserve that runtime policy. This enabling ticket establishes a passing repository-wide release gate without changing onboarding or deferred native scope.

## Requirements
- Align the stale proxy assertion and server comment with the existing one-hop policy.
- Exercise forwarded-chain address resolution: trust the nearest forwarded address, not arbitrary earlier entries.
- Ensure the listener is ready before configuration assertions and avoid teardown errors when no listener is running.
- Retain existing header, quota, malformed/oversized-input and CORS assertions.

## Acceptance Criteria
- [x] Security regression tests verify the existing one-hop policy and forwarded-chain boundary.
- [x] Full workspace tests and backend/frontend TypeScript checks pass.
- [x] Native deferrals and production proxy behavior remain unchanged.

## Verification
Proves: Actual Express proxy resolution and existing security HTTP behavior, plus whole-repository regression compatibility.
```bash
set -euo pipefail
npm test --workspaces
npx tsc --noEmit -p backend/tsconfig.json
npm run typecheck --workspace=frontend
```

## Constraints
No dependency changes, proxy policy redesign, native certification, publishing, pushing or merging. Local evaluation-fix commits are authorized by AGENTS.md.
