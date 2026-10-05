---
prd: .prd/prd-v1.md
base: f8b7026159a72d2ecb5951ee50bfc069eb815762
candidate: 0285ee70aaab6de2cf8d9dbe60998bc4dbb627bf
evidence: .prd/evidence/prd-v1/0285ee70aaab6de2cf8d9dbe60998bc4dbb627bf/manifest.json
---

# Device API evaluation

PASS for the agreed backend endpoint scope. All four requirements and all 17 scenarios are delivered; none were cut, deferred or removed. Independent code review found no high-confidence endpoint defects. This evaluation concerns the selected PRD, not earlier feature evaluations.

POST /api/devices/claim validates and normalizes MAC identifiers, creates an owned UUID Device, updates an owner's optional name, and resolves foreign/concurrent claims. PATCH /api/plants/:plantId/pair-device pairs or unpairs owned resources, automatically clears other holders, and uses Serializable transactions with at most three conflict attempts. GET /api/plants/:plantId/telemetry resolves the paired MAC to the latest Mongo reading and applies plant moisture bounds. Existing UUID telemetry and demo routes are preserved; UUID-only readings do not appear in the MAC-only BFF.

Verified on candidate 0285ee7: focused claim tests 6/6, pairing tests 7/7, BFF tests 7/7, full backend tests 93/93, and backend TypeScript compilation. A disposable PostgreSQL 16 rerun passed all three real concurrency/rollback/ownership checks; its container was removed. HTTP smoke rejected empty input with 400 and oversized input with 413, returning generic errors before storage access. Runtime-exported schema 3 evidence retains command provenance, review artifacts, and coverage snapshots. C-06 confirms each endpoint commit followed verification: 5af32e9, cbdf1fe, 76f5486. C-07 records actual database concurrency evidence.

The security audit found pre-existing dependency advisories: 22 high/0 critical workspace entries, including 3 high/0 critical backend entries through deepmerge-ts and the Prisma configuration chain. These are package entries, not 22 distinct vulnerabilities. Dependency files are unchanged by this feature. Preserve as a known repository issue and investigate in a separate maintenance change; upgrades were explicitly excluded from this PRD. No real secret was found in the reviewed commit history, but no standalone secret scanner was installed: evidence records a redacted assignment heuristic and manual review, not an exhaustive scan. No live Atlas/Vercel integration or production deployment was tested. No UI was changed, so visual review is inapplicable.

Next, run `$pincer-release` to audit workflow artifacts. A dependency-maintenance change should assess advisory reachability and compatible fixes. Further integration testing should confirm Vercel writes uppercase hardware identifiers and the expected SensorReading fields in Atlas.

## Handover

Read this file first, then .prd/prd-v1.md, .prd/coverage/prd-v1.json and the candidate manifest referenced above. The manifest derives every requirement/scenario disposition from the coverage map and observed check results; read review/code-quality.md, review/security-audit.md and review/pairing-concurrency.md for the reviewer judgments and limits.

backend/src/routes/devices.ts owns claiming; backend/src/lib/device.ts serializes Device responses. backend/src/routes/plants.ts owns both plant endpoints; backend/src/lib/plant-pairing.ts owns transaction/retry behavior. backend/src/lib/ownership.ts accepts an optional transaction client so checks remain inside the transaction. Existing Express middleware authenticates into res.locals.auth.user.id. The PostgreSQL client is authoritative for ownership/associations; the MongoDB client supplies sensor readings keyed by hardware MAC.

No dependency was added. Existing Express handles routing and input/error envelopes, Prisma 6 supplies typed clients and Serializable transactions, Node crypto generates UUIDs, and Node native tests plus tsx exercise TypeScript routes. The TypeScript compiler checks strict types. Docker and postgres:16-alpine are only disposable test infrastructure: `node backend/scripts/test-plant-pairing.mjs` checks real database isolation and rollback without touching configured application databases. Daily checks are `npm test --workspace=backend` and `npx tsc --noEmit -p backend/tsconfig.json`.

The riskiest aging assumptions are identifier consistency across Vercel/PostgreSQL/MongoDB and other writers respecting pairing rules. Uppercase MAC keys and delimiter spelling must match upstream ingestion; no lowercase backfill, delimiter equivalence or UUID fallback is promised. Plant.deviceId has no global unique constraint, so the one-to-one guarantee applies to this endpoint's transaction, not arbitrary direct database writes. Live Atlas/Vercel data is the least-tested path. Claiming still trusts knowledge of the MAC as requested; it does not prove physical possession or transfer existing ownership. Default names use the hardware identifier; paired devices without readings return telemetry null. A code rollback leaves already claimed devices and changed pairings persisted.
