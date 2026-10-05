---
prd: .prd/prd-v3.md
base: f0469715f8ccb9ad76f8a9901341b3d7629f2190
candidate: bd12504e6eb5d689032aa0ecd06596ba109bb1ae
evidence: .prd/evidence/prd-v3/bd12504e6eb5d689032aa0ecd06596ba109bb1ae/manifest.json
---

# PRD v3 evaluation

The frontend now claims entered/scanned MACs, carries the server Device UUID in account-scoped transient state, pairs it to owned plants, and renders Plant Profile from the plant telemetry BFF. Reassignment clears cached old links; collection-refresh failure preserves confirmed pairing. Unpaired, waiting, loading, populated and failure states are distinct. Metadata/edit/delete/care/image scanning remain in AppData; reading history loads explicitly with hardware MAC.

All R-01–R-05 and 19 scenarios are delivered in the validated schema-3 manifest. Original and agreed delivery are true; adequacy is adequate. No scope cuts or deferrals. All six tickets are done. The final candidate passes C-01–C-05/C-09, including 310 frontend tests and TypeScript. Twelve production Expo browser captures at 430x932 show the required styles/states/navigation with controlled API fixtures. Live backend/hardware checks are explicitly user-attested through the complete T-12 confirmation, not agent-observed live mutations; no unsupported platform or per-branch logs are invented.

Evaluation found a new duplicate React sibling-key defect at frontend/app/plant-profile.tsx:111. T-13 fixed it in a807c32 with distinct edit/telemetry/delete identities while preserving plant-specific remounts. Regression tests, independent reviewer confirmation and fresh browser captures show the error banner removed. No remaining implementation findings above the real-PR review bar.

Known security issue: fresh npm audit --omit=dev reports 22 high dependency records and zero critical (11 moderate not part of the high/critical findings list). These predate this frontend change; manifests and lockfile remain unchanged. Advisory roots include braces, deepmerge-ts and node-forge, with affected dependency chains detailed in review/security.json. Recommendation: separately scope dependency remediation and evaluate upgrade compatibility; dependency upgrades are explicitly excluded from this PRD. Do not apply npm's offered major downgrades blindly. The bounded redacting history/source scan found no secret patterns in seven reviewed commits; environment conventions pass. Invalid HTTP probes returned generic 403/413 with no stack. This is feature delivery with documented existing security findings, not a clean security audit or production-release claim.

No backend, firmware, schema, environment or project dependency changes. Temporary browser tooling resides outside the repository. Browser captures use fixture auth and fixture telemetry, not credentials or fabricated real readings. Native camera/live hardware was not independently exercised here. Initial Metro CI retained an old bundle after source edits; restarting Metro was necessary for reliable visual verification.

Authorization: current A-03/G-03 delegates the T-13 regression fix under A-02's approved frontend scope and the user's explicit pincer-evaluate invocation (step 8 authorizes in-scope fixes). The user's “T-12 is manually verified, please commit and finalize the PRD” supplies manual attestation and finalization commit authorization. No new architecture/scope decision was inferred.

## Handover

Read this file first, then .prd/prd-v3.md for scope/contracts and the linked manifest for exact candidate checks, artifacts, provenance and limitations. .prd/frontend-device-verification-v3.md attributes manual evidence. Start with frontend/services/api.ts and validators.ts, then context/app-data.tsx, app/device-connection/, app/plant-profile.tsx and components/plant-telemetry.tsx to follow the data flow. The backend routes/devices.ts and routes/plants.ts define authoritative claim/pair/BFF contracts; UUIDs identify database resources and hardware MACs address readings/history.

No dependency was added. Expo/React Native/React provide the existing application runtime; Expo Router handles guarded routes/focus; expo-camera supplies barcode/QR acquisition already installed. AsyncStorage retains existing nonsecret account-local setup/demo data; pending real Devices and access JWTs remain transient. expo-secure-store protects native refresh credentials and existing browser auth uses secure cookies. Existing shared transport/session coordination supplies refresh, cancellation and error sanitization. Node's native test runner, tsx and TypeScript execute production-source harnesses and compile checks without a new test framework. The existing Express/Prisma backend enforces ownership/atomic pairing and supplies the BFF; it is not modified by this frontend work.

The most fragile assumption is continued agreement between frontend validators and the backend serialized Device/BFF shape, especially the UUID/MAC distinction. AppData metadata hydration and asynchronous account/route changes are the highest-impact race paths; their production harness checks should stay. The least independently exercised path is physical/native camera acquisition and live dual-database/hardware telemetry; repeat it on supported devices when changing camera/SDK/auth/backend contracts. Camera denial must always retain manual entry. Web captures are one viewport and fixture-driven, so they do not establish every device layout.

With more time, prioritize the separately scoped high dependency advisories, broaden native camera/device coverage, and retain repeatable live-backend fixtures with per-branch observations. Rerun candidate evidence whenever source, configuration, tickets, PRD or change lifecycle changes; evidence-only commits preserve this evaluated candidate. Rollback only frontend integration/fix commits; server claims/pairings already performed remain real and cannot be rolled back by restoring local demo storage.

Next: run $pincer-release for the pass/fail audit of the workflow artifacts.
