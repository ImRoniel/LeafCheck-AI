---
prd: .prd/prd-v4.md
base: 50fa92d1730fb9ebda86890f871299fb0f25992b
candidate: e5f231ebac4220e94e3ef7ae6c25950b649b5cf0
evidence: .prd/evidence/prd-v4/e5f231ebac4220e94e3ef7ae6c25950b649b5cf0/manifest.json
---
# PRD v4 evaluation

Installation onboarding now gates session restoration: first launch shows splash and all intro slides before login or authenticated navigation. Completion is written durably to an installation marker; native storage excludes that marker from backup. Refresh tokens remain in SecureStore with device-only accessibility, and access tokens stay in memory. Account garden setup remains separate. AGENTS.md now permits local commits specifically for Pincer evaluation; publishing, pushing and merging remain separately authorized.

Agreed delivery passes, with no new high-confidence code defects identified. All 334 frontend tests and TypeScript checks pass. Browser captures verify anonymous and restored-session flows and completion persistence on reload. Invalid API requests returned clean 403 and 413 responses. The bounded redacting history scan found no credentials; a dedicated secret scanner was unavailable.

The manifest records R-01 delivered and R-02/R-03 deferred because each contains native scenarios S-06/S-07/S-11 deferred by explicit user decision D-01. Ten agreed scenarios pass. T-17 automated coverage is complete; actual native builds, lifecycle/backup/device transfer, native accessibility and Android Back testing remain for a future sprint. Original full delivery is therefore incomplete, without blocking the revised agreed scope.

Known issues: the unchanged dependency lock has 1 critical and 23 high vulnerability records in npm audit, including shell-quote at package-lock.json:12954. C-09 is recorded failed. Recommend a separate dependency remediation ticket; forced audit fixes propose incompatible framework changes. The existing last-slide CTA has a garbled apostrophe at frontend/components/onboarding-slider.tsx:136; record a small copy-fix ticket. Browser authentication uses controlled fixtures and does not prove native token restoration.

## Handover

Read this document, then .prd/prd-v4.md and its candidate evidence manifest. frontend/tests/INSTALL_ONBOARDING_MANUAL_CHECKS.md and .prd/frontend-install-verification-v4.md contain the deferred native checklist. Start with the root routing gate and installation store, then the local Expo module in frontend/modules/install-onboarding.

Expo Router provides explicit guarded routes; declaring every non-intro route prevents automatic screen registration from bypassing the gate. The local Expo module uses Expo Modules Core to persist a backup-excluded marker through native filesystem APIs. SecureStore remains the native credential boundary; AsyncStorage remains account-local garden state, while web onboarding uses localStorage. No external dependency upgrades were introduced.

The least-tested path is native compilation and backup/device transfer. Build the native app with the local module included; Expo Go or an OTA-only update cannot supply a missing native module. Missing-module and storage failures intentionally show retry UI. Preserve marker schema compatibility, native backup exclusions and SecureStore device-only options when upgrading Expo or changing storage. Revisit explicit route guards when adding screens. Next run the deferred native checklist and address dependency vulnerabilities in their own scoped work.
