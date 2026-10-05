---
ticket: T-07
status: done
size: S
prd: .prd/prd-v2.md
depends_on: [T-06]
timeout: 600
started: 2026-10-05T09:04:31Z
finished: 2026-10-05T09:04:32Z
---

## Objective
Remove the circular C-07 evidence prerequisite while retaining the actual post-export release audit.

## Context
- Relevant files: .prd/coverage/prd-v2.json, .prd/prd-v2.md, docs/release-checklist.md, scripts/tests/pincer-release-guidance.test.mjs.
- Implements: R-03
- Review finding: C-07 demanded an audit that needs its own exported evaluation; confidence 99, candidate b62a224.

## Requirements
- C-07 reviews scoped commits, current verification, preserved v1 history and evaluation readiness before export; it cannot attest a future audit result.
- Keep S-08's actual read-only audit after the committed evaluation, reported separately; no scenario cut or relaxed readiness gate.
- Document the ordering in the checklist and cover it in the native static-contract tests.
- Reject a review map or documentation that again makes the future audit a prerequisite for the same evaluation.

## Acceptance Criteria
- [x] C-07 explicitly reviews pre-export delivery and excludes attestation of a future audit.
- [x] The checklist retains a separate actual audit after evaluation; S-08 remains in scope.
- [x] Static-contract tests detect missing phase separation and pass for the corrected map/checklist.

## Verification
Proves: the authored evidence-order contract prevents the circular future-audit prerequisite; this static check does not claim a release audit has run.
```bash
set -euo pipefail
node --test scripts/tests/pincer-release-guidance.test.mjs
```

## Constraints
- No runtime/endpoint changes, evidence schema changes or historical repairs; keep all release gates.
- Lifecycle and receipts remain runtime-owned. Record the actual post-export audit separately.
