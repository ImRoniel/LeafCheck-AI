# Scan authentication diagnosis

## Confirmed cause

A read-only Gemini model-list request with the configured local credential reproduced HTTP **401**, **UNAUTHENTICATED**, reason **ACCESS_TOKEN_TYPE_UNSUPPORTED**. No image or generation prompt was sent. The credential has an **AQ.** prefix. Its value is intentionally omitted. **Correction:** this individual rejection does not establish that the prefix is invalid. Newer AI Studio keys can use this prefix, and local validation now accepts both **AIza** and **AQ.** formats.

The installed Google Generative AI SDK sends the supplied credential in the API-key header to the Gemini Developer API. It does not add a bearer authorization header. Neither Pl@ntNet, Perenual, nor the frontend user-session token supplies Gemini authentication.

The scan helper already resolved its key at request time before this fix. Thus import-time initialization was **not** the direct cause of the reported scan failure. The initial remediation incorrectly restricted validation to legacy keys, creating a startup false positive for newer keys; that restriction has been corrected. The separate legacy AI endpoint did capture credentials at import time and use an older hard-coded model; that independent defect is now fixed too.

The inspection found no inherited Gemini key overriding the local value and no alternate Google key setting. Previously, dotenv resolved relative to the launch directory; environment loading now uses a stable backend-relative path while preserving deployment-variable precedence.

## Data flow

```mermaid
flowchart TD
  A[Camera capture or image picker: JPEG base64] --> B[Frontend scan flow: authenticated backend request]
  B --> C[Backend scan route: authentication, ownership and input checks]
  C --> D[Runtime Gemini credential validation and SDK model creation]
  D --> E[Pl@ntNet: multipart JPEG upload]
  E --> F[Species identity and confidence]
  F --> G[PostgreSQL species cache lookup]
  F --> H[MongoDB latest device telemetry, if associated]
  G -->|cache miss| I[Perenual: species and common-name queries; no image]
  I -->|verified match| J[Populate species cache]
  I -->|missing or unavailable| K[Disclose missing reference specs]
  G -->|cache hit| L[Build diagnostic prompt]
  J --> L
  K --> L
  H --> M[Calculate telemetry freshness]
  M --> L
  A --> N[Gemini SDK: original JPEG inline data]
  L --> N
  N --> O[Structured diagnosis, care tasks and notification]
  O --> P[PostgreSQL: plant if new, identification, analysis, tasks and health update]
  P --> Q[201 response: frontend diagnostic report]
```

Species enrichment and telemetry retrieval run concurrently. Missing Perenual data is optional; Gemini authentication is mandatory. Scan persistence starts after generation succeeds, although species-cache writes may occur earlier. No fabricated diagnosis is used to hide an authentication rejection.

## Implementation

1. Centralize backend environment loading in [env.ts](src/lib/env.ts), shared by startup, auth configuration and database clients.
2. Validate mandatory Gemini and Pl@ntNet configuration in [provider-config.ts](src/lib/provider-config.ts). Gemini validation accepts legacy **AIza** and newer **AQ.** key shapes. This checks format only, not revocation, restrictions, quota or model access.
3. Execute [provider-startup.ts](src/lib/provider-startup.ts) before server dependencies initialize. Missing or malformed mandatory credentials produce a redacted, actionable message and exit status 1 before listening. Perenual remains optional.
4. Resolve credentials on each model creation in [gemini.ts](src/lib/gemini.ts), without module-level credential caching or automatic fallback to another credential source. Share model selection and the 45-second timeout across both endpoints; retain JSON output for scans and text output for legacy analysis.
5. Validate before external identification in [scan.ts](src/routes/scan.ts). Sanitize authentication, quota and network errors in both this route and [ai.ts](src/routes/ai.ts); provider authentication errors become service-configuration 503 responses, not user-session 401 responses.
6. Test real SDK headers with mocked HTTP, runtime key rotation, startup failure, legacy endpoint recovery, scan cache behavior and failure-before-persistence.

## Operational remediation and verification limits

Configure a Gemini Developer API key from Google AI Studio using either supported prefix and restart the backend. If Google still rejects a request, investigate that key's authorization, restrictions and project/API access rather than inferring invalidity from its prefix. Do not paste a bearer token or service-account document into the API-key setting. Existing deployment environment values take precedence over the local environment file.

The local secret was not modified. An otherwise well-formed **AQ.** key no longer blocks startup or runtime model creation. A successful live diagnostic scan still requires provider authorization. Automated tests use synthetic credentials and mocked providers; they do not establish live key validity or quota.

The backend build initially encountered a Windows engine-file lock. Retrying after the lock cleared successfully regenerated the declared Prisma 6.19.3 clients, compiled TypeScript, and packaged the PostgreSQL client. This also addressed the stale installed client encountered during the first test run; no Prisma upgrade or schema change was made for this fix.

Final verification: backend build **passed**; standalone TypeScript checking **passed**; full backend test suite **51 passed, 0 failed**. Backend source/test whitespace checks passed (Git reported only line-ending conversion warnings). Successful scan-route tests use mocked providers and storage; the live read-only probe reproduced the credential rejection, not a successful production diagnosis.
