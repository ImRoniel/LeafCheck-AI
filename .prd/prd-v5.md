---
version: 5
status: draft
date: 2026-10-07
---

# Restore Expo Go onboarding with isolated preview storage

## Problem

After T-16, opening the app shows “Introductory setup unavailable”; repeated “Retry local storage” presses do not recover. That screen is not evidence of a filesystem failure alone: the native adapter also throws when the custom InstallOnboarding module is absent, and the store hides all causes behind one generic message. Retrying JavaScript cannot install missing native code.

Profile: standard. This affects every cold launch, native runtime compatibility and installation persistence; the confirmed Expo Go runtime requires an explicitly isolated preview exception. PRD v4 and its authorized native-validation deferrals remain preserved as historical scope, not silently revised.

## Solution

Use standard AsyncStorage for introductory completion only when expo-constants identifies Expo Go through ExecutionEnvironment.StoreClient. Keep the custom backup-excluded native module mandatory for standalone and development builds. The preview key is leafcheck.expo-go.install-intro.v1, separate from browser, native and account garden records. Existing store validation, durable completion ordering and retry behavior apply to both adapters.

The user confirmed Expo Go and explicitly authorized this preview fallback. Missing native capability alone must never select AsyncStorage. Preview persistence is not evidence of production install/backup isolation.

## Discovery and evidence

- Confirmed: frontend/services/install-onboarding-storage.native.ts throws when requireOptionalNativeModule returns null. frontend/services/install-onboarding-store.ts collapses missing-module, invalid-record and I/O errors into the same generic message. frontend/app/_layout.tsx exposes the same retry action for every category.
- Confirmed: current autolinking resolves leafcheck-install-onboarding on Android and Apple, including Kotlin and Swift module classes. This establishes discovery, not compilation or registration in the user's installed binary.
- Baseline on 2026-10-07: frontend suite passed all 45 test-file groups. Earlier evaluation ran 334 individual frontend tests. Frontend TypeScript is checked separately from the repository root.
- User-confirmed cause: Expo Go lacks the custom native storage module. The user requested AsyncStorage for previewing and retention of the native module for production.
- Existing styling is preserved; the confirmed fix changes storage selection only.

## Scope

| This PRD covers | This PRD does NOT cover |
| --- | --- |
| Explicit Expo Go runtime selection and isolated AsyncStorage preview completion | Changing authentication, credential keys or token persistence |
| Transient read/write retry behavior and safe failure classification | Treating missing native code as completed onboarding |
| Expo Go persistence and native isolation regression tests | AsyncStorage fallback in standalone or development builds |
| Preview startup validation and documented native guarantees | Native build/device-transfer certification deferred under PRD v4, broad dependency upgrades |

## Requirements

### R-01 — Select preview storage only in Expo Go

- **S-01:** Given ExecutionEnvironment.StoreClient, loading a missing preview record reaches splash and intro without requesting the custom native module.
- **S-02:** Given standalone, development or unknown execution environment and an absent native module, read/write fail without accessing AsyncStorage.
- **S-03:** Given Expo Go and malformed, unsupported or unreadable preview state, existing store validation presents safe recovery; a missing record remains normal incomplete state.

### R-02 — Preserve retry and durable completion

- **S-04:** Given an initial AsyncStorage read rejection followed by a successful missing-marker read, Retry reaches splash/intro; repeated calls coalesce.
- **S-05:** Given repeated denial or invalid preview data, intro stays incomplete without deleting credentials or garden records.
- **S-06:** Given an AsyncStorage final-slide write rejection, completion stays locked until a successful retry; existing serialization protects double taps.

### R-03 — Persist preview state independently

- **S-07:** Given a fresh Expo Go preview, startup shows splash and all slides before anonymous login or existing authenticated setup/Home routing; module absence does not block preview.
- **S-08:** Given successful preview completion, another store instance or Expo Go reload skips intro independently of account/session state.
- **S-09:** Given a production/development native build with the module present, read/write still use that module exclusively. Preview records are never migrated to or read as native completion. Document that native builds still require the module and preview storage has no production backup guarantee.

### R-04 — Preserve storage and credential boundaries

- **S-10:** Preview completion uses only leafcheck.expo-go.install-intro.v1; browser/native completion and account garden keys remain separate. Restored sessions cannot bypass incomplete intro.
- **S-11:** Refresh tokens retain existing SecureStore/HttpOnly-cookie storage and access JWTs remain in memory; no credential is written to the preview record or logged.

## Architecture

### Structure

```text
frontend/
  services/install-onboarding-storage.native.ts  Expo Go selection and preview adapter
  tests/install-onboarding-native-contract.test.ts  preview/native boundary and recovery
  README.md                                     preview and native build instructions
```

### Components and data flow

Check Constants.executionEnvironment against ExecutionEnvironment.StoreClient at adapter initialization. Expo Go → isolated AsyncStorage key; every other native runtime → existing InstallOnboarding module. Both paths use the same IntroStorage interface and validated store. No __DEV__ or missing-module fallback is permitted, because development builds must exercise production storage semantics. Browser resolution stays unchanged. No dependency addition, native source change or record migration is required.

### Load-bearing paths, blast radius and rollback

Root routing, installation bootstrap and durable completion affect every launch. Existing storage, native-contract, routing, integration, startup-characterization, session and garden-navigation tests protect most JavaScript behavior. Autolinking and Node mocks cannot prove native compilation or installed module registration. Add capability/recovery tests and use the whole workspace gate before evaluation.

A safe rollback removes new classification/UI handling while preserving marker schema and locations; it restores the prior generic recovery bug, without deleting tokens or garden data. Changing native storage or introducing a new fallback requires separate review and migration planning.

## Success Criteria

| Criterion | Verification |
| --- | --- |
| Expo Go can read, complete and reload without custom module | Adapter plus real store tests; user Expo Go smoke after JS reload |
| Rejected reads/writes remain recoverable | Adapter/store rejection and retry tests |
| Production/development/unknown runtimes never fall back | Throwing AsyncStorage fixtures plus missing-module assertions |
| Existing onboarding behavior and types remain valid | npm test --workspace=frontend; npm run typecheck --workspace=frontend |

Actual Expo Go device smoke remains unverified until performed on the user's device. Production backup/transfer certification retains PRD v4's explicit deferral; this preview change adds no native build or storage implementation.

## Visual Direction

Preserve the current calm, botanical screens, light palette, typography, spacing and splash/slides. Keep existing accessible recovery, loading and disabled-action feedback. Avoid artwork, animation or onboarding redesign. Keep native build details in developer guidance; product-facing copy should simply explain that the installed app version cannot complete setup and needs a compatible update.

## Security & Trust Boundaries

Local records and native/browser errors are untrusted. Validate the marker and classify only known capability failures; never display raw paths, stacks or secrets. The intro marker controls UX, not authentication. Refresh secrets retain existing SecureStore/HttpOnly-cookie boundaries and access JWTs stay in memory. Never log environment contents, auth state payloads or token values while investigating.

## Dependencies & Risks

No new dependency is proposed. Installed packages: expo-modules-core 57.0.19, expo-constants 57.0.19, expo-file-system 57.0.7. Registry checks on 2026-10-07 returned 57.0.21, 57.0.21 and 57.0.7 respectively; no upgrades are required by this design.

[Expo custom native code](https://docs.expo.dev/workflow/customizing/) confirms Expo Go cannot load custom native modules. [Development build guidance](https://docs.expo.dev/develop/development-builds/use-development-builds/) requires a rebuild after native dependencies change. [Autolinking](https://docs.expo.dev/modules/autolinking/) discovers local modules under the default ./modules directory; current repository resolution confirms this configuration for both platforms. These contracts match the user-confirmed Expo Go runtime. Installed expo-constants types define executionEnvironment and StoreClient; the preview uses that explicit runtime identity.

The confirmed Expo Go issue is addressed by runtime-specific preview storage. Genuine I/O failures retain existing recovery. Persistent corrupt records may need a separate user-controlled marker-reset design; this scope does not authorize silently erasing data. Existing critical/high dependency audit findings remain outside this bug scope.

## Out of Scope

AsyncStorage fallback in production/development builds, onboarding bypass, deleting credentials or garden data, automatic marker reset, backend changes, dependency upgrades, publishing, pushing and merging. Preserve PRD v4 and its native backup/transfer deferrals. No delivery budget supplied.

## Authorization and Original Brief

Original report: after T-16, opening the app shows “Introductory setup unavailable”; repeated “Retry local storage” presses do nothing. Follow-up: “I am using Expo Go. The custom native storage module is missing. Please add a fallback for Expo Go so it uses standard AsyncStorage for previewing, while keeping the native module for production builds.” This explicitly authorizes implementation of the isolated Expo Go preview path. Existing styling is preserved; no design change requested.
