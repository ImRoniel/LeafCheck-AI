# Scan experience device checks

Automated checks cover error mapping and the existing scan lifecycle. The following visual and native-camera checks still require a device; they have not been executed by the coding agent.

- On iOS and Android, open the scanner from each bottom-navigation destination. Confirm the live feed fills the screen without rounded preview edges, page margins, or the floating tab bar.
- Confirm the close button returns to the previous screen, including during capture or analysis. Open the scanner directly and confirm closing still provides a route home.
- Check a narrow phone, a tall notched phone, and a tablet. The title, two short instructions, and controls must remain readable without overlapping safe areas. Test large accessibility text; the lower controls should scroll when necessary.
- Confirm the framing corners leave the leaves visible, and the shutter is disabled until the camera is ready. Capture a photo and confirm the frozen preview fills the same background.
- Photograph a non-plant object. Confirm a warm suggestion to move closer to well-lit leaves appears, with no provider name, JSON, or status code. Tap “Try another photo” and confirm the camera restarts and the previous error clears.
- Test offline mode, a slow connection, service failure, and expired sign-in. Confirm actionable messages rather than raw diagnostics.
- Deny camera permission, then deny permanently. Confirm “Allow camera” and “Open settings” work as appropriate. Return from device settings and check permission state.
- Background the app during capture and analysis, then return. Confirm no duplicate scans or stale camera updates occur.
- Complete a successful scan. Confirm the report remains scrollable, the back action is visible, and “New Scan” restores the live camera. Simulate a synchronization failure and confirm “Retry Sync” retains the report without repeating identification.
- Check VoiceOver/TalkBack labels for close, capture, and retake; verify scan errors are announced and light status-bar icons remain readable.
