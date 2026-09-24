import { Request, Response, Router } from "express";
import { requireAuth } from "../lib/auth.js";
import { demoDeviceId, seedDemoTelemetry } from "../lib/demo-telemetry.js";
import { asyncRoute, bodyObject, HttpError } from "../lib/http.js";
import { ownedPlant } from "../lib/ownership.js";
import { prismaPg } from "../lib/prisma-pg.js";
import { Plant } from "../types/plant.js";

export const plantsRouter = Router();
plantsRouter.use(requireAuth);

function plantFields(value: unknown, partial = false) {
  const body = bodyObject(value, [
    "name",
    "species",
    "location",
    "imageUrl",
    "minMoisture",
    "maxMoisture",
  ]);
  if (partial && !Object.keys(body).length)
    throw new HttpError(
      400,
      "INVALID_INPUT",
      "Provide at least one plant field.",
    );
  const text = (key: string, max: number, required = false) => {
    const value = body[key];
    if (value === undefined && (partial || !required)) return undefined;
    if (
      typeof value !== "string" ||
      value.trim().length > max ||
      (required && !value.trim())
    )
      throw new HttpError(
        400,
        "INVALID_INPUT",
        `${key} must be ${required ? "a non-empty" : "a"} string of at most ${max} characters.`,
      );
    return value.trim();
  };
  const moisture = (key: string) => {
    const value = body[key];
    if (value === undefined) return undefined;
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > 100
    )
      throw new HttpError(
        400,
        "INVALID_INPUT",
        `${key} must be a number between 0 and 100.`,
      );
    return value;
  };
  const imageUrl = text("imageUrl", 2048);
  if (imageUrl) {
    let url: URL;
    try {
      url = new URL(imageUrl);
    } catch {
      throw new HttpError(
        400,
        "INVALID_INPUT",
        "imageUrl must be an HTTP or HTTPS URL.",
      );
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new HttpError(
        400,
        "INVALID_INPUT",
        "imageUrl must be an HTTP or HTTPS URL without credentials.",
      );
  }
  return {
    name: text("name", 100, true),
    species: text("species", 200, true),
    location: text("location", 100),
    imageUrl,
    minMoisture: moisture("minMoisture"),
    maxMoisture: moisture("maxMoisture"),
  };
}

function serializePlant(plant: Awaited<ReturnType<typeof ownedPlant>>): Plant {
  return {
    id: plant.id,
    deviceId: plant.deviceId ?? undefined,
    simulated: plant.deviceId === demoDeviceId(plant.id),
    name: plant.name,
    species: plant.species,
    location: plant.location ?? undefined,
    imageUrl: plant.imageUrl ?? undefined,
    minMoisture: plant.minMoisture,
    maxMoisture: plant.maxMoisture,
    healthStatus: plant.healthStatus as Plant["healthStatus"],
    lastScannedAt: plant.lastScannedAt?.toISOString(),
    createdAt: plant.createdAt.toISOString(),
    updatedAt: plant.updatedAt.toISOString(),
  };
}

// Only user-editable fields are accepted; ownership always comes from the session.
plantsRouter.post(
  "/",
  asyncRoute(async (req, res) => {
    const fields = plantFields(req.body);
    const plant = await prismaPg.plant.create({
      data: {
        ...fields,
        name: fields.name!,
        species: fields.species!,
        location: fields.location || undefined,
        imageUrl: fields.imageUrl || undefined,
        userId: res.locals.auth.user.id,
        healthStatus: "unknown",
      },
    });
    res.status(201).json(serializePlant(plant));
  }),
);

plantsRouter.use(
  "/:id",
  asyncRoute(async (req, res, next) => {
    res.locals.plant = await ownedPlant(req.params.id, res.locals.auth.user.id);
    next();
  }),
);

plantsRouter.delete(
  "/:id",
  asyncRoute(async (req, res) => {
    // Keep the write owner-scoped too, including if the record changes after lookup.
    const result = await prismaPg.plant.deleteMany({
      where: { id: req.params.id as string, userId: res.locals.auth.user.id },
    });
    if (!result.count)
      throw new HttpError(404, "NOT_FOUND", "Plant not found.");
    res.status(204).end();
  }),
);

plantsRouter.post(
  "/:id/seed-telemetry",
  asyncRoute(async (req, res) => {
    const plant = await seedDemoTelemetry(
      req.params.id as string,
      res.locals.auth.user.id,
    );
    res.json(serializePlant(plant));
  }),
);

plantsRouter.patch(
  "/:id",
  asyncRoute(async (req, res) => {
    const data = plantFields(req.body, true);
    try {
      const plant = await prismaPg.plant.update({
        where: { id: req.params.id as string, userId: res.locals.auth.user.id },
        data,
      });
      res.json(serializePlant(plant));
    } catch (error) {
      if ((error as { code?: string })?.code === "P2025")
        throw new HttpError(404, "NOT_FOUND", "Plant not found.");
      throw error;
    }
  }),
);

/**
 * GET /api/plants
 * Returns only the authenticated user's plants.
 */
plantsRouter.get("/", async (_req: Request, res: Response) => {
  try {
    const plants = await prismaPg.plant.findMany({
      where: { userId: res.locals.auth.user.id },
      orderBy: { updatedAt: "desc" },
    });

    // Map Prisma Plant → frontend Plant interface
    const response: Plant[] = plants.map((p) => ({
      id: p.id,
      deviceId: p.deviceId ?? undefined,
      simulated: p.deviceId === demoDeviceId(p.id),
      name: p.name,
      species: p.species,
      location: p.location ?? undefined,
      minMoisture: p.minMoisture,
      maxMoisture: p.maxMoisture,
      healthStatus: (p.healthStatus as Plant["healthStatus"]) ?? "healthy",
      lastScannedAt: p.lastScannedAt?.toISOString() ?? undefined,
      imageUrl: p.imageUrl ?? undefined,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    }));

    res.json(response);
  } catch (error) {
    console.error("[Plants] GET / error:", error);
    res.status(500).json({ error: "Failed to fetch plants." });
  }
});

/**
 * GET /api/plants/:id
 * Returns a single plant by ID.
 */
plantsRouter.get("/:id", async (_req: Request, res: Response) => {
  try {
    const plant = res.locals.plant;
    if (!plant) {
      res.status(404).json({ error: "Plant not found." });
      return;
    }
    res.json({
      id: plant.id,
      deviceId: plant.deviceId ?? undefined,
      simulated: plant.deviceId === demoDeviceId(plant.id),
      name: plant.name,
      species: plant.species,
      location: plant.location ?? undefined,
      minMoisture: plant.minMoisture,
      maxMoisture: plant.maxMoisture,
      healthStatus: plant.healthStatus as Plant["healthStatus"],
      lastScannedAt: plant.lastScannedAt?.toISOString() ?? undefined,
      imageUrl: plant.imageUrl ?? undefined,
      createdAt: plant.createdAt.toISOString(),
      updatedAt: plant.updatedAt.toISOString(),
    } satisfies Plant);
  } catch (error) {
    console.error("[Plants] GET /:id error:", error);
    res.status(500).json({ error: "Failed to fetch plant." });
  }
});

/**
 * PATCH /api/plants/:id/health
 * Updates the healthStatus of a plant (called after AI diagnosis completes).
 */
plantsRouter.patch(
  "/:id/health",
  asyncRoute(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const { healthStatus } = bodyObject(req.body, ["healthStatus"]);
    if (
      typeof healthStatus !== "string" ||
      !["healthy", "warning", "critical", "unknown"].includes(healthStatus)
    ) {
      throw new HttpError(400, "INVALID_INPUT", "Invalid health status.");
    }

    try {
      const updated = await prismaPg.plant.update({
        where: { id, userId: res.locals.auth.user.id },
        data: {
          healthStatus,
          lastScannedAt: new Date(),
        },
      });
      res.json({ id: updated.id, healthStatus: updated.healthStatus });
    } catch (error) {
      if ((error as { code?: string })?.code === "P2025")
        throw new HttpError(404, "NOT_FOUND", "Plant not found.");
      throw error;
    }
  }),
);
