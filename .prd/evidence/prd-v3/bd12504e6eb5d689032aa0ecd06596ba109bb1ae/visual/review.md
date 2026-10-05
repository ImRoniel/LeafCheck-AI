# C-08 final candidate visual review

Candidate bd12504e6eb5d689032aa0ecd06596ba109bb1ae; reviewed 2026-10-05. Chromium 134 / Playwright 1.51.1, Linux, 430x932 viewport, reduced motion. Browser tooling resides in external caches; project dependencies unchanged. Latest Chromium download timed out; supported Ubuntu 24.04 x64 fallback succeeded with extended timeout.

Commands: CI=1 npm run web --workspace=frontend -- --port 8087; VISUAL_OUTPUT_DIR=<candidate evidence>/visual PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 node /tmp/leafcheck-v3-visual.cjs. Exact capture script saved as capture.cjs. Metro restarted after the fix so CI cached bundles did not masquerade as corrected source.

All API requests intercepted with controlled fixtures; no live claim/pair writes. Synthetic auth stays fixture-only. Captures show actual production Expo UI with internal ScrollViews scrolled to the relevant controls; viewport captures, not stitched content.

Inspected all 12 PNGs: loading spinner/disabled refresh; unpaired/context action; waiting/device name; temperature/humidity/moisture/lux; error/retry; profile editing; disabled claiming; ownership conflict/manual entry; locked target; disabled pairing; success; contextual profile navigation. Existing light theme, green buttons, cards, typography and Notice patterns remain. No visibly broken changed UI or duplicate-key error banner remains. Console monitor rejects duplicate-key errors; T-13 resolved the earlier finding.

Metrics are fixture values 24 C, 62%, 45%, 350 lux; intentionally old timestamp shows correct stale guidance. Never claimed as physical readings. Native camera/live hardware remains user-attested T-12, not independently browser-exercised. Accessibility states separately pass web rendering tests.

Frontend-only scope/security artifacts attached. Existing dependency advisories remain known issues, not a clean-security claim.
