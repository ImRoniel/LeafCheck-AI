# Dashboard refactor checks

These rendering and interaction checks remain unverified on Android, iOS, and web.
Automated summary/state checks are in [`dashboard-summary.test.ts`](dashboard-summary.test.ts).
Also run the existing [scan checks](SCAN_MANUAL_CHECKS.md) and [setup checks](SETUP_MANUAL_CHECKS.md).

## Layout and accessibility

- Compare with the supplied current screenshot: greeting, date, badge, green header background,
  and overlapping Scan to Add Plant card must retain their original positioning.
- Confirm the order below the scan card: inline Alerts, one white AI Summary placeholder,
  then the unchanged Plant Overview. No Garden summary, Your garden at a glance,
  Saved care preferences, View My Spaces button, Review care schedule button, My plants
  header, or individual plant-list cards should appear on Home.
- AI Summary must explicitly say Coming soon and that no AI-generated garden summary is
  available yet. It must not invent analysis or offer a nonfunctional summary action.
- Dismiss Alerts. The summary should move up in normal document flow without a blank overlay.
- Test narrow phones, notched phones, tablets, web resizing, and large accessibility text.
  Alert buttons must wrap and all new card content must expand without clipping.
- Scroll to the bottom of Plant Overview and verify the floating bottom navigation does not cover the final
  content at the end of scrolling. The existing bottom safe-area clearance must remain intact.
- Verify VoiceOver/TalkBack headings, disabled pairing announcement, Dismiss label, and web
  keyboard activation of Dismiss, retry when shown, and the retained overview controls.

## Data and actions

- Initial loading and refresh feedback appear inside AI Summary without suggesting that AI
  generation is running. On initial failure or failed refresh, a safe Plant Overview error and
  Retry loading plants action appear in that card. Retry still works; no extra section is added.
- Empty collections retain the existing Plant Overview empty state; populated collections retain
  its carousel. Pull-to-refresh still works. No per-plant list is rendered below the overview.
- Check no-device, linked-device, demo-only, and mixed collections. Alerts must describe recorded
  links, not claim sensor discovery or current live readings. Demo readings must be labelled simulated.
- Connect Device remains explicitly unavailable because pairing is not implemented. Scanning
  without hardware must continue to work for signed-in users. Guests see sign-in guidance.
- Plant Overview still opens existing spaces destinations. On another collection screen, check
  the unchanged standalone setup summary: Review care schedule restores saved preferences and
  Resume setup restores the saved step. No saved care data is deleted by removing Home controls.
- Dismiss an alert in account A, then sign out and enter account B or guest mode. The dismissal,
  collection, and care preferences must not leak across the session boundary.

## Documentation compatibility

The root [`AGENTS.md`](../../AGENTS.md) mandates [Expo SDK 54 documentation](https://docs.expo.dev/versions/v54.0.0/),
but installed packages resolve to Expo 57.0.24, React 19.2.3, React Native 0.86.3, and TypeScript 6.0.3.
Both that mandated documentation and the [SDK 57 documentation](https://docs.expo.dev/versions/v57.0.0/)
were consulted alongside the React Native 0.86 core layout documentation. Dependencies and
shared lockfiles were not changed to conceal this mismatch.
