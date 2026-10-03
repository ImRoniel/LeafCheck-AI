---
prd: .prd/prd-v2.md
base: 3102e9c84c27f078d77cf38ce1bbd2bc1d5a1df7
candidate: 278462bd791e2b094cdac7932cea9bd0650f9f20
evidence: .prd/evidence/prd-v2/278462bd791e2b094cdac7932cea9bd0650f9f20/manifest.json
---

# PRD v2 evaluation — blocked

The manifest referenced above does not exist: strict runtime export refused required unverified platform checks C-04 and C-05. This document and partial evidence are a handoff, not proof of release readiness. No evaluation locator was produced.

The scanner now ends transient sessions on X, results Back, route exit and unmount; releases its rendered preview; resets readiness, photos, errors and capture locks; aborts pending work; and prevents old callbacks/finalizers from changing reopened sessions. In-session Retry Sync and background report retention remain intact. Saved application records and permissions are preserved. No dependency or API changes were made; no scope was cut or deferred.

C-01 passed 36 tests plus TypeScript; C-02 passed 34 tests plus TypeScript; C-03 passed all 163 frontend tests plus TypeScript; C-06 passed 163 frontend and 60 backend tests. Candidate-bound runtime log copies, reviewer report, security report and unverified draft are under the candidate evidence directory. Runtime attempts remain in ignored .pincer/runtime. These copied logs are not a validated manifest.

Independent code-quality review found no high-confidence actionable findings; no fix ticket was needed. Limited history secret scan found no markers and no secret .env file is tracked. The real error-handler HTTP smoke returned generic 400/413 responses without stacks. npm audit reported 22 high-severity package entries and zero critical, including unchanged braces, deepmerge-ts and node-forge dependencies. Recommend separate dependency-remediation tickets; upgrades are outside this PRD. No forced package downgrade was applied.

Requirement disposition summary is provisional because no manifest was exported: R-01 remains blocked on real camera-release/route-exit observation (C-04); R-02 remains blocked on actual close/reopen capture trials and visuals (C-04/C-05); R-03 has passing executable regression checks but is not claimed delivered by a validated manifest. The map would deliver five scenarios from command evidence (S-02, S-06–S-09); S-01, S-03–S-05 still require platform evidence. Adequacy is inadequate for complete delivery until those observations exist. No authorization to defer any requirement was provided.

Expo web started on port 8097 and GET /scanner returned HTML, but no browser renderer, browser automation tool, physical device or camera was available. React Native DevTools also reported missing libnspr4.so. No screenshots or visual verdict are claimed, and no Android/iOS/browser camera support was verified. Source layout preservation was reviewed; that does not establish rendered correctness.

Next: run C-04 on a supported physical device and a camera-capable browser, recording three flower scan/close/reopen/capture cycles, pending-operation close, failure, results Back and permission recovery. Capture scenario/platform/viewport before/after screenshots for C-05. Resume evaluation, re-run required checks if candidate inputs changed, export a valid manifest and commit the evidence locator. Then run pincer-release.

## Handover

Read this file first, then .prd/prd-v2.md, .prd/coverage/prd-v2.json and T-05–T-07. The scope and current authorization are recorded in runtime change prd-v2 under G-04/A-04. The user invoked pincer-code to finalize the scoped implementation/commits and pincer-evaluate to review and save evidence; no redesign, dependency upgrade or requirement cut was authorized.

For orientation, scanner.tsx owns camera mount/session identity and capture locks; use-scan.ts coordinates route/auth lifetime and background cancellation; scan-flow.ts owns diagnosis/synchronization generations and retry bookkeeping. scanner-lifecycle.test.ts and helpers/scanner-harness.ts execute real handlers with mocked native boundaries and deferred promises. scan-flow.test.ts exercises transport isolation.

No dependencies were added. React and React Native provide component state and native UI; Expo Router owns retained tabs and route targets; expo-camera owns preview/readiness and capture; expo-haptics provides optional success feedback; TypeScript and tsx plus Node's native test runner validate strict types and execute behavioral tests without a new test framework. The existing backend gate uses Express, Prisma dual clients, jose and hash-wasm for HTTP, persistence, JWTs and password hashing; AI providers stay behind existing server boundaries. Three.js is existing AR functionality outside this change.

The riskiest aging assumption is that real retained-tab/native camera timing behaves like the deterministic harness. Its scheduler combines effect timing and mocked preview lifetimes; tests cannot prove native resource release or actual React/Router scheduling. Permission dialogs, background/foreground transitions and queued native callbacks are the least-tested platform paths. As Expo/Router evolve, repeat the device trials as well as npm test --workspaces and frontend typecheck. Existing dependency advisories warrant a dedicated compatible-version review.
