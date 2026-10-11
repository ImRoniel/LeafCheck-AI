// ─────────────────────────────────────────────────────────────────────────────
// LeafCheck — Telemetry Routes
//
// POST /api/telemetry        → Validate + cross-DB device check + insert to MongoDB
// GET  /api/telemetry/:deviceId/latest  → Most recent reading
// GET  /api/telemetry/:deviceId/history → Paginated history
// ─────────────────────────────────────────────────────────────────────────────

import { Request, Response, Router } from "express";
import { requireAuth } from "../lib/auth.js";
import { asyncRoute } from "../lib/http.js";
import { ownedDevice } from "../lib/ownership.js";
import { prismaPg } from "../lib/prisma-pg.js";
import { prisma } from "../lib/prisma.js";
import type { HardwareTelemetryPayload, TelemetryPayload } from "../types/sensor.js";

export const telemetryRouter = Router();
// Only reads require user authentication. Firmware POST uses the hardware MAC address.
telemetryRouter.get(
  ["/:deviceId/latest", "/:deviceId/history"],
  requireAuth,
  asyncRoute(async (req, res, next) => {
    await ownedDevice(req.params.deviceId, res.locals.auth.user.id);
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

  const fields = ["deviceId", "temperature", "humidity", "soilMoisture", "soilMoistureRaw", "lightLux"];
  if (Object.keys(b).some((key) => !fields.includes(key))) {
    errors.push("Unexpected telemetry fields.");
  }

  // deviceId — hardware identifier accepted by the app claim route
  if (typeof b.deviceId !== "string" || !/^(?:LC-[0-9a-f]{6}|[0-9a-f]{2}(?::[0-9a-f]{2}){5}|[0-9a-f]{2}(?:-[0-9a-f]{2}){5})$/i.test(b.deviceId)) {
    errors.push("deviceId must be a valid sensor MAC address, such as LC-A50528.");
  }

  // Required numeric fields
  const requiredNumbers = ["temperature", "humidity", "soilMoisture", "lightLux"] as const;
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
    if (typeof b[field] === "number" && !Number.isInteger(b[field])) {
      errors.push(`${field} must be an integer.`);
    }
  }
  if (typeof b.lightLux === "number" && b.lightLux < 0) {
    errors.push("lightLux must be non-negative.");
  }

  return errors;
}

// ─── POST /api/telemetry ──────────────────────────────────────────────────────

/**
 * Ingest a new SensorReading from the ESP32 firmware.
 *
 * 1. Validate payload structure and numeric values.
 * 2. Cross-DB check: resolve the hardware MAC address to a PostgreSQL device UUID.
 * 3. Insert into MongoDB with server-authoritative timestamp.
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
  } = req.body as HardwareTelemetryPayload;

  try {
    // Step 2: Cross-DB device verification (PostgreSQL)
    const device = await prismaPg.device.findUnique({
      where: { macAddress: deviceId.toUpperCase() },
    });

    if (!device) {
      console.warn("[Telemetry] Rejected telemetry for an unknown device.");
      res.status(404).json({
        error: "Device not found. Claim this Device ID in the app before sending telemetry.",
      });
      return;
    }

    // Virtual devices only accept the authenticated, owner-scoped demo generator.
    if (device.macAddress?.startsWith("DEMO:")) {
      res
        .status(403)
        .json({ error: "Virtual devices do not accept hardware ingestion." });
      return;
    }

    // Step 3: Insert into MongoDB with server-authoritative timestamp
    const reading = await prisma.sensorReading.create({
      data: {
        deviceId: device.id,
        temperature,
        humidity,
        // Keep calibrated percentage unavailable until calibration exists.
        soilMoisture: null,
        soilMoistureRaw: soilMoistureRaw ?? soilMoisture,
        lightLevel: lightLux,
        timestamp: new Date(), // Server-authoritative
      },
    });

    res.status(201).json(reading);
  } catch (error) {
    console.error("[Telemetry] POST ingest error:", error);
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
    const deviceId = req.params.deviceId as string;

    try {
      const reading = await prisma.sensorReading.findFirst({
        where: { deviceId },
        orderBy: { timestamp: "desc" },
      });

      if (!reading) {
        res.status(404).json({ error: "No telemetry found for this device." });
        return;
      }

      // Map Prisma SensorReading → TelemetryPayload (frontend contract)
      const payload: TelemetryPayload = {
        deviceId: reading.deviceId,
        timestamp: reading.timestamp.toISOString(),
        soilMoisture: {
          percentage: reading.soilMoisture ?? null,
          rawAnalogValue: reading.soilMoistureRaw ?? null,
          status:
            reading.soilMoisture == null
              ? "unavailable"
              : reading.soilMoisture > 70
              ? "overwatered"
              : reading.soilMoisture < 30
                ? "dry"
                : "optimal",
        },
        lightLevel: {
          lux: reading.lightLevel ?? null,
          status:
            reading.lightLevel == null
              ? "unavailable"
              : reading.lightLevel < 500
              ? "insufficient"
              : reading.lightLevel > 50_000
                ? "excessive"
                : "optimal",
        },
        environment: {
          temperatureCelsius: reading.temperature,
          humidityPercentage: reading.humidity,
        },
      };

      res.json(payload);
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
    const deviceId = req.params.deviceId as string;
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
        data: readings,
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
