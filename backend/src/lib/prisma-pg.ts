import { PrismaClient } from "../generated/postgres-client/index.js";
import "./env.js";

// Prevent multiple PostgreSQL Prisma Client instances in development (hot reload)
const globalForPrismaPg = globalThis as unknown as { prismaPg: PrismaClient };

export const prismaPg =
  globalForPrismaPg.prismaPg ??
  new PrismaClient({
    // Auth queries contain credentials and token hashes; never log query data.
    log: [],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrismaPg.prismaPg = prismaPg;
}
