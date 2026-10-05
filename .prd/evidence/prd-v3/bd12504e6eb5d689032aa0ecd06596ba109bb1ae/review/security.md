# Mechanical security audit

Final candidate bd12504e6eb5d689032aa0ecd06596ba109bb1ae.

History scan passed bounded fallback: changed-file snapshots across seven reviewed commits checked for private keys, Google/AWS keys and common live token prefixes; no matches. Source assignment review supplements patterns. No values retained. Dedicated gitleaks/trufflehog unavailable; not a comprehensive entropy scanner.

Environment conventions passed: .env and .env.* ignored except .env.example. Only frontend/.env.example is tracked credential-style configuration; other env-named files are source/docs.

Dependency audit has findings (exit 1): fresh npm audit --omit=dev --json reports 22 high, 0 critical (plus 11 moderate). Detailed packages/advisories in security.json. Advisory roots include braces stack exhaustion, deepmerge-ts recursive graph stack exhaustion and node-forge RSA signature verification; other high records propagate through dependency chains. References: package-lock.json:1841 (node-forge), :2962 (deepmerge-ts), :10801 (braces). Manifests/lockfile unchanged from base. Recommend recording as existing security issues and addressing through a separate dependency-remediation change; dependency upgrades are excluded by PRD v3. npm offers major downgrades; do not blindly apply audit fix.

Invalid HTTP input passed: node /tmp/leafcheck-v3-http.mjs sent empty and oversized JSON to configured backend POST /api/auth/login. Generic 403 ORIGIN_REJECTED and 413 BODY_TOO_LARGE, no stack/internal paths. Empty input was rejected by origin protection before credentials validation; this does not prove credential-field validation. Saved http-probe.mjs includes no credentials.
