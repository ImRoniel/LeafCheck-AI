# PINCER Release Checklist

Audit the selected PRD and its evaluated candidate. This checklist applies to product
changes in greenfield and brownfield repositories. It is read-only: failures return work
to the owning stage or a new ticket.

## Change identity and state

- [ ] `scripts/pincer-status.sh` selects the intended PRD with `status: built` and no warnings
- [ ] Every ticket associated with that PRD is done and ready: current `last_check` and `verified` evidence before migration, a current passing attempt after it (`node scripts/pincer-runtime.cjs ready` exits 0)
- [ ] Legacy and migrated modes: `NOTES.md` names the selected PRD, reviewed base, candidate, and `evidence:` manifest; the `Notes` line is `current` and the `Evidence` line is `ok`
- [ ] Changes mode: the selected change's `Evaluation` line is `current` and the `Evidence` line is `ok`; its locator names the selected PRD, reviewed base, candidate and manifest. Root `NOTES.md` is a compatibility summary, not the evaluation authority. Read the selected change's human handover from root Notes or recorded history; missing or overwritten root Notes cannot substitute for or invalidate the selected locator's verdict
- [ ] A valid evidence-only commit containing matching Notes, digest-validated listed artifacts and valid evaluation locators is permitted after the candidate in changes mode. Genuine source changes, malformed/misnamed locators, altered artifact digests and unlisted evidence files still fail freshness; evidence followers never waive the clean-tree audit requirement
- [ ] The `Provenance` line names the evidence schema; a schema 2 candidate has no newer nonpassing local attempt for the same check and source inputs, and a fresh clone's `local verification history unavailable` limit is stated, not claimed as verification
- [ ] Change records only: the selected change is `completed`, its authorization is `current` for the current agreement, `.prd/evidence/changes/<id>.json` names the evaluated candidate, and the audit selected, activated and completed nothing
- [ ] Every file the evidence manifest lists is tracked; the working tree is clean before and after the audit
- [ ] Strict coverage only (`Coverage strict …` in status): `node scripts/pincer-runtime.cjs coverage` reports structure complete, every in-scope scenario `delivered` on the evaluated candidate, every deferral or removal backed by its decision and user authorization, `delivery` distinguishing original from agreed scope, and an `adequate` adequacy judgment; `ready` names `COVERAGE_INCOMPLETE`, `SCOPE_UNAUTHORIZED`, `OBLIGATION_MISSING`, `REVIEW_MISSING` or `ADEQUACY_REQUIRED` as failures. A change without the capability is labeled `unverified`: say so, never imply strict coverage

## Scope and evidence

- [ ] Every requirement in the PRD has a disposition in the evidence manifest: delivered with passing checks, or deferred with recorded user authorization; none is blocked (strict coverage: the manifest is schema 3, its scenario rows are the inventory's, and the validator reconciled them with the committed candidate)
- [ ] Ticket dependencies, acceptance criteria, and verification commands match the implemented change
- [ ] The repository's candidate-wide release gate passes when run directly, without invoking the ticket state writer
- [ ] Scope cuts and known limitations are explicit in the PRD or evaluation notes

## Review

- [ ] High-confidence review findings have file and line evidence and a disposition
- [ ] Fixes made after evaluation use a new ticket, current verification, and a scoped commit
- [ ] UI changes have visual checks with saved images in the evidence manifest (scenario, viewport, observed result); non-UI changes record `visual_review.applicable: false` with a reason
- [ ] Security review reports locations and remediation without printing candidate secret values
- [ ] No secret environment file is tracked; dependency and invalid-input checks run when applicable

## Handover and verdict

- [ ] Commit history identifies the plan, ticket work, evaluation, and any review-fix tickets
- [ ] The selected evaluation's human handover (`NOTES.md` or recorded history in changes mode) covers what shipped, cuts, limitations, next steps, dependencies, and the riskiest aging assumption; root Notes alone cannot replace another change's handover
- [ ] Platform or environment limits are stated without claiming untested support
- [ ] The audit repaired no ticket, rewrote no evidence, changed no PRD state, and published nothing
- [ ] Every failed or skipped required item is named before the final PASS or FAIL verdict, which names the candidate
