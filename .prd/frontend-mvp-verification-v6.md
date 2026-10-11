# PRD v6 — AsyncStorage MVP verification

Recorded: 2026-10-11. Real-device review C-04: **unverified**.

This workspace has no connected real Expo Go device/session or Android device
bridge (`adb` is unavailable). Device platform, OS, Expo Go version and reset
method are therefore unavailable. No device observations are claimed. Follow
`frontend/tests/INSTALL_ONBOARDING_MANUAL_CHECKS.md` and record actual runtime,
date, reset method and observations here when a device is available.

| State / action | Expected observation | Real Expo Go result |
| --- | --- | --- |
| Missing flag, anonymous | Brief Splash → all slides → Login after save | Unverified |
| Flag false, anonymous | Brief Splash → all slides → Login after save | Unverified |
| Missing/false, valid session | Brief Splash → slides → Dashboard after save | Unverified |
| Flag true, no credential | Brief Splash → Login | Unverified |
| Flag true, rejected credential | Brief Splash → Login after verified rejection | Unverified |
| Flag true, valid restored session | Brief Splash → Dashboard | Unverified |
| Flag true, valid session with pending garden setup | Brief Splash → Dashboard; explicit setup available | Unverified |
| Complete slides and reload | Persisted true skips slides; brief Splash still appears | Unverified |
| Logout/account switch/guest entry | Flag retained; account data isolated | Unverified |
| Slow reads/restore, malformed data, rejected writes | Relevant splash gating and sanitized recovery; no premature completion | Unverified |
| Direct links/Back before completion | Cannot bypass intro | Unverified |

Automated verification is recorded by ticket attempts under `.pincer/runtime/`;
these test shared storage, boolean validation, durable/retry behavior, routing,
splash timing/cleanup and verified session restoration. Those results are distinct
from the required real-device review. Full PRD completion remains pending C-04;
no scope deferral or removal was authorized.

Guidance review C-03: current README and manual checklist were reviewed against
the one-key AsyncStorage design, secure existing auth restore, direct Dashboard,
no custom onboarding build, legacy-marker replay and removed backup guarantees.
Historical PRDs and earlier evidence remain preserved. No token values recorded.
