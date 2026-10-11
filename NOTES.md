---
prd: .prd/prd-v4.md
base: 50fa92d1730fb9ebda86890f871299fb0f25992b
candidate: 2e7ea469da43b134d5ce80938fc5b95490e33b89
evidence: .prd/evidence/prd-v4/2e7ea469da43b134d5ce80938fc5b95490e33b89/manifest.json
---
# PRD v4 evaluation

Installation onboarding gates session-dependent navigation: missing completion shows splash and every intro slide before login or authenticated setup/Home. Completion persists independently of accounts; failures remain retryable and cannot unlock routes early. Production native storage uses the local backup-excluded Expo module. Refresh tokens remain in SecureStore, access tokens in memory and web refresh in HttpOnly cookies.

The authorized Expo Go preview update uses AsyncStorage only in StoreClient, with a separate key that never migrates into production completion. Standalone, development and unknown runtimes still require the native module. The Gradle cache ignore entry and lifecycle completion are committed in this candidate. The authorization basis is the existing current A-08 plus the user's request to reopen for “Added Expo Go fallback storage for local testing” and to re-verify/evaluate/release. No new dependency or architecture decisions were introduced.

Fresh evaluation records 337 frontend tests, 94 backend tests, both TypeScript checks, behavioral ticket checks, a bounded redacting history scan and browser observations. No new high-confidence implementation findings. Anonymous and mocked restored-session browser flows showed splash and all three slides, then login or pending setup; reload skipped completed intro with no page errors. Invalid API requests returned clean 403/413 without stack traces. All command outcomes and provenance are in the manifest; a release audit follows the committed evaluation and is not predeclared here.

Ten agreed scenarios are delivered. R-01 is delivered; R-02/R-03 retain deferred dispositions because they include S-06/S-07/S-11, explicitly deferred under user-resolved D-01. C-05/C-06 remain unverified. Original full delivery is incomplete; agreed delivery is complete. Native builds, backup/transfer, reinstall lifecycle, native accessibility and Android Back are deferred to the future sprint. Browser fixtures and JavaScript adapter tests do not prove actual Expo Go device or production-native outcomes.

Known issues: npm audit reports 1 critical and 23 high records in the unchanged dependency tree, including shell-quote at package-lock.json:12954; C-09 honestly remains failed and optional under the agreed map. Recommend a separate dependency-remediation ticket, since upgrades are outside PRD v4. Existing final-slide CTA contains a garbled apostrophe at frontend/components/onboarding-slider.tsx:136; record a separate copy-fix ticket. Dedicated secret-scanner tooling is unavailable; the bounded byte-safe scanner found no matching credentials. T-18 protects the existing one-hop proxy policy and T-19 protects binary-safe history inspection.

## Handover

Read this document first, then .prd/prd-v4.md and the candidate manifest. Read frontend/tests/INSTALL_ONBOARDING_MANUAL_CHECKS.md and .prd/frontend-install-verification-v4.md for deferred acceptance. Trace frontend/app/_layout.tsx → installation provider/store → platform adapter/local Expo module. Root NOTES is the human summary; .prd/evidence/changes/prd-v4.json is the change's evaluation authority.

Expo Router provides guarded navigation; every root route must be explicitly declared to prevent automatic route registration from bypassing intro. Expo Modules Core binds the local Swift/Kotlin module to production JavaScript. SecureStore remains the credential boundary. AsyncStorage serves account garden state and isolated Expo Go preview state; browser completion uses localStorage. expo-constants identifies StoreClient explicitly, so missing modules alone never enable weaker storage. Existing dependencies earned their place through these platform boundaries; no packages were added or upgraded.

The riskiest aging assumptions are native backup exclusions, module build integration, marker-schema compatibility, runtime identification and SecureStore device-only settings. Native device acceptance is the least-tested path. Rebuild production/development binaries to include the module; OTA alone cannot supply it. Expo Go supports local preview only. Preserve production failure recovery, isolated keys and credential options when upgrading Expo. Adding a root route requires updating guards. Production deployment assumes one trusted proxy hop; revisit it when network topology changes.

Next: perform deferred native build/device tests and separately remediate dependency vulnerabilities and CTA copy. Local evaluation commits are authorized; publishing, pushing and merging remain outside this work.
