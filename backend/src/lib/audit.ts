import type { Prisma } from "../generated/postgres-client/index.js";
import { prismaPg } from "./prisma-pg.js";

export interface AuditContext {
  actorId: string;
  ipAddress?: string | null;
}

/** Callers provide allowlisted metadata, never request bodies or credentials. */
export async function writeAudit(
  actor: AuditContext,
  action: string,
  targetId?: string,
  metadata: Prisma.InputJsonObject = {},
  client: Pick<Prisma.TransactionClient, "auditLog"> = prismaPg,
) {
  return client.auditLog.create({ data: {
    actorId: actor.actorId, action, targetId,
    metadata: { ...metadata, actorId: actor.actorId },
    ipAddress: actor.ipAddress?.slice(0, 64) ?? null,
  } });
}
