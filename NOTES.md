---
prd: .prd/prd-v2.md
base: c442e0cd94f3503f7851787a84b0fff0086a03a0
candidate: 23d9cc54ea5c283f8afe31a2f532eee153383c4d
evidence: .prd/evidence/prd-v2/23d9cc54ea5c283f8afe31a2f532eee153383c4d/manifest.json
---

# PRD v2 evaluation

Changes-mode Notes compatibility freshness now reuses the existing validated locator follower policy. Valid evidence-only locator commits no longer create the false stale Notes diagnostic. Legacy/migrated validation, artifact digests, tracking, ancestry and clean-tree release rules remain intact. Release checklist, canonical playbook and both generated adapters use the authority appropriate to each mode; the exact previously ignored guidance files are now tracked.

R-01, R-02 and R-03 are delivered in the evaluated implementation: eight scenarios, original and agreed scope unchanged, adequacy assessed as adequate. No scope was cut. Candidate checks passed: 37 behavioral freshness tests, one Bash runner test, five static guidance/generation tests, 93 backend tests and TypeScript compilation. The positive regression failed against the original runtime before the correction. PRD v1 endpoint source, records and candidate artifacts are unchanged.

Independent review found one circular delivery-evidence prerequisite in C-07. T-07 (11307f4) fixes the ordering: C-07 reviews pre-export commit/verification history; the actual read-only release audit follows this evaluation commit and is reported separately. The reviewer found no further high-confidence issues. This document and manifest do not predeclare that future audit passed.

Known issue: npm audit exited 1 for existing dependencies (workspace 22 high, backend three high, no critical). Backend findings involve @prisma/config, deepmerge-ts and prisma (package-lock.json:2954,6057,11774). Dependency files are unchanged; upgrades are outside this PRD and should get separate maintenance work. No exploit reachability was established. The redacted manual history scan found no secret-like literal assignments, but no standalone scanner was installed, so this is not exhaustive secret detection. HTTP smoke returned generic 400/413 errors for empty/oversized claim input without storage calls; it used synthetic auth/storage mocks, not live infrastructure.

## Handover

Read this handover first, then .prd/prd-v2.md, its coverage map, and scripts/pincer-runtime/status.cjs together with locator.cjs. Native Node tests exercise disposable Git repositories; scripts/tests/pincer-release-guidance.test.mjs checks documented authority, tracking and isolated generation. Existing Git and Bash tools establish commit/ancestry and execution behavior; the installed TypeScript compiler and backend runner protect the application baseline. No new package dependency was added. Edit the canonical .claude/commands/pincer-release.md and generate adapters with scripts/sync-prompts.sh; do not edit adapters independently or broadly remove ignore rules.

The riskiest aging assumption is that locator.followers and evidence validation continue to define the same allowed post-candidate paths. Preserve malformed/misnamed locator, altered digest, unlisted file and source-mutation regressions when changing these contracts. Freshness fixtures model portable fresh-clone evidence; actual local-attempt consistency is validated on this candidate by the runtime. No deployment, live database, frontend or visual support claim is made. Sandbox subprocess/network failures require the appropriate execution permission, not hand repair of history.

Next: run the read-only post-export readiness/release checks against this committed evaluation, then use $pincer-release for the final whole-workflow audit. With more time, address dependency advisories in a separate PRD and add a standalone redacting secret scanner.
