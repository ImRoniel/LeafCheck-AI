// ─────────────────────────────────────────────────────────────────────────────
// LeafCheck — Telemetry Routes
//
// POST /api/telemetry        → Validate + cross-DB device check + insert to MongoDB
// GET  /api/telemetry/:deviceId/latest  → Most recent reading
// GET  /api/telemetry/:deviceId/history → Paginated history
// ─────────────────────────────────────────────────────────────────────────────

import { Request, Response, Router } from "express";
import { requireAuth } from "../lib/auth.js";
import { asyncRoute, HttpError } from "../lib/http.js";
import { ownedDevice } from "../lib/ownership.js";
import { prismaPg } from "../lib/prisma-pg.js";
import { prisma } from "../lib/prisma.js";
import type { HardwareTelemetryPayload } from "../types/sensor.js";
import { serializeTelemetry } from "../lib/telemetry-payload.js";
import { serializableTransaction } from "../lib/serializable.js";
import { approvedHardware, normalizeHardwareMac } from "../lib/platform-policy.js";

export const telemetryRouter = Router();
// Only reads require user authentication. Firmware POST uses the hardware MAC address.
telemetryRouter.get(
  ["/:deviceId/latest", "/:deviceId/history"],
  requireAuth,
  asyncRoute(async (req, res, next) => {
    res.locals.device = await ownedDevice(req.params.deviceId, res.locals.auth.user.id);
    next();
  }),
);

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Validates the incoming telemetry payload from the ESP32.
 * Returns an array of error messages (empty if valid).
 */
function validateTelemetryPayload(body: unknown): string[] {
  const errors: string[] = [];
  const b = body as Record<string, unknown>;

  if (!b || typeof b !== "object" || Array.isArray(b)) {
    return ["Request body must be a JSON object."];
  }

  const fields = ["deviceId", "temperature", "humidity", "soilMoisture", "soilMoistureRaw", "lightLux", "lightLevel"];
  if (Object.keys(b).some((key) => !fields.includes(key))) {
    errors.push("Unexpected telemetry fields.");
  }

  // deviceId — hardware identifier accepted by the app claim route
  if (typeof b.deviceId !== "string" || !/^(?:LC-[0-9a-f]{6}|[0-9a-f]{2}(?::[0-9a-f]{2}){5}|[0-9a-f]{2}(?:-[0-9a-f]{2}){5})$/i.test(b.deviceId)) {
    errors.push("deviceId must be a valid sensor MAC address, such as LC-A50528.");
  }

  // Required numeric fields
  const requiredNumbers = ["temperature", "humidity", "soilMoisture"] as const;
  for (const field of requiredNumbers) {
    if (typeof b[field] !== "number" || !Number.isFinite(b[field] as number)) {
      errors.push(`${field} must be a finite number.`);
    }
  }

  // Optional numeric fields
  const optionalNumbers = ["soilMoistureRaw"] as const;
  for (const field of optionalNumbers) {
    if (b[field] !== undefined && b[field] !== null) {
      if (
        typeof b[field] !== "number" ||
        !Number.isFinite(b[field] as number)
      ) {
        errors.push(`${field} must be a finite number when provided.`);
      }
    }
  }

  // Match the firmware's supported sensor ranges and 12-bit soil ADC.
  for (const [field, min, max] of [
    ["temperature", -40, 125],
    ["humidity", 0, 100],
    ["soilMoisture", 0, 4095],
    ["soilMoistureRaw", 0, 4095],
  ] as const) {
    const value = b[field];
    if (typeof value === "number" && (value < min || value > max)) {
      errors.push(`${field} must be between ${min} and ${max}.`);
    }
  }
  for (const field of ["soilMoisture", "soilMoistureRaw"] as const) {
    // Older firmware supplies percentage in soilMoisture; explicit raw ADC takes precedence.
    if (field === "soilMoisture" && typeof b.soilMoistureRaw === "number") continue;
    if (typeof b[field] === "number" && !Number.isInteger(b[field])) {
      errors.push(`${field} must be an integer.`);
    }
  }
  if (b.lightLux === undefined && b.lightLevel === undefined) errors.push("lightLux or lightLevel is required.");
  for (const field of ["lightLux", "lightLevel"] as const) {
    if (b[field] !== undefined && (typeof b[field] !== "number" || !Number.isFinite(b[field]) || (b[field] as number) < 0)) {
      errors.push(`${field} must be a finite non-negative number.`);
    }
  }
  if (b.lightLux !== undefined && b.lightLevel !== undefined && b.lightLux !== b.lightLevel) errors.push("lightLux and lightLevel must agree when both are supplied.");

  return errors;
}

// ─── POST /api/telemetry ──────────────────────────────────────────────────────

/**
 * Ingest a new SensorReading from the ESP32 firmware.
 *
 * 1. Validate payload structure and numeric values.
 * 2. Resolve the device and active pairing in one short PostgreSQL snapshot.
 * 3. After commit, insert the frozen context and server timestamp into MongoDB.
 */
telemetryRouter.post("/", async (req: Request, res: Response) => {
  // Step 1: Validate payload
  const errors = validateTelemetryPayload(req.body);
  if (errors.length > 0) {
    console.warn("[Telemetry] Rejected invalid telemetry payload.");
    res.status(400).json({ error: "Validation failed.", details: errors });
    return;
  }

  const {
    deviceId,
    temperature,
    humidity,
    soilMoisture,
    soilMoistureRaw,
    lightLux,
    lightLevel,
  } = req.body as HardwareTelemetryPayload;

  try {
    // Resolve once. A move after this transaction must not reattribute the sample.
    const context = await serializableTransaction(prismaPg, async (tx) => {
      const macAddress = normalizeHardwareMac(deviceId);
      await approvedHardware(macAddress, tx);
      const device = await tx.device.findUnique({
        where: { macAddress },
      });
      if (!device) return null;
      const pairing = await tx.devicePairingHistory.findFirst({
        where: { deviceId: device.id, unpairedAt: null },
        select: { id: true, plantId: true },
      });
      return Object.freeze({
        macAddress: device.macAddress,
        plantId: pairing?.plantId ?? null,
        pairingId: pairing?.id ?? null,
        contextVersion: 1,
        timestamp: new Date(),
      });
    });

    if (!context) {
      console.warn("[Telemetry] Rejected telemetry for an unknown device.");
      res.status(404).json({
        error: "Device not found. Claim this Device ID in the app before sending telemetry.",
      });
      return;
    }

    // Virtual devices only accept the authenticated, owner-scoped demo generator.
    if (context.macAddress.startsWith("DEMO:")) {
      res
        .status(403)
        .json({ error: "Virtual devices do not accept hardware ingestion." });
      return;
    }

    // PostgreSQL has committed; MongoDB insertion does not re-resolve context.
    const reading = await prisma.sensorReading.create({
      data: {
        deviceId: context.macAddress,
        plantId: context.plantId,
        pairingId: context.pairingId,
        contextVersion: context.contextVersion,
        temperature,
        humidity,
        // Keep calibrated percentage unavailable until calibration exists.
        soilMoisture: null,
        soilMoistureRaw: soilMoistureRaw ?? soilMoisture,
        lightLux: lightLux ?? lightLevel,
        timestamp: context.timestamp,
      },
    });

    res.status(201).json(reading);
  } catch (error: unknown) {
    if (error instanceof HttpError && error.code === "HARDWARE_NOT_APPROVED") {
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    console.error("[Telemetry] POST ingest failed.");
    res.status(500).json({ error: "Failed to store telemetry reading." });
  }
});

// ─── GET /api/telemetry/:deviceId/latest ──────────────────────────────────────

/**
 * Returns the most recent SensorReading for a device,
 * shaped as a TelemetryPayload for the frontend.
 */
telemetryRouter.get(
  "/:deviceId/latest",
  async (req: Request, res: Response) => {
    const device: Awaited<ReturnType<typeof ownedDevice>> = res.locals.device;
    const isDemo = device.macAddress.startsWith("DEMO:");
    const deviceId = isDemo ? device.id : device.macAddress;

    try {
      const reading = await prisma.sensorReading.findFirst({
        where: { deviceId },
        orderBy: { timestamp: "desc" },
      });

      if (!reading) {
        res.status(404).json({ error: "No telemetry found for this device." });
        return;
      }

      res.json(serializeTelemetry(reading, device.id, isDemo));
    } catch (error) {
      console.error("[Telemetry] GET latest error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ─── GET /api/telemetry/:deviceId/history ─────────────────────────────────────

/**
 * Returns paginated historical readings for a device.
 * Query params: ?limit=50&offset=0
 */
telemetryRouter.get(
  "/:deviceId/history",
  async (req: Request, res: Response) => {
    const device: Awaited<ReturnType<typeof ownedDevice>> = res.locals.device;
    const isDemo = device.macAddress.startsWith("DEMO:");
    // Match the identity used by the plant's live telemetry query.
    const deviceId = isDemo ? device.id : device.macAddress;
    const limit = Math.min(
      Math.max(parseInt(req.query.limit as string) || 50, 1),
      200,
    );
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

    try {
      const [readings, total] = await Promise.all([
        prisma.sensorReading.findMany({
          where: { deviceId },
          orderBy: { timestamp: "desc" },
          take: limit,
          skip: offset,
        }),
        prisma.sensorReading.count({ where: { deviceId } }),
      ]);

      res.json({
        data: readings.map((reading) => ({
          id: reading.id,
          deviceId: device.id,
          timestamp: reading.timestamp.toISOString(),
          temperature: reading.temperature,
          humidity: reading.humidity,
          soilMoisture: isDemo ? reading.soilMoisture ?? null : null,
          soilMoistureRaw: isDemo
            ? reading.soilMoistureRaw ?? null
            : reading.soilMoistureRaw ?? reading.soilMoisture ?? null,
          lightLevel: isDemo ? reading.lightLevel ?? null : reading.lightLux ?? reading.lightLevel ?? null,
        })),
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + limit < total,
        },
      });
    } catch (error) {
      console.error("[Telemetry] GET history error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);
