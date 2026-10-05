---
ticket: T-06
status: done
size: M
prd: .prd/prd-v2.md
depends_on: [T-05]
timeout: 600
started: 2026-10-05T08:43:56Z
finished: 2026-10-05T08:49:56Z
---

## Objective
Make durable release instructions agree with mode-specific freshness authority and verify generated adapters.

## Context
- Relevant files: docs/release-checklist.md; .claude/commands/pincer-release.md; .agents/skills/pincer-release/SKILL.md; .github/prompts/pincer-release.prompt.md; scripts/tests/pincer-release-guidance.test.mjs (new).
- PRD section: Consistent evaluation freshness in workflow status and release
- Implements: R-02, R-03

## Requirements
- Correct checklist and canonical playbook: changes mode uses current selected Evaluation plus valid evidence as authority; legacy/migrated mode still requires current Notes.
- Retain authorization, completed lifecycle, tracked valid evidence, strict coverage/adequacy, local-attempt freshness and clean-tree obligations; review consistency with evaluation locator-commit instructions.
- Generate adapters using scripts/sync-prompts.sh; inspect drift and include only intended release changes. Force-stage only exact ignored canonical/checklist/Codex files needed for delivery.
- Add a native Node static-contract test that regenerates release adapters in an isolated temporary directory and compares bytes, checks exact relevant files are tracked, and asserts the documented mode-specific obligations. Do not modify the real worktree to run verification.
- Deliver scoped commits and preserve v1 history; subsequent evaluation and read-only release audit must record actual freshness, not rewrite historical results.

## Acceptance Criteria
- [x] Checklist and playbook express the correct authority in each mode and retain every release obligation.
- [x] Canonical guidance and both generated adapters are tracked and byte-consistent; no unrelated generated drift is committed.
- [x] Static-contract tests reject adapter drift or missing mode-specific/clean-tree obligations.
- [x] Freshness, Bash-runner, backend and compilation checks pass; v1 artifacts remain unchanged.

## Verification
Proves: Static documentation/generation contracts through isolated regeneration and tracked-file checks, plus behavioral regressions and backend preservation; semantic review is recorded separately at evaluation.
```bash
set -euo pipefail
node --test scripts/tests/pincer-release-guidance.test.mjs
node --test scripts/tests/pincer-freshness.test.mjs
node --test scripts/pincer-runtime/runner.test.cjs
npm test --workspace=backend
npx tsc --noEmit -p backend/tsconfig.json
```

## Constraints
- No dependencies, database/API changes, broad evidence allowlists, authorization shortcuts or historical record edits. Preserve existing environment/secret ignore conventions.
- Runtime owns lifecycle and receipt fields. Record semantic and delivery review separately from executable checks.
