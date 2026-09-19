import { Router, Request, Response } from "express";
import { prismaPg } from "../lib/prisma-pg.js";
import { Plant } from "../types/plant.js";

export const plantsRouter = Router();

/**
 * GET /api/plants
 * Returns all plants. In production, filter by authenticated userId.
 */
plantsRouter.get("/", async (_req: Request, res: Response) => {
  try {
    const plants = await prismaPg.plant.findMany({
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
plantsRouter.get("/:id", async (req: Request, res: Response) => {
  const id = req.params.id as string;
  try {
    const plant = await prismaPg.plant.findUnique({ where: { id } });
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
plantsRouter.patch("/:id/health", async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { healthStatus } = req.body as { healthStatus: Plant["healthStatus"] };

  try {
    const updated = await prismaPg.plant.update({
      where: { id },
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
});
