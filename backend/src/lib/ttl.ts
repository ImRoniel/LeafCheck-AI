// ─────────────────────────────────────────────────────────────────────────────
// LeafCheck — MongoDB TTL Index Management
//
// Enforces configurable data retention on SensorReading documents.
// Controlled by MONGO_TELEMETRY_RETENTION_DAYS env var:
//   0 or unset  → unlimited retention (no TTL index)
//   >0          → auto-expire documents after N days
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from "./prisma.js";

const TTL_INDEX_NAME = "ttl_telemetry_retention";

/**
 * Ensures a TTL index on SensorReading.timestamp if retention is configured.
 * Idempotent — safe to call on every server boot.
 */
export async function ensureTTLIndex(): Promise<void> {
  const raw = process.env.MONGO_TELEMETRY_RETENTION_DAYS ?? "0";
  const retentionDays = parseInt(raw, 10);

  if (isNaN(retentionDays) || retentionDays <= 0) {
    console.log(
      "[TTL] MONGO_TELEMETRY_RETENTION_DAYS=%s → unlimited retention (no TTL index).",
      raw,
    );
    return;
  }

  const expireAfterSeconds = retentionDays * 24 * 60 * 60;

  try {
    await prisma.$runCommandRaw({
      createIndexes: "SensorReading",
      indexes: [
        {
          key: { timestamp: 1 },
          name: TTL_INDEX_NAME,
          expireAfterSeconds,
        },
      ],
    });
    console.log(
      "[TTL] Ensured %d-day TTL index on SensorReading.timestamp (%d seconds).",
      retentionDays,
      expireAfterSeconds,
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    // MongoDB returns IndexOptionsConflict if the index already exists with matching options
    if (
      message.includes("already exists") ||
      message.includes("IndexOptionsConflict")
    ) {
      console.log("[TTL] TTL index already exists — no changes needed.");
    } else {
      console.error("[TTL] Failed to create TTL index:", error);
    }
  }
}
