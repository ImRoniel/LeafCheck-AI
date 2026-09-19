import "dotenv/config";
import { PrismaClient } from "../generated/postgres-client/index.js";

// Prevent multiple PostgreSQL Prisma Client instances in development (hot reload)
const globalForPrismaPg = globalThis as unknown as { prismaPg: PrismaClient };

export const prismaPg =
  globalForPrismaPg.prismaPg ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "warn", "error"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrismaPg.prismaPg = prismaPg;
}
