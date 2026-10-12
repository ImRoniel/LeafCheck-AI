# Scan provider configuration

The backend uses the Gemini Developer API via the Google Generative AI SDK, not Vertex AI OAuth authentication.

## Gemini setup

1. Create a Gemini Developer API key in Google AI Studio for the intended project. Ensure the project has API access, quota, and billing if required by the chosen model.
2. Set `GEMINI_API_KEY` in the backend environment (locally, `backend/.env`). Use the API key itself, not an OAuth access token, a service-account JSON document, or a `Bearer …` value. Do not put it in a frontend `EXPO_PUBLIC_` variable.
3. Optionally set `GEMINI_MODEL` to a model available to that project. The default is `gemini-2.5-flash`. If Google retires this model, select a currently available compatible model.
4. Environment loading now resolves [the backend environment file](.env) relative to the backend module, independent of the launch directory. Restart the backend after editing configuration. Existing process/deployment environment variables take precedence over dotenv values; check the hosting secret if a local edit appears ineffective.
5. Check key API restrictions, project selection, and model access if authentication still fails. `ACCESS_TOKEN_TYPE_UNSUPPORTED` is treated as a provider configuration failure; it is not an expired LeafCheck user session.

Credentials are read when creating the scan model rather than at route import time. The SDK supplies the key in its API-key header. No manual bearer header is added. Never paste real keys into logs, tickets, screenshots, or source control.

## Other providers and expected outcomes

- `PLANTNET_API_KEY`: optional species hint. Missing or malformed keys, no matches, timeouts, quota limits and provider errors are logged by code and fall back to an Unknown hint. The whole attempt, including image preparation and response parsing, has an 8-second deadline. Only the Pl@ntNet upload is resized to at most 1024px on either edge and less than 1MB; Gemini and saved photos retain the original JPEG.
- Pipeline: optional Pl@ntNet → Gemini living-plant check and species identification → optional Perenual/cache and telemetry → Gemini diagnosis → save. Nonliving images return a short message before enrichment or persistence. Gemini may correct a Pl@ntNet hint; when Pl@ntNet fails, Gemini identifies the species for enrichment and saving. A living plant with unclear species can still receive general care advice; no Unknown species lookup is sent to Perenual.
- If diagnosis generation or report validation fails after confirming a living plant, the photo and identity still commit with an archived, null-text diagnosis marker. The API returns HTTP 201 with `diagnosisError`, `diagnosisCode` and a human-readable `diagnosisMessage`; no new care tasks or reminder are generated, and an existing plant's health status is preserved. Second-stage failures log their stage, provider status and full stack frames with credentials redacted.
- “Retry AI Diagnosis” sends the owned `plantId` with `reusePreviousImage: true`. This path reuses the saved identity/photo without repeating species identification, resolves the plant's current paired device, and fetches its newest MongoDB reading before generating diagnosis. Real-device prompts include temperature, humidity, raw soil ADC and lux with freshness context; raw ADC is never represented as a calibrated moisture percentage. Demo readings remain explicitly simulated.
- Scan responses and archives expose `telemetrySnapshot`, the measurements actually included in that diagnosis, with reading timestamp, prompt capture timestamp and simulated source flag. A null snapshot means image-only diagnosis, regardless of current pairing. Physical readings are fresh for 30 minutes at prompt capture (with one minute of clock-skew tolerance); older readings remain explicitly marked as historical. The saved badge retains that context. Plant Profile polls current telemetry while focused and offers re-evaluation when a fresh reading is newer than the saved snapshot. Archive and care-task loading fail independently.
- The frontend scan request defaults to a 120-second deadline to accommodate the two Gemini stages and persistence. Explicit caller/client timeout settings and cancellation remain supported; other API requests retain their existing defaults.
- `PERENUAL_API_KEY`: optional enrichment. Scientific-name and common-name searches are bounded by a shared timeout. Results must confirm the scientific identity before caching; no trustworthy match means diagnosis proceeds without reference specs. The Gemini prompt explicitly discloses this limitation.
- Gemini missing/invalid credentials or upstream authentication rejection return `SCAN_AI_CONFIGURATION` with 503. Rate limits return `SCAN_AI_BUSY`; other generation failures return `SCAN_AI_UNAVAILABLE`. Raw provider responses and credential-bearing URLs are not returned or logged by the scan error handler.

Automated provider tests mock network responses. They do not verify the validity of production credentials, available model quota, or live provider availability.

## Startup validation and diagnosis

Only the mandatory Gemini key is validated before the server listens. Gemini accepts **AIza** followed by 35 URL-safe characters or **AQ.** followed by a nonempty URL-safe suffix, without imposing the legacy length on newer keys. A missing or malformed Gemini key causes an actionable, secret-free startup message and exit status 1. Missing optional provider keys do not prevent startup. Format validation does not establish authorization, API restrictions, quota or model availability. Startup and both AI routes use the same Gemini validator.

See [the diagnosis and data-flow report](SCAN_DIAGNOSIS.md) for the reproduced upstream failure, implementation steps, and deployment remediation.
