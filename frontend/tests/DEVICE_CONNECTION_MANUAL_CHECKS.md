# Mock device connection acceptance checks

These Android, iOS, and browser interaction checks have not been executed by the implementation agent.
Automated service/storage coverage is in [`device-connection.test.ts`](device-connection.test.ts).
Also repeat the existing [scan checks](SCAN_MANUAL_CHECKS.md) and [setup checks](SETUP_MANUAL_CHECKS.md).

1. From the supplied registered-dashboard baseline, tap Connect Device. Confirm four dark-green/white
   screens: animated scanner, discovered-device list, assignment, green-check success. No Bluetooth,
   location, or camera permission request occurs. Every screen explicitly labels this mock-only.
2. Cancel discovery before 2.4 seconds. Stay on Dashboard after waiting longer than the timer.
   Repeat with Android Back, iOS back gesture, browser Back, and sign-out/account switch.
3. Background during discovery. No hidden navigation occurs; returning restarts discovery.
   Reduced Motion must stop the pulse while retaining readable progress. Test web tab visibility.
4. Select each node, then choose either an existing Space (including an empty local Space) or Plant.
   Names match the current collection. No destinations: show guidance and keep Connect disabled.
   Failed plant load: show retry and allow a valid local Space; initial loading is explicit.
5. Double-tap Connect: only one assignment is saved. Cancel or background during the 1.4-second delay:
   no assignment is saved. Return from background and retry. Once the local storage write has begun,
   it may finish for the originating account, but must not navigate a blurred screen or leak to another account.
6. Deny local storage writes: remain on Assignment with safe retry guidance, no success badge.
   Restore storage and retry. Corrupt a stored assignment: local-state recovery must fail closed,
   not erase data or report a successful connection.
7. Success shows the selected node and destination, a green checkmark, and Return to Dashboard.
   Return removes the connection screens from the app navigation stack. Alerts is absent; badge
   reads exactly Mode: Auto (With IoT), alongside Mock setup · No live connection.
8. Restart and verify the assignment remains in the same account. Switch accounts and guest mode:
   no assignment or Auto badge leaks. Guest setup remains local and does not enable AI/network telemetry.
9. Open Assignment with missing/unknown/array device parameters, or Success without a saved assignment:
   recover to Scanner. Anonymous or onboarding-pending users must not bypass the root route guards.
10. Verify no mock identifier reaches telemetry requests; real/demo telemetry statuses, botanical pH
    references, scan permissions, onboarding mode, and manual care remain unchanged.
11. Test TalkBack/VoiceOver, Tab navigation and Enter/Space activation, selection-button announcements, 200% text size,
    narrow web windows, phones with safe-area insets, tablets, and long destination names. Lists scroll
    without nested vertical scroll containers; Cancel and confirmation actions remain reachable.

## Version/documentation evidence

The mandated [SDK 54 documentation](https://docs.expo.dev/versions/v54.0.0/) was read before implementation.
It targets React Native 0.81 / React 19.1, unlike installed Expo 57.0.24, React Native 0.86.3,
React 19.2.3, Expo Router 57.0.22, and TypeScript 6.0.3. The
[SDK 57 reference](https://docs.expo.dev/versions/v57.0.0/),
[React Native 0.86 animation API](https://reactnative.dev/docs/0.86/animated), and
[Expo Router stack guide](https://docs.expo.dev/router/advanced/stack/) were also consulted.
No dependency, shared-lockfile, backend, token-storage, or telemetry-contract changes were made.
