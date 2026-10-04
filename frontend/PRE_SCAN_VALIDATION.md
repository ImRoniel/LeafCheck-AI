# Pre-scan validation integration

The camera validates its captured local JPEG before `flow.scan` sends base64 to the backend. The public result is `{ valid, reason, guidance }`. Quality failures, invalid native outputs, missing native bindings, cancellation and timeout prevent upload; the retained preview offers a retake. Navigation, backgrounding, sign-out, permission loss and unmount abort the local session, and late native completion cannot submit.

## Image quality

Android/iOS use `react-native-image-quality@1.0.1` with Nitro Modules. The integration calls `ImageQuality.analyzeImageQuality` directly, not the package's helper (which catches errors and returns true). Both installed native implementations accept absolute local paths and run through `Promise.async`; Android strips `file://`, while iOS additionally decodes percent escapes. The adapter supplies a decoded absolute path from the captured file URL. Package flags determine blur/underexposure/overexposure; malformed/nonfinite metrics reject. Native thresholds are the package defaults, not plant-calibrated claims.

## Screen and printed-photo detection

The TypeScript integration expects a separately supplied Expo native module named `PlantReproduction`, exposing:

```ts
analyzeImage(uri: string): Promise<{
  real: number;
  screen: number;
  printed_photo: number;
}>;
```

Scores are normalized probabilities for the photographed subject. A screen or printed-photo score of at least 0.9 rejects with real-plant guidance. Uncertain semantic predictions pass only after quality succeeds. Invalid scores reject. The 0.9 threshold needs model-specific calibration.

**No classifier model or native detector implementation is bundled in this TypeScript-only change.** Without `PlantReproduction`, acceptable-quality captures return `validation_unavailable` and cannot upload. Quality metrics do not detect screens or printed photos; no placeholder classifier pretends otherwise. To enable successful native scans, supply the model-backed native module, process oriented bounded-resolution input off the UI thread, bundle weights offline and rebuild the client. This change implements the TypeScript policy/bridge and scanner gate, not native inference.

## Build and latency

`expo-dev-client` is installed and configured; rebuild with `npx expo run:android` or `npx expo run:ios` from `frontend/` after native dependencies/module changes. Expo Go and old clients without the bindings return unavailability. Web uses a separate adapter that never loads native packages and explains the native development-build requirement.

Validation has a 200ms end-to-end deadline, measured from validator invocation through image-quality and classifier return. This is a timeout policy, **not a measured device performance guarantee**. Late native work retains its concurrency slot until it settles, preventing overlapping retakes. Capture/base64 and network time are outside this deadline. No native device builds, accuracy calibration or latency measurements were performed in this environment.

## Verification

Run `npm run typecheck --workspace=frontend` and `npm test --workspace=frontend` from repository root. Behavioral tests cover structured results, native API/path mapping, screen/print policy, missing bindings, quality short-circuiting, timeout/cancellation, bounded native jobs, scanner upload gating and stale-session rejection. Native adapters are mocked in these tests; model accuracy and performance require device validation.
