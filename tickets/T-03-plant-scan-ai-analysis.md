---
ticket: T-03
status: done
size: L
prd: .prd/prd-v1.md
depends_on: [T-02]
started: 2026-10-02T12:37:14Z
finished: 2026-10-02T12:45:16Z
---

## Objective

Deliver the image-based plant scan and AI analysis flow with provider validation, ownership gating, and a safe degraded failure path.

## Context

- Relevant files: `backend/src/routes/scan.ts`, `backend/src/lib/plantnet.ts`, `backend/src/routes/ai.ts`, `backend/src/lib/plant-specs.ts`
- PRD section: `R-03` and `R-05`
- Implements: R-03, R-05

## Requirements

- The scan route must require an owned plant and, when present, a valid owned device association before provider calls start.
- Plant image submissions must validate size and payload shape before invoking the identification or diagnosis pipeline.
- The backend must preserve provider context (species, telemetry freshness, and stored analysis metadata) without exposing raw secrets or provider internals to the client.

## Acceptance Criteria

- [x] A valid plant image produces a species identification and a health analysis response with preserved context metadata.
- [x] Oversized or malformed images are rejected before external provider calls are attempted.
- [x] Cross-user or mismatched device/plant access is blocked before any AI or provider processing.
- [x] Provider failures surface as safe, generic errors while the server retains detailed diagnostics privately.

## Verification

Proves: This verifies the scan path’s happy path and rejection logic, including the required ownership and validation gates before AI processing.

```bash
cd backend && node --import tsx/esm --experimental-test-module-mocks --test tests/scan-providers.test.mjs tests/scan-cache.test.mjs tests/ai-runtime.test.mjs
```

## Constraints

- Do not replace the structured analysis contract with a JSON-only LLM schema beyond the current app contract.
- Do not bypass ownership checks in favor of a faster provider call.
