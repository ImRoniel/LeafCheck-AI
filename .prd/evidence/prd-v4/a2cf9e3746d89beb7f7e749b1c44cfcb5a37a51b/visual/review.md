# Browser visual review

Candidate e5f231ebac4220e94e3ef7ae6c25950b649b5cf0; Chromium 134 via existing Playwright 1.51.1, viewport 430x932. A fresh exported browser build was served only on localhost. Separate clean browser contexts used controlled API responses for anonymous and restored sessions; no real account login or server mutation was used.

Inspected screenshots: original white branded splash; light botanical intro with existing green palette, responsive copy and footer; anonymous login; restored-session pending garden setup. Both contexts showed all three slides before their final route, stored the non-secret completion marker and skipped intro on reload. The restored context reached /setup/experience without login. Browser page error arrays were empty. Safe areas/layout were visually intact at this viewport. A baseline mojibake apostrophe is visible in the final CTA and recorded in code-quality.md.

This passes C-12 browser inspection only. Native visual review C-06 remains deferred/unverified; Android Back, native accessibility, large-text/native device variants and physical backup/device transfer were not established by these screenshots.

The browser-check.cjs script and observations JSON record the exact fixture flow. Screenshots include both anonymous and restored splash, first and third slides and post-intro screens.

Fresh browser captures for final candidate a2cf9e3746d89beb7f7e749b1c44cfcb5a37a51b use the newly exported web build; T-19 changes only the workflow scanner. Screens were inspected directly. Authentication fixtures do not establish real native restoration.
