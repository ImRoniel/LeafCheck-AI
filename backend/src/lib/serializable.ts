import type { Prisma, PrismaClient } from "../generated/postgres-client/index.js";
import { HttpError } from "./http.js";

export function prismaErrorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error
    ? error.code : undefined;
}

export function isSerializationConflict(error: unknown): boolean {
  return prismaErrorCode(error) === "P2034";
}

export function isUniqueConflict(error: unknown, model: string, fields: readonly string[]): boolean {
  if (prismaErrorCode(error) !== "P2002" || typeof error !== "object" || error === null || !("meta" in error)) return false;
  const meta = error.meta;
  if (typeof meta !== "object" || meta === null || !("modelName" in meta) || meta.modelName !== model || !("target" in meta)) return false;
  return Array.isArray(meta.target) && meta.target.length === 1 && fields.includes(meta.target[0]);
}

/** Only retry uniqueness races on current pairing assignments, not unrelated writes. */
export function isPairingConflict(error: unknown): boolean {
  return isSerializationConflict(error)
    || isUniqueConflict(error, "Plant", ["deviceId"])
    || isUniqueConflict(error, "DevicePairingHistory", ["deviceId", "plantId"]);
}

/** Callbacks must contain PostgreSQL work only; external effects run after commit. */
export async function serializableTransaction<T>(
  client: Pick<PrismaClient, "$transaction">,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  retryable: (error: unknown) => boolean = isSerializationConflict,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await client.$transaction(operation, { isolationLevel: "Serializable" });
    } catch (error: unknown) {
      if (!retryable(error)) throw error;
      if (attempt === 2) throw new HttpError(409, "PAIRING_CONFLICT", "Pairing changed concurrently. Please try again.");
    }
  }
  throw new HttpError(409, "PAIRING_CONFLICT", "Pairing changed concurrently. Please try again.");
}
