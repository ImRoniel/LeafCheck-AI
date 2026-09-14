import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { TelemetryPayload } from "../types/sensor.js";

export const telemetryRouter = Router();

/**
 * GET /api/telemetry/:deviceId/latest
 * Returns the most recent SensorReading for a device, shaped as TelemetryPayload.
 */
telemetryRouter.get("/:deviceId/latest", async (req: Request, res: Response) => {
  const { deviceId } = req.params;

  try {
    const reading = await prisma.sensorReading.findFirst({
      where: { deviceId },
      orderBy: { timestamp: "desc" },
    });

    if (!reading) {
      res.status(404).json({ error: "No telemetry found for this device." });
      return;
    }

    // Map Prisma SensorReading → TelemetryPayload (aligned with firmware output)
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
      phLevel: {
        value: reading.phLevel ?? 7.0,
        status:
          (reading.phLevel ?? 7.0) < 6.0
            ? "acidic"
            : (reading.phLevel ?? 7.0) > 7.5
            ? "alkaline"
            : "optimal",
      },
      parLight: {
        ppfd: reading.lightLevel ?? 0,
        status:
          (reading.lightLevel ?? 0) < 100
            ? "insufficient"
            : (reading.lightLevel ?? 0) > 800
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
});

/**
 * POST /api/telemetry
 * Ingest a new SensorReading from the ESP32 firmware.
 * Body matches the firmware serial payload shape.
 */
telemetryRouter.post("/", async (req: Request, res: Response) => {
  const { deviceId, soilMoisture, soilMoistureRaw, phLevel, lightLevel, temperature, humidity } =
    req.body as {
      deviceId: string;
      soilMoisture: number;
      soilMoistureRaw?: number;
      phLevel?: number;
      lightLevel?: number;
      temperature: number;
      humidity: number;
    };

  try {
    const reading = await prisma.sensorReading.create({
      data: {
        deviceId,
        soilMoisture,
        soilMoistureRaw: soilMoistureRaw ?? 0,
        phLevel,
        lightLevel,
        temperature,
        humidity,
      },
    });

    res.status(201).json(reading);
  } catch (error) {
    console.error("[Telemetry] POST ingest error:", error);
    res.status(500).json({ error: "Failed to store telemetry reading." });
  }
});
