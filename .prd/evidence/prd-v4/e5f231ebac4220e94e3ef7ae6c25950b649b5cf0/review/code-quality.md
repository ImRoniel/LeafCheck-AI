# PRD v4 code quality review

Base: 50fa92d1730fb9ebda86890f871299fb0f25992b
Candidate: e5f231ebac4220e94e3ef7ae6c25950b649b5cf0
Method: independent inline review using .claude/agents/code-quality-reviewer.md; subagents unavailable. Reviewed the complete change inventory and separate production/storage/native, tests and workflow passes. This report records reviewer judgment, not independent attestation.

## Findings

No newly introduced code defects above the rubric's 70-confidence threshold were identified in the agreed scope.

Existing security issue, confidence 100: package-lock.json:12954 selects shell-quote in the vulnerable range reported by npm (critical GHSA-pqg4-j6r4-53mv, quote() command injection). The current omitted-dev audit has 1 critical and 23 high package vulnerability records. This lockfile is unchanged from the recorded base; no dependency upgrade was part of PRD v4. Recommend a separate dependency remediation ticket now; do not run audit fix --force blindly because reported Expo/React Native fixes include incompatible version changes. No claim of exploit reachability in this app is established by npm's dependency graph alone.

Existing visual issue, confidence 100: frontend/components/onboarding-slider.tsx:136 displays mojibake in the last slide CTA (garbled apostrophe). The same literal exists at the base; no copy redesign was authorized. Record as a baseline UI issue and repair in a separate small ticket.

## Compliance and adequacy

Intro provider/tree are outside account-keyed state; restore cannot authorize an intro bypass. All root application routes are explicitly declared and guarded to prevent Expo Router auto-added screens from bypassing intro. Marker parsing rejects unsupported/malformed data; durable completion publishes only after a successful write, concurrent writes coalesce and synchronous I/O errors remain retryable. Missing native module does not select a backed-up fallback. Native secrets remain in the unchanged SecureStore adapter, access tokens remain in memory, and no credential is written to intro storage. Native source exclusion/atomicity are reviewed statically, not certified by compilation.

C-01 protects post-intro startup behavior; C-02 exercises store/adapters plus auth regression and static native contracts; C-03 exercises actual component guards/actions and deferred races; C-04 exercises integrated store/route/actions and the full suite/typecheck; C-12 is independent actual-browser rendering with controlled API responses. Mocked VM tests cannot prove platform backup or native navigation. User-resolved D-01 defers S-06/S-07/S-11 and native obligations C-05/C-06. Ten in-scope scenarios are adequately covered by the declared behavioral checks and browser evidence; original full native delivery is explicitly incomplete.

Security environment/history checks are separate C-07/C-08. C-09 audit failures are retained; Final candidate C-10 passed against the configured API: empty JSON returned 403 and oversized JSON returned 413, both clean 4xx responses without stack traces. No backend, database or hardware behavior was changed, and no live database mutations were performed.
