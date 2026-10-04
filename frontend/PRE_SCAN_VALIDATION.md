# Expo Go pre-scan validation

The scanner passes the JPEG base64 and dimensions already returned by Expo Camera to a shared pure TypeScript validator before uploading. No custom native modules, classifier bindings, file reads or additional packages are required.

The result is `{ valid: boolean, reason: string, guidance: string }`:

- `ok`: decoded JPEG file size is at least 50 KiB (51,200 bytes), and each dimension is at least 320 pixels.
- `image_too_small`: JPEG file size is below 50 KiB; suggest filling the frame with well-lit leaves.
- `low_resolution`: either image dimension is below 320 pixels; suggest a higher-resolution capture.
- `invalid_image`: base64 is missing/malformed or dimensions are missing, nonpositive or not safe integers.
- `cancelled`: the camera session was cancelled.

File bytes are calculated from base64 length minus padding, excluding base64 overhead. The camera already produces JPEG base64 for upload, so validation does not read the file or decode pixels. Portrait and landscape dimensions are both supported. The size threshold is a coarse exhibit heuristic: a compressed valid photo may be rejected, while a dark/blank photo may exceed it. It does not detect blur, exposure, screens, printed photos or plant presence. The current camera compression setting remains unchanged.

Rejected images stay in the preview with retake guidance and never reach the scan API. Session cancellation and generation guards still prevent stale uploads after navigation, backgrounding, sign-out or unmounting. Validation uses the same code on Android, iOS and web, with no native availability gate.

Run `npm start --workspace=frontend -- --go` for Expo Go. Android/iOS scripts launch Expo rather than building native clients. Device camera behavior still needs an exhibit-device smoke test.

Verification: `npm run typecheck --workspace=frontend` and `npm test --workspace=frontend`.
