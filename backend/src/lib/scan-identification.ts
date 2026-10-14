import type { PrismaClient } from "../generated/postgres-client/index.js";

/** Recover confidence without trusting the old saved-image path's synthetic zero. */
export async function latestReusableIdentification(
  client: Pick<PrismaClient, "plantIdentification">,
  plantId: string,
  userId: string,
) {
  let cursor: string | undefined;
  for (;;) {
    const rows = await client.plantIdentification.findMany({
      where: { plantId, plant: { userId } },
      select: { id: true, confidence: true, rawResponse: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    for (const row of rows) {
      const raw = row.rawResponse;
      const synthetic = row.confidence === 0 && raw !== null && typeof raw === "object"
        && !Array.isArray(raw) && raw.source === "saved-plant";
      if (!synthetic && Number.isFinite(row.confidence) && row.confidence >= 0 && row.confidence <= 1) return row;
    }
    if (rows.length < 50) return null;
    cursor = rows[rows.length - 1].id;
  }
}
