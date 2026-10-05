---
ticket: T-04
status: open
size: M
prd: .prd/prd-v2.md
depends_on: []
timeout: 600
---

## Objective
Protect existing freshness rejection and legacy behavior before changing the trust boundary.

## Context
- Relevant files: scripts/pincer-runtime/status.cjs; scripts/pincer-runtime/locator.cjs; scripts/tests/pincer-freshness.test.mjs (new).
- PRD section: Consistent evaluation freshness in workflow status and release
- Implements: R-01, R-03

## Requirements
- Create native Node tests with disposable Git repositories and synthetic candidate/evidence records; never mutate real workflow history.
- Name baseline tests with the prefix `characterization:` so this ticket can pass against the current implementation.
- Exercise committed and dirty source/test/config/PRD mutations, malformed and misnamed locator input, altered artifact digests, unlisted evidence files, missing/untracked evidence, invalid metadata and candidate/base ancestry, and invalid selected-change evidence.
- Characterize legacy and migrated Notes behavior and changes-mode Evaluation authority when root Notes is missing or overwritten; preserve current locator policy.
- Use observable status/readiness outputs and failure verdicts; include fixture cleanup and preserve the Bash-runner regression.

## Acceptance Criteria
- [ ] The characterization subset passes against the original runtime and detects weakened rejection checks.
- [ ] Invalid local evidence is rejected with stale/invalid verdicts and blocks applicable readiness gates.
- [ ] Legacy/migrated Notes behavior and selected-change authority are covered without editing historical artifacts.

## Verification
Proves: Existing negative and mode-specific freshness behavior through disposable Git fixtures; catches broadened evidence exceptions before the runtime fix.
```bash
set -euo pipefail
node --test --test-name-pattern='^characterization:' scripts/tests/pincer-freshness.test.mjs
node --test scripts/pincer-runtime/runner.test.cjs
```

## Constraints
- No dependencies, database/API changes, broad evidence allowlists, authorization shortcuts or historical record edits. Preserve existing environment/secret ignore conventions.
- Runtime owns lifecycle and receipt fields. Record semantic and delivery review separately from executable checks.
