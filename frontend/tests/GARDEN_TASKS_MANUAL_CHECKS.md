# Garden and care hub acceptance checks

Automated coverage does not replace these Android, iOS, and browser checks.

- Verify Home, My Garden, and Care Tasks selection and back history. Scan is a raised camera action, not a fourth content tab. Check narrow screens, safe areas, large text, keyboard focus, VoiceOver, and TalkBack.
- Open Scan from every tab and from a plant profile. Confirm the tab bar disappears, target plant parameters survive, and closing returns appropriately. Repeat permission denial, background/cancel, duplicate capture, and synchronization retry checks from [scan checks](SCAN_MANUAL_CHECKS.md).
- Open old Search, Spaces, Notifications, Camera, and Explore bookmarks. Confirm redirects, with no template or unsupported-notifications page.
- On Home, verify both header actions remain, hardware management works, Plant Overview immediately follows hardware, and AI Summary is last.
- In My Garden, toggle By Space / All Plants with a search entered. Verify case-insensitive name/species/location filtering, clearing search, Unassigned, empty saved spaces, unknown status, and no generic care-plan banner.
- Create plants manually (guest and account), scan to add (account), open space/plant details, delete a plant, and open archives. Repeat offline/loading/error/empty-collection states.
- In Care Tasks, verify urgent recommendations and due/overdue schedule checks appear in Today; future checks appear in Upcoming. Unscheduled checks must be labeled manual, not live telemetry.
- Complete a task, restart, and verify persistence. Undo it. Complete a scheduled check and verify its next occurrence is based on completion plus the saved interval. Check local reminder time, midnight, background/resume, and timezone changes.
- Simulate a failed storage write. The checkbox must stay unchanged and show an error. Rapid taps must not duplicate completions.
- Switch account A → B → guest → A. Check that completion history and plants never cross accounts; guest task links open local spaces, not protected cloud detail routes.
- Complete and undo a scan-generated task. Confirm its account-synced status after refresh/restart. Simulate a failed or delayed update, background the app, and switch accounts; stale responses must not alter the new screen. Local schedule checks must remain usable when the task API is unavailable.
- Completed shows the latest 50 actions for currently saved plants; local storage retains at most 500 local actions. Local checklist completion is not cloud synchronization or proof of improved health; scan-generated tasks use the existing account API.

Also retain the [setup isolation checks](SETUP_MANUAL_CHECKS.md) and [hardware checks](DEVICE_CONNECTION_MANUAL_CHECKS.md). No dependencies or API contracts were changed. Repository instructions require SDK 54 documentation; installed Expo is SDK 57. Both documentation sets were consulted; runtime platform checks remain required.
