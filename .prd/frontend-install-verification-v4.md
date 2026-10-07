# PRD v4 installation restoration verification

Status: native acceptance **deferred to a future sprint and unverified**, per user-resolved D-01. No physical-device result is asserted.

## Automated evidence

Store, adapter, route and integration tests exercise missing/corrupt markers,
read/write failure/retry, final action coalescing, all slides, restore completion
orders, account setup guards, guest behavior and browser-local persistence.
Final automated verification on 2026-10-07: 4/4 focused integration tests,
334/334 frontend tests and `npm run typecheck --workspace=frontend` passed.
T-17 runtime attempt `000133-20261007T135346Z-bd224f` records that run;
subsequent freshness checks, if any, are retained by the runtime.
T-14 through T-16 are implemented. T-17’s automated portion is implemented;
its native build/lifecycle/visual portion is deferred under D-01.

Expo Modules autolinking was run from `frontend` for Apple and Android; both
resolved `leafcheck-install-onboarding` to the local Swift/Kotlin module.
Autolinking is metadata evidence, not compilation or device execution.

`node ../node_modules/expo/bin/cli export --platform web --output-dir
/tmp/leafcheck-v4-web-export` completed successfully from `frontend`, emitting
bundles and 45 static routes. This establishes web bundling/static-rendering
compatibility, not native compilation or visual/device acceptance.

## Available environment and missing prerequisites

The current execution environment is Linux. `xcodebuild`, `swift`, `ruby`, `pod`,
`java` and `adb` were not found on PATH; there are no generated frontend native
projects or attached test devices established in this session. EAS CLI is present,
but no remote build has been requested or launched. Native build/device testing
requires suitable toolchains, rebuilt binaries, test devices and backup/transfer
capability. Expo Go cannot supply the new native module.

## Deferred review obligations

| Check | Platform/build/device | Outcome | Artifact |
| --- | --- | --- | --- |
| C-05 iOS compilation/integration | unavailable | unverified | none |
| C-05 Android compilation/integration | unavailable | unverified | none |
| S-06 iOS cloud restore and device transfer | unavailable | unverified | none |
| S-06 Android cloud restore and device transfer | unavailable | unverified | none |
| S-07 iOS uninstall/reinstall with retained credential | unavailable | unverified | none |
| S-07 Android reinstall and app-data clear | unavailable | unverified | none |
| S-11 built credential/backup configuration | unavailable | unverified; source checks only | native-contract tests |
| C-06 native visual/accessibility/Back review | unavailable | unverified | none |

Follow `frontend/tests/INSTALL_ONBOARDING_MANUAL_CHECKS.md` and replace these rows
with actual named builds/devices, observed results and artifact references. The user authorized current-sprint completion of the implemented/automated scope
while deferring T-17’s native portion. S-06/S-07/S-11 are deferred in strict
coverage, and C-05/C-06 remain explicitly unverified future-sprint obligations.
Current workflow completion does not certify native builds or device behavior.
