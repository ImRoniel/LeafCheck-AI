import { Request, Response, Router } from "express";
import { requireAuth } from "../lib/auth.js";
import { asyncRoute, bodyObject, HttpError } from "../lib/http.js";
import { ownedPlant } from "../lib/ownership.js";
import { prismaPg } from "../lib/prisma-pg.js";
import { Plant } from "../types/plant.js";

export const plantsRouter = Router();
plantsRouter.use(requireAuth);

// Only user-editable fields are accepted; ownership always comes from the session.
plantsRouter.post(
  "/",
  asyncRoute(async (req, res) => {
    const body = bodyObject(req.body, [
      "name",
      "species",
      "location",
      "imageUrl",
    ]);
    const text = (key: string, max: number, required = false) => {
      const value = body[key];
      if (value === undefined && !required) return undefined;
      if (
        typeof value !== "string" ||
        value.trim().length > max ||
        (required && !value.trim())
      ) {
        throw new HttpError(
          400,
          "INVALID_INPUT",
          `${key} must be ${required ? "a non-empty" : "a"} string of at most ${max} characters.`,
        );
      }
      return value.trim() || undefined;
    };
    const name = text("name", 100, true)!;
    const species = text("species", 200, true)!;
    const location = text("location", 100);
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
      ) {
        throw new HttpError(
          400,
          "INVALID_INPUT",
          "imageUrl must be an HTTP or HTTPS URL without credentials.",
        );
      }
    }
    const plant = await prismaPg.plant.create({
      data: {
        name,
        species,
        location,
        imageUrl,
        userId: res.locals.auth.user.id,
        healthStatus: "unknown",
      },
    });
    res.status(201).json({
      id: plant.id,
      name: plant.name,
      species: plant.species,
      location: plant.location ?? undefined,
      imageUrl: plant.imageUrl ?? undefined,
      healthStatus: plant.healthStatus as Plant["healthStatus"],
      lastScannedAt: plant.lastScannedAt?.toISOString() ?? undefined,
      createdAt: plant.createdAt.toISOString(),
      updatedAt: plant.updatedAt.toISOString(),
    } satisfies Plant);
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
      name: p.name,
      species: p.species,
      location: p.location ?? undefined,
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
      name: plant.name,
      species: plant.species,
      location: plant.location ?? undefined,
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
      console.error("[Plants] PATCH /:id/health error:", error);
      res.status(500).json({ error: "Failed to update plant health." });
    }
  }),
);
