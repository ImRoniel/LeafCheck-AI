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
import { TelemetryPayload } from "../types/sensor.js";

export const telemetryRouter = Router();
// Only reads require user authentication. Firmware POST remains unchanged.
telemetryRouter.get(
  ["/:deviceId/latest", "/:deviceId/history"],
  requireAuth,
  asyncRoute(async (req, res, next) => {
    await ownedDevice(req.params.deviceId, res.locals.auth.user.id);
    next();
  }),
);

// ─── Validation ───────────────────────────────────────────────────────────────

interface TelemetryBody {
  deviceId: string;
  temperature: number;
  humidity: number;
  soilMoisture: number;
  soilMoistureRaw?: number;
  lightLevel?: number;
}

/**
 * Validates the incoming telemetry payload from the ESP32.
 * Returns an array of error messages (empty if valid).
 */
function validateTelemetryPayload(body: unknown): string[] {
  const errors: string[] = [];
  const b = body as Record<string, unknown>;

  if (!b || typeof b !== "object") {
    return ["Request body must be a JSON object."];
  }

  // deviceId — required non-empty string
  if (typeof b.deviceId !== "string" || b.deviceId.trim() === "") {
    errors.push("deviceId must be a non-empty string.");
  }

  // Required numeric fields
  const requiredNumbers = ["temperature", "humidity", "soilMoisture"] as const;
  for (const field of requiredNumbers) {
    if (typeof b[field] !== "number" || !Number.isFinite(b[field] as number)) {
      errors.push(`${field} must be a finite number.`);
    }
  }

  // Optional numeric fields
  const optionalNumbers = ["soilMoistureRaw", "lightLevel"] as const;
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

  return errors;
}

// ─── POST /api/telemetry ──────────────────────────────────────────────────────

/**
 * Ingest a new SensorReading from the ESP32 firmware.
 *
 * 1. Validate payload structure and numeric values.
 * 2. Cross-DB check: verify deviceId exists in PostgreSQL.
 * 3. Insert into MongoDB with server-authoritative timestamp.
 */
telemetryRouter.post("/", async (req: Request, res: Response) => {
  // Step 1: Validate payload
  const errors = validateTelemetryPayload(req.body);
  if (errors.length > 0) {
    res.status(400).json({ error: "Validation failed.", details: errors });
    return;
  }

  const {
    deviceId,
    temperature,
    humidity,
    soilMoisture,
    soilMoistureRaw,
    lightLevel,
  } = req.body as TelemetryBody;

  try {
    // Step 2: Cross-DB device verification (PostgreSQL)
    const device = await prismaPg.device.findUnique({
      where: { id: deviceId },
    });

    if (!device) {
      res.status(404).json({
        error: "Device not found.",
        details: `No device with id "${deviceId}" exists in the system.`,
      });
      return;
    }

    // Step 3: Insert into MongoDB with server-authoritative timestamp
    const reading = await prisma.sensorReading.create({
      data: {
        deviceId,
        temperature,
        humidity,
        soilMoisture,
        soilMoistureRaw: soilMoistureRaw ?? null,
        lightLevel: lightLevel ?? null,
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
          percentage: reading.soilMoisture,
          rawAnalogValue: reading.soilMoistureRaw ?? 0,
          status:
            reading.soilMoisture > 70
              ? "overwatered"
              : reading.soilMoisture < 30
                ? "dry"
                : "optimal",
        },
        lightLevel: {
          lux: reading.lightLevel ?? 0,
          status:
            (reading.lightLevel ?? 0) < 500
              ? "insufficient"
              : (reading.lightLevel ?? 0) > 50_000
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
