import { prisma } from "./prisma.js";
import { prismaPg } from "./prisma-pg.js";

type ServiceStatus = "ok" | "down";

async function probe(operation: () => Promise<boolean>): Promise<ServiceStatus> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const ready = await Promise.race([
      operation(),
      new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 2500); }),
    ]);
    return ready ? "ok" : "down";
  } catch {
    return "down";
  } finally {
    clearTimeout(timer);
  }
}

/** Readiness only: no rows, connection strings, or provider diagnostics leave the server. */
export async function readAdminHealth() {
  const [postgres, mongo] = await Promise.all([
    probe(async () => {
      // Explicitly requested readiness SQL, executed through the PostgreSQL client.
      const rows = await prismaPg.$queryRaw<Array<{ ready: number }>>`SELECT 1 AS ready`;
      return rows[0]?.ready === 1;
    }),
    probe(async () => (await prisma.$runCommandRaw({ ping: 1 })).ok === 1),
  ]);
  return { postgres, mongo, api: "ok" as const };
}
