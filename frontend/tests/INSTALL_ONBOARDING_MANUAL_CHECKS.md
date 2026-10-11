# AsyncStorage MVP: Expo Go acceptance

Use the current JavaScript bundle in Expo Go; no custom onboarding module or native
build is needed. Use test accounts and record platform, OS, Expo Go/runtime version,
date, reset method and observations in `.prd/frontend-mvp-verification-v6.md`.
Never record credential values. Preserve account garden data when preparing states.

1. Remove only `@leafcheck_onboarding_complete` in an isolated test project, then
   cold launch. Splash lasts at least two seconds, followed by all three slides.
   Repeat with the flag set to the JSON boolean string `false`.
2. Repeat missing/false with an existing valid session: slides still precede
   authenticated routes. Late restore does not reset the current slide.
3. Finish the final slide. Verify the persisted value is `true`; reload the project.
   Every cold launch still briefly shows Splash, but slides do not repeat.
4. With `true` and no refresh credential/test session, observe Splash → Login.
   With an expired/rejected test credential, observe Login after verified rejection.
   Do not print or copy credentials to prepare this test.
5. With `true` and a valid restored session, observe Splash → Dashboard, including
   a test account whose garden setup is pending. Explicit setup routes still work.
6. Sign out, sign in as a second test account, and enter/leave guest mode. Intro
   stays complete, protected routes remain protected and garden data stays scoped.
7. Open Dashboard/setup/login/terms deep links before completing intro; try Back.
   Neither direct links nor guest navigation may bypass slides.
8. Delay flag reads or session restoration. Splash stays until relevant checks
   resolve; missing/false may reveal slides before auth finishes. Completed intro
   waits for auth. Existing recovery appears after actual errors.
9. Inject malformed/nonboolean flag data and read/write failures using an isolated
   test fixture. Observe sanitized retry feedback, no unrelated data deletion,
   no completion before successful save, and coalesced repeated final taps.
10. Confirm unchanged artwork/layout, large text, screen-reader controls and
    saving/retry feedback, reduced motion and Android Back behavior.

The key is a nonsecret AsyncStorage boolean, never a SecureStore flag. Legacy
markers are ignored and may cause a one-time replay of intro. There is no ordinary
backup-exclusion/device-transfer guarantee in this MVP. State exactly how Expo Go
storage was reset; a project reload does not clear persisted storage.

Unavailable prerequisites/results remain **unverified**. Required real-device
review C-04 is not waived by Node tests or this checklist.
