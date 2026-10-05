# PRD v3 frontend device verification

Date: 2026-10-05. Automated platform: Linux, Node 22.23.3; Expo web/Metro with the existing frontend dependencies. Implementation was committed as `d53445a`. The user subsequently authorized committing T-12 and finalizing PRD v3.

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

## Initial agent Expo observations and limits

The frontend's existing `.env` supplies EXPO_PUBLIC_API_URL. Its configured backend's `/health` returned HTTP 200 on a read-only request. No credentials were printed and no live claim/pair mutation was performed.

`CI=1 npm run web --workspace=frontend -- --port 8081` could not start inside the sandbox (port probing reported an unusable port). The approved retry, `CI=1 npm run web --workspace=frontend -- --port 8087`, started Metro at http://localhost:8087. A read-only request to `/plant-profile` returned HTTP 200. Expo reported web bundling of expo-router/entry.js (1129 modules) and server bundling (1106 modules). Version validation used Expo's local dependency map because networking was disabled; bundling completed. These observations prove startup/bundling only.

During the initial agent verification, no browser executable, browser automation tool or native Expo client was available, and authenticated test accounts/device readings were not provided. The following initial limitations are historical; the user manual verification recorded below resolves the remaining T-12 obligations. The agent did not independently observe those live checks.

| Required S-19 live branch | Observation |
| --- | --- |
| New claim | User-attested through complete T-12 manual verification |
| Same-owner reclaim | User-attested through complete T-12 manual verification |
| Another-owner conflict | User-attested through complete T-12 manual verification |
| Paired/null waiting | User-attested through complete T-12 manual verification |
| Populated real readings | User-attested through complete T-12 manual verification |
| Reassignment | User-attested through complete T-12 manual verification |
| Old plant unpaired on revisit | User-attested through complete T-12 manual verification |

## User manual verification

Source: the user message in this conversation on 2026-10-05:

> T-12 is manually verified, please commit and finalize the PRD.

This explicitly confirms the complete T-12 ticket, including the S-19/C-07 live-flow branches and C-08 visual review. These results are recorded as user-attested manual verification, separate from agent-run automated checks and initial Metro observations. The user did not supply a platform, screenshots or individual branch logs; none are invented here. This confirmation resolves the remaining manual prerequisites for ticket closure. Candidate-bound evaluation evidence will be handled by `$pincer-evaluate`.

## Scope, security and visual review

Implementation changes are confined to frontend code, types and tests, plus workflow ticket/verification artifacts. Backend, firmware, database schemas, package manifests/lockfile and environment conventions are unchanged. Access tokens still use the existing in-memory transport/session bridge; pending Device and confirmed pairing state are account-scoped and transient. Input/response validation is at the frontend boundary; backend ownership enforcement remains authoritative. Rendered names and messages use React text nodes. Production review found no secret-like literal assignments, debug logging, internal stack rendering or un-awaited write paths added by this work.

Source review retains the existing Screen/Action/Notice/MetricCard components, green theme, card/typography styles and explicit disabled, alert, loading and retry controls. Actual web row accessibility was rendered and checked. The initial agent pass supplied source/accessibility evidence only. The user subsequently confirmed complete T-12 manual verification, including its visual-review acceptance criterion; C-08 manual verification is user-attested.

## Handoff

Close T-12 using the user manual verification and fresh automated receipts, complete the change, and mark PRD v3 built. Run `$pincer-evaluate` for the final candidate quality pass; built does not mean evaluated or released. The user authorized these finalization commits explicitly in the quoted instruction above.
