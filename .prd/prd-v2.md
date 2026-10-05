---
version: 2
status: built
date: 2026-10-05
---

# Consistent evaluation freshness in workflow status and release

## Problem

The release audit of device API candidate 0285ee70aaab6de2cf8d9dbe60998bc4dbb627bf failed because the Notes compatibility line reports the valid evaluation locator as a post-candidate source change. The same status report shows a current Evaluation locator, valid evidence, and a passing readiness gate. Maintainers need a consistent audit that accepts valid evidence-only commits and still rejects genuine candidate changes.

Original brief: the user invoked `$pincer-plan` immediately after the release report identified this failure and recommended a separate workflow correction. The report named `.claude/commands/pincer-release.md` and the Notes/Evaluation mismatch as the scope. This is a new workflow change; `.prd/prd-v1.md`, its endpoint tickets, evidence and change record remain history.

Profile: standard. Although bounded, this touches the trust boundary deciding whether release evidence still describes the source; negative regression checks are essential. No time budget was supplied.

## Solution

Align changes-mode Notes compatibility freshness with the existing validated evaluation follower policy, and align release guidance with the authoritative Evaluation locator. Reuse `locator.followers` rather than adding directory-wide exceptions. Preserve legacy Notes semantics, candidate identity, evidence digest validation, tracked-file requirements and the release requirement for a clean tree. Do not change endpoint code or reinterpret the old audit as passed.

Authorization basis: this planning invocation follows the specific workflow-fix recommendation. Scope is limited to that correction and its regression tests/documentation; downstream stage invocations authorize decomposition and implementation of this scope. No additional product decision or discovery question is needed.

## Scope

| This PRD covers | This PRD does NOT cover |
| --- | --- |
| Changes-mode Notes freshness after validated evidence-only commits | Device API behavior or database changes |
| Mode-specific status/release guidance and matching generated adapters | Changes to authorization, lifecycle, evidence schemas or scope dispositions |
| Behavioral freshness tests in disposable Git fixtures | Broad exceptions for evidence directories or weakening readiness checks |
| Tracking the exact canonical guidance files needed for durable delivery | Dependency advisory remediation, deployment or historical record repair |

## Requirements

### R-01 — Consistent changes-mode freshness

- **S-01:** Given a completed evaluated change and an evidence-only follow-up commit containing matching NOTES.md, validated candidate artifacts and its valid evaluation locator, changes-mode status reports Notes current, Evaluation current and Evidence ok; the readiness gate succeeds.
- **S-02:** A committed source/test/configuration/PRD change after the candidate, or dirty source, still produces stale freshness and blocks readiness. A clean-tree release check still rejects any uncommitted mutation; evidence follower recognition cannot waive it.
- **S-03:** A malformed or misnamed changed locator, an altered listed artifact with an invalid digest, or an unlisted file in the evidence directory is rejected. Missing/untracked evidence, invalid metadata, wrong candidate/base ancestry and invalid selected-change evidence remain failures through existing validation.
- **S-04:** Legacy and migrated modes preserve their existing Notes freshness contract. Changes-mode Evaluation remains authoritative; an overwritten or absent root compatibility summary cannot replace the selected change's locator or convert invalid Evaluation evidence into current readiness.

### R-02 — Durable mode-specific release guidance

- **S-05:** The release checklist and canonical release playbook distinguish legacy/migrated Notes authority from changes-mode Evaluation authority. They retain current authorization, completed lifecycle, valid tracked evidence, strict coverage/adequacy, local-attempt freshness and clean-tree requirements; a valid locator evidence-only commit is not described as a source mutation.
- **S-06:** The repository retains the changed canonical release playbook and checklist despite existing ignore rules, and Codex/Copilot release adapters match that playbook after generation. No unrelated prompt or skill changes are included. Existing evaluation instructions permitting locator commits remain consistent with the corrected release rules.

### R-03 — Regression evidence and reviewable delivery

- **S-07:** Native Node behavioral tests using temporary Git repositories exercise valid evidence-only commits and the relevant rejection scenarios from R-01, including unchanged legacy behavior; the tests fail against the original Notes freshness defect. Existing Bash-runner regression tests remain green.
- **S-08:** The backend's 93-test baseline and strict TypeScript compilation remain green. The correction is delivered through associated tickets, fresh verification, scoped commits, a new committed candidate/evaluation and a read-only release audit; PRD v1's recorded candidate and artifacts are preserved.

## Architecture

### Structure

```
scripts/pincer-runtime/status.cjs                   mode-aware Notes compatibility check
scripts/pincer-runtime/locator.cjs                  existing validated follower policy, reused
scripts/tests/pincer-freshness.test.mjs             new isolated Git regression fixtures
docs/release-checklist.md                          corrected mode-specific checklist
.claude/commands/pincer-release.md                  canonical release instructions
.agents/skills/pincer-release/SKILL.md               generated Codex adapter
.github/prompts/pincer-release.prompt.md             generated Copilot adapter
```

### Components and data flow

The current `notesCurrent` validates metadata, ancestry, manifest digests and tracked artifacts, then permits only NOTES.md and manifest-listed files in the candidate-to-HEAD diff. `locator.current` already permits structurally valid locator files and validated candidate artifacts through `locator.followers`. Extend the changes-mode compatibility check with that existing follower set through an explicit mode-aware option or caller-supplied internal set. Keep legacy/migrated calls unchanged and retain all existing checks. Do not alter the locator's validation policy or introduce a second independent parser.

Status reads the selected record and Notes metadata, validates candidate evidence, computes allowed followers, and classifies committed/dirty differences. Release checks changes-mode Evaluation freshness and validated evidence as authoritative while still reviewing the human handover; legacy/migrated audits continue to require current Notes. Matching Notes for the selected PRD should no longer report the normal locator commit as stale. Root Notes for another change remains explicitly a compatibility summary rather than a false substitute for selected-change evidence.

The canonical release playbook, Codex adapter and release checklist are currently ignored and untracked; the Copilot adapter is tracked. Implementers must explicitly stage only the exact changed canonical/checklist/Codex paths with force when needed, rather than broad ignore-rule changes. Run `scripts/sync-prompts.sh` from the canonical source and inspect all generation drift, retaining only intended release-adapter changes. Do not edit generated adapters independently.

### Brownfield evidence, blast radius and rollback

Load-bearing files read directly: status.cjs, locator.cjs, release/evaluate playbooks, release checklist, sync-prompts.sh and the PRD template. One codebase-explorer confirmed the failure mechanism and lack of behavioral freshness coverage. On 2026-10-05, `node --test scripts/pincer-runtime/runner.test.cjs` passed 1/1 after allowing subprocess execution outside the sandbox. That test only checks Bash launching and does not protect freshness. The preceding read-only release audit directly passed backend tests 93/93 and backend TypeScript compilation.

Use disposable repositories with committed fixture candidates/evidence; never rewrite actual PRD v1 locators, artifacts or lifecycle metadata to manufacture a passing fixture. The change affects human status and audit interpretation across Pincer modes. Rollback reverts the new implementation/docs commits and restores the old false-stale behavior; no migration or application data rollback is involved. New planning/source commits naturally make older candidates historical; restoring their former release status is not promised.

## Success Criteria

| Criterion | Verification |
| --- | --- |
| Normal locator evidence commit is accepted without accepting genuine mutations | `node --test scripts/tests/pincer-freshness.test.mjs` with positive and negative Git fixtures |
| Legacy behavior and Bash runner remain intact | New mode regressions plus `node --test scripts/pincer-runtime/runner.test.cjs` |
| Canonical release guidance and adapters agree | Generation comparison using the committed canonical source, plus review of mode-specific obligations |
| Device API remains unchanged and green | `npm test --workspace=backend` and `npx tsc --noEmit -p backend/tsconfig.json` |
| Workflow reports one consistent result for the new candidate | Fresh evaluation followed by `$pincer-release`; no stale Notes diagnostic caused only by its valid locator commit |

## Out of Scope

No device endpoint changes, frontend design, dependency updates, database queries/migrations, global evidence directory allowlists, evidence schema changes, authorization shortcuts, historical artifact edits, publishing, or unrelated prompt synchronization. No requirements were cut. Visual discovery is inapplicable because this change modifies workflow tooling and text only.

## Security & Trust Boundaries

Notes, locator and manifest contents are local inputs, not self-authenticating proof. Retain strict parsing, candidate/base identity, repository-contained paths, artifact digests and tracked-file validation. Only the existing validated follower policy may classify evidence-only paths; malformed records and unlisted files remain candidate mutations. No secrets or external service contracts are introduced, and regression fixtures contain synthetic data only.

## Dependencies & Risks

No package or external API is added or upgraded; registry-version verification is inapplicable. Use the installed Node native test runner and existing Git/Bash tooling. Tests need permission to spawn subprocesses in this environment; a sandbox EPERM is infrastructure failure, not corrupted workflow history. The main risk is accepting a broader set of post-candidate changes than intended, mitigated by negative fixtures and unchanged locator validation. Canonical ignored guidance must be deliberately tracked to ensure the fix survives a fresh checkout.
