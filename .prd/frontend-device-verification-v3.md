# PRD v3 frontend device verification

Date: 2026-10-05. Platform: Linux, Node 22.23.3; Expo web/Metro with the existing frontend dependencies. No commits were requested or created.

## Automated observations

- `npm test --workspace=frontend`: exit 0, 40 test files passed, 0 failed; log `/tmp/leafcheck-code-v3-final-tests.log`. The native runner reports file totals in this invocation, not the individual assertion total.
- `npm run typecheck --workspace=frontend`: exit 0 after the implementation and integration test changes. Ticket verification repeats this check against the final source.
- API tests observe claim/pair/unpair/BFF routes, bodies, Bearer authentication, one-time refresh, HTTP 409, UUID/MAC separation, timeout/account cancellation, malformed payloads and empty 204 responses. Payload-requiring operations reject empty success; deletion still accepts 204.
- Production Scanner -> AppData -> Assignment -> Success -> Profile integration uses the real API client with controlled HTTP responses. It observes new claim/same-owner reclaim/conflict, exactly one pairing PATCH, failed pairing/retry, waiting/zero readings, old-plant unpaired state and account-boundary cancellation. This is automated integration evidence, not live device evidence.
- Profile tests observe one BFF read, metadata hydration/error recovery, malformed/deep-link targets, focus cancellation, distinct sensor states, and explicit history handoff using the hardware MAC. Guidance and history regression tests remain.
- Actual react-native-web assignment rows cover selected/locked/busy accessibility states. Root invocation passed 8 accessibility tests; accessibility plus the three formerly failing scanner suites passed 50 tests from frontend.

## Baseline and verification failures

Before device UI edits, the full suite reported 33 passing files and three failing files: scanner-care-task-feedback, scanner-lifecycle and scanner-pre-validation, matching the PRD baseline. Direct execution exposed `Unexpected scanner import: ./animated-pressable`. The shared test loader lacked the native animation boundary and resolved services as `.tsx`. Its native Pressable mock and `.ts` service resolution now allow those existing behavior assertions to run; separate press-feedback tests retain animation coverage.

T-09 initially failed because the existing activity harness read a frontend-relative source path while the ticket runs from repository root. Its source path now resolves from import.meta.url. T-11's missing-ID regression exposed a null-state access; the production guard was fixed and the recorded verification passed. Guest plant IDs retain metadata access without sensor API reads.

The integration harness initially produced repeated collection hydration because its useCallback mock did not preserve dependencies. The mock now matches React callback memoization, and the integration waits for initial provider hydration before measuring profile requests. Updating AppData also required the existing spaces/claim provider harnesses to supply the real validator module. No assertions were suppressed. The full suite subsequently passed.

## Local Expo observations and limits

The frontend's existing `.env` supplies EXPO_PUBLIC_API_URL. Its configured backend's `/health` returned HTTP 200 on a read-only request. No credentials were printed and no live claim/pair mutation was performed.

`CI=1 npm run web --workspace=frontend -- --port 8081` could not start inside the sandbox (port probing reported an unusable port). The approved retry, `CI=1 npm run web --workspace=frontend -- --port 8087`, started Metro at http://localhost:8087. A read-only request to `/plant-profile` returned HTTP 200. Expo reported web bundling of expo-router/entry.js (1129 modules) and server bundling (1106 modules). Version validation used Expo's local dependency map because networking was disabled; bundling completed. These observations prove startup/bundling only.

No browser executable, browser automation tool or native Expo client was available. Two authenticated test accounts and a device MAC with readings were not provided. The live environment question remains unanswered. A backend health response and controlled HTTP fixtures do not establish actual account/device state or prove live navigation.

| Required S-19 live branch | Observation |
| --- | --- |
| New claim | Unverified: authenticated test account/device required |
| Same-owner reclaim | Unverified: authenticated test account/device required |
| Another-owner conflict | Unverified: second authenticated test account required |
| Paired/null waiting | Unverified: live pairing without readings required |
| Populated real readings | Unverified: live telemetry/device required |
| Reassignment | Unverified: authenticated device and two owned plants required |
| Old plant unpaired on revisit | Unverified: live reassignment/navigation required |

S-19/C-07 remains unresolved. T-12 and the change must not be reported built until these live observations are recorded.

## Scope, security and visual review

Implementation changes are confined to frontend code, types and tests, plus workflow ticket/verification artifacts. Backend, firmware, database schemas, package manifests/lockfile and environment conventions are unchanged. Access tokens still use the existing in-memory transport/session bridge; pending Device and confirmed pairing state are account-scoped and transient. Input/response validation is at the frontend boundary; backend ownership enforcement remains authoritative. Rendered names and messages use React text nodes. Production review found no secret-like literal assignments, debug logging, internal stack rendering or un-awaited write paths added by this work.

Source review retains the existing Screen/Action/Notice/MetricCard components, green theme, card/typography styles and explicit disabled, alert, loading and retry controls. Actual web row accessibility was rendered and checked. A visual inspection of authenticated screens on a browser/native device remains unverified, so C-08 has partial source/accessibility evidence only.

## Handoff

Keep PRD v3 ticketed. Resume the existing authorization when an authenticated test environment and browser/native Expo client are available, finish C-07/C-08, refresh ticket verification as required by source identity, then close T-12 and complete the change. No approval of new scope is inferred from missing prerequisites.
