---
version: 4
status: built
date: 2026-10-07
---

# Restore sessions without bypassing install onboarding

## Problem

The reported new-device launch goes directly to Home instead of splash → introductory onboarding → login. The code confirms a routing defect: `frontend/app/_layout.tsx` makes splash and intro accessible only when unauthenticated and checks session restoration before displaying routes. `frontend/app/onboarding.tsx` does not persist introductory completion. The existing account-scoped `LocalState.onboarding` describes garden setup, not the introductory slides.

Profile: standard. Authentication routing, native backup semantics, and installation lifecycle require investigation and native verification even though the visible change is small. This is a separate change following completed PRDs v1–v3; their existing evidence warnings are not absorbed into this scope.

## Solution

Introduce a durable installation-scoped introductory completion gate, independent of authentication and account-scoped garden setup. Every installation without this marker displays the existing splash and all introductory slides before session-dependent navigation. A valid restored session skips login only after introductory completion. Use a small local Expo module for non-secret completion storage that is excluded from backup and device transfer; keep refresh credentials in the existing SecureStore adapter.

## Scope

| This PRD covers | This PRD does NOT cover |
| --- | --- |
| Install-level intro lifecycle, splash order, startup guards and deep links | New splash artwork, slide copy or garden setup redesign |
| Backup-excluded native completion storage and browser fallback | Disabling backup of all garden data or moving credentials |
| Restore races, storage failures, regression checks and device checks | Backend auth redesign, database changes, telemetry or firmware |

## Requirements

### R-01 — First-install launch takes precedence over authentication

- **S-01:** Given a missing completion marker and no credential, launch shows the existing splash, then introductory onboarding, then login after completion; Home never appears first.
- **S-02:** Given a missing completion marker and a valid restored session, launch shows splash and introductory onboarding; after completion it skips login and follows existing authenticated setup/Home guards.
- **S-03:** Given a missing completion marker and expired credentials, restore rejection or an offline restore error, splash and intro remain reachable; after completion the existing anonymous/error recovery behavior applies.
- **S-04:** Given a direct link to Home, setup, login or another protected screen on an incomplete installation, the intro gate still takes precedence; guest-entry effects and navigation Back cannot bypass it.

### R-02 — Completion belongs to the installation

- **S-05:** Completing the final slide durably saves the installation marker before unlocking subsequent routes. Restart on the same installation skips intro regardless of account switching, sign-out or guest mode.
- **S-06:** A new-device cloud-backup restore or device transfer with account setup data and an otherwise valid session cannot restore introductory completion; splash and intro run again on both supported native platforms.
- **S-07:** Uninstall/reinstall or clearing native app data removes introductory completion even if iOS retains a refresh credential; intro runs again without proactively deleting that credential.
- **S-08:** Missing markers mean incomplete. A read error, malformed/unsupported record or write failure shows retryable local recovery and does not publish completion, bypass the gate or erase existing garden data. Repeated final-slide taps cannot navigate before a successful write.
- **S-09:** On web, completion persists in browser-local storage independently of account state; denied storage produces recovery. Native backup guarantees are not claimed for browser profile synchronization.

### R-03 — Preserve authentication security and garden setup

- **S-10:** Native refresh tokens remain exclusively in SecureStore and access JWTs remain in memory; no intro record or log contains credentials. Web continues using the existing HttpOnly cookie flow.
- **S-11:** SecureStore get/set/delete retain the existing key and matching options, including `WHEN_UNLOCKED_THIS_DEVICE_ONLY`; Android SecureStore backup exclusion remains enabled. Native inspection verifies no synchronizable Keychain attributes or shared access group are introduced.
- **S-12:** Once intro is complete, existing authenticated pending garden setup resumes its saved step, completed/skipped setup reaches Home, and guest routes retain their existing behavior and account isolation.
- **S-13:** If restoration finishes during any introductory slide, the slide remains visible until completion; slow restore after completion uses existing restoring/error UI without a dashboard flash or duplicate navigation.

## Architecture

### Structure

```text
frontend/
  modules/install-onboarding/        new local Expo module, Swift/Kotlin + metadata
  services/install-onboarding*.ts    new validated store and platform adapters
  context/install-onboarding.tsx     new installation-scoped provider
  app/_layout.tsx                    startup precedence and route guards
  app/splash.tsx                     controlled splash transition
  app/onboarding.tsx                 durable completion and recovery
  tests/                            gate/store/race tests and device checklist
```

### Components and data flow

Mount the installation provider outside the account-keyed tree so authentication generation changes cannot reset intro progress. Its state distinguishes loading, incomplete, completed and storage error; transient splash display and slide position are separate from durable completion. Storage bootstrap → splash → incomplete intro → durable completion → existing auth restoration/error handling → existing garden setup or Home/login. Auth restoration may proceed concurrently but cannot authorize bypassing intro. Wait for readiness before applying guest navigation effects or admitting protected destinations. Give cold launches a deterministic entry route rather than relying on current screen declaration order; the repository has no `app/index.tsx`.

The native module owns a versioned, non-secret completion record. Android stores it under `Context.getNoBackupFilesDir()`, which Android excludes from backup and transfer rules. iOS uses an Application Support file/directory with `isExcludedFromBackup` explicitly set, verified before accepting completion, and atomic durable writes. Do not use caches (eviction would repeat onboarding), Keychain (can survive reinstall), or a plain AsyncStorage marker (backup may carry it). Web uses a distinct browser-local key through a platform adapter. Failure to load the native module must fail visibly, never silently select a weaker native fallback.

No legacy intro marker exists to migrate. Existing installations therefore see intro once on the first binary containing this change; do not infer completion from account setup or tokens, since that would recreate the bypass. Account garden data and token keys remain intact. The user proceeded with `$pincer-narrow` after the concrete native-module and one-time-intro rollout proposal; that instruction authorizes this approach.

### Evidence, blast radius and rollback

Load-bearing paths are root protected-route guards, AuthProvider/session restoration and account-keyed LocalStateProvider. Existing session, session-transition, local-state and navigation tests protect auth rotation, storage failures and account isolation; they do not demonstrate native backup behavior or intro precedence. Baseline on 2026-10-07: `npm test --workspace=frontend` passed 310/310; `npm run typecheck --workspace=frontend` passed. No implementation changes were made during planning.

Blast radius: all cold launches and native builds. Restore existing route gating to roll back the feature without deleting tokens, garden state or the new record. Rollback reintroduces the reported bug; later re-enable can reuse the versioned marker. No backend or database rollback is required.

## Success Criteria

| Criterion | Verification |
| --- | --- |
| Intro always precedes auth-dependent navigation when marker is absent | Behavioral gate/route tests covering S-01–S-04 and S-13, including both restore completion orders |
| Durable local lifecycle and failures | Store tests covering missing, valid, corrupt, unsupported, read/write failures and double taps |
| Existing behavior preserved | `npm test --workspace=frontend` and `npm run typecheck --workspace=frontend` |
| Real backup exclusion and native integration | Build iOS and Android binaries; inspect native storage/config and run fresh install, relaunch, reinstall, backup restore and device-transfer checks on each platform |
| Visual flow unchanged | Observe existing splash then all slides; check reduced motion, large text and Android Back |

Native evidence is deferred to a future sprint under user-resolved D-01 (T-17; S-06/S-07/S-11; C-05/C-06). Current completion covers the implemented code and automated checks only. When collected, device evidence must name builds/devices and outcomes. Mocked Node tests or Expo Go cannot establish native backup/transfer correctness. The bug's reported iPhone-to-Android reproduction still needs device/build/storage evidence; no direct cross-platform Keychain transfer has been established.

## Visual Direction

Preserve existing screens and styling; no visual changes were requested.
Tone: calm, clear, botanical.
Keep the existing splash background and onboarding theme, typography and green palette.
Preserve accessibility, safe areas and responsive slide layout.
Avoid new animations, artwork, slide copy and layout redesign.

## Security & Trust Boundaries

Treat disk/browser records as untrusted and validate their schema before use. The marker controls intro UX, never authentication or server authorization. The server remains responsible for validating refresh credentials and access JWTs through the existing contract. Native refresh secrets stay in SecureStore; browser refresh secrets stay in HttpOnly cookies; access tokens stay in memory. Storage/restore recovery must not expose tokens or raw internal errors.

## Dependencies & Risks

Repository manifests specify Expo SDK 57, SecureStore ~57.0.4, FileSystem ~57.0.7 and AsyncStorage 2.2.0. Registry checks on 2026-10-07 returned SecureStore 57.0.4, FileSystem 57.0.7 and AsyncStorage 3.1.1; this plan does not require upgrading AsyncStorage. The installed SecureStore Swift implementation uses a default service of `app` and sets no synchronizable attribute; `keychainService` identifies a service, not a cloud-sync switch. Keep it stable to preserve credential access.

Official contracts checked: [Expo SecureStore](https://docs.expo.dev/versions/v55.0.0/sdk/securestore/) documents backup exclusion and device-only accessibility; SDK 57 installed source is the version-specific evidence because its online documentation URL was inaccessible. [Android Auto Backup](https://developer.android.com/identity/data/autobackup) documents no-backup directories and distinct cloud/device-transfer rules. [Apple backup exclusion](https://developer.apple.com/documentation/foundation/urlresourcevalues/isexcludedfrombackup) documents the Application Support exclusion flag. [Expo local modules](https://docs.expo.dev/modules/get-started/) documents native module integration and rebuild requirements.

Adding the module requires new native binaries; an OTA-only update cannot supply it, and Expo Go is insufficient for acceptance. iOS build/device checks require Apple tooling. No release claim may substitute source inspection for actual restore/transfer evidence.

## Out of Scope

No dependency-wide upgrades, app-wide backup disabling, auth endpoint changes, logout-on-new-install policy, data migration, UI redesign, publishing, pushing or merging. Local commits for Pincer evaluation are authorized by the user and AGENTS.md. No delivery budget was supplied. The user explicitly deferred T-17 native builds, lifecycle/security validation and visual review to a future sprint (D-01). S-06, S-07 and S-11 remain defined above and are deferred in the coverage map; C-05/C-06 are retained as deferred review obligations. This is a scope disposition, not evidence that these checks passed.

## Authorization and Handover

The user explicitly requested `$pincer-plan` for this bug and supplied the launch order, restored-session behavior and storage constraints. The subsequent user instruction `$pincer-narrow`, responding to the concrete proposal, authorizes the proposed native module and one-time intro rollout and delegates the faithful ticket breakdown. Record that exact instruction and its conversational reference in runtime authorization; no approval of extra scope is inferred. Existing completed change records remain untouched. The user subsequently authorized committing this change and updating AGENTS.md to permit local commits for Pincer evaluation; pushing and merging remain outside this authorization.

## Original Brief

Source: user's `$pincer-plan` task, “Fix cross-device session/onboarding restoration bug.” Report: first launch on iPhone 13 worked, but installation on another device such as Android skipped splash/onboarding and landed on Home as though session/completion belonged to the original device. Hypotheses to verify: backed-up AsyncStorage, cloud-synced Keychain, shared persistence key or session restoration preceding the per-device gate. Required outcome: every brand-new install/device shows splash and onboarding regardless of restored credentials; a valid session skips only login; completion is local-only per-device, never cloud-synced keystore; refresh tokens remain in native SecureStore; inspect Keychain accessibility and service configuration. Routing precedence is confirmed from source; the physical transfer mechanism is unverified.

## Deferred Native Validation — D-01

User instruction: “Skip T-17 for now. Mark it as deferred. The native builds will be tested in a future sprint. Resume the PRD workflow.”

The completed automated portion of T-17 can close in this sprint. Its native portion is explicitly deferred; the runtime has no deferred ticket lifecycle value. Preserve the original acceptance procedure in `frontend/tests/INSTALL_ONBOARDING_MANUAL_CHECKS.md` and evidence gaps in `.prd/frontend-install-verification-v4.md`. Native binaries still need rebuilding before use; native platform compilation, real backup/transfer behavior and visual/accessibility acceptance are not certified by current completion.
