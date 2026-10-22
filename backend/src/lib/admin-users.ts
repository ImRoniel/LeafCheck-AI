import { randomBytes } from "node:crypto";
import type { Prisma, Role } from "../generated/postgres-client/index.js";
import { assertAdminVerification, invalidateAdminCredentials, securityTransaction } from "./admin-verification.js";
import { writeAudit, type AuditContext } from "./audit.js";
import { authProvider } from "./auth-provider.js";
import { HttpError } from "./http.js";
import { hashPassword } from "./password.js";
import { prismaPg } from "./prisma-pg.js";
import { ProviderError, supabaseAdmin } from "./supabase-client.js";

export interface AdminActor extends AuditContext { sessionId: string }
export interface CreateAdminUser {
  email: string; password: string; name: string | null; role: Role; isActive: boolean;
}
export interface UpdateAdminUser { name?: string | null; role?: Role; isActive?: boolean }
const publicSelect = { id: true, email: true, name: true, role: true, isActive: true, createdAt: true, updatedAt: true } as const;

async function authorize(tx: Prisma.TransactionClient, actor: AdminActor) {
  const user = await tx.user.findUnique({ where: { id: actor.actorId } });
  if (!user?.isActive || user.role !== "ADMIN") throw new HttpError(403, "FORBIDDEN", "SuperAdmin access required.");
  await assertAdminVerification(user, actor.sessionId, tx);
}

async function protectLastAdmin(tx: Prisma.TransactionClient, user: { role: Role; isActive: boolean }, change: UpdateAdminUser) {
  if (user.role === "ADMIN" && user.isActive && (change.isActive === false || (change.role !== undefined && change.role !== "ADMIN")) &&
      await tx.user.count({ where: { role: "ADMIN", isActive: true } }) <= 1)
    throw new HttpError(409, "LAST_ADMIN", "The last active SuperAdmin cannot be removed or demoted.");
}

export async function createAdminUser(data: CreateAdminUser, actor: AdminActor) {
  if (await prismaPg.user.findUnique({ where: { email: data.email }, select: { id: true } }))
    throw new HttpError(409, "EMAIL_CONFLICT", "An account with this email already exists.", { email: "An account with this email already exists." });
  // Provider accounts never receive a usable fallback legacy password.
  const password = await hashPassword(authProvider() === "supabase" ? randomBytes(48).toString("base64url") : data.password);
  const provider = authProvider() === "supabase" ? await supabaseAdmin.createUser(data.email, data.password, data.name) : null;
  try {
    if (provider && (provider.email !== data.email || !provider.emailConfirmedAt))
      throw new HttpError(502, "INVALID_PROVIDER_RESPONSE", "Invalid account provisioning response.");
    return await securityTransaction(async tx => {
      await authorize(tx, actor);
      const user = await tx.user.create({ data: {
        email: data.email, name: data.name, password, role: data.role, isActive: data.isActive,
        ...(provider ? { supabaseUserId: provider.id, emailVerifiedAt: provider.emailConfirmedAt } : {}),
      }, select: publicSelect });
      await writeAudit(actor, "USER_CREATED", user.id, { role: user.role, isActive: user.isActive }, tx);
      return user;
    });
  } catch (error) {
    if (provider) {
      try { await supabaseAdmin.deleteUser(provider.id); }
      catch { throw new HttpError(503, "PROVISIONING_CLEANUP_REQUIRED", "Account creation failed and provider cleanup could not be confirmed."); }
    }
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002")
      throw new HttpError(409, "EMAIL_CONFLICT", "An account with this email already exists.", { email: "An account with this email already exists." });
    throw error;
  }
}

export async function updateAdminUser(id: string, change: UpdateAdminUser, actor: AdminActor, expectedUpdatedAt: Date) {
  return securityTransaction(async tx => {
    await authorize(tx, actor);
    const before = await tx.user.findUnique({ where: { id } });
    if (!before) throw new HttpError(404, "NOT_FOUND", "User not found.");
    if (before.updatedAt.getTime() !== expectedUpdatedAt.getTime())
      throw new HttpError(409, "CONFLICT", "This user was modified by another administrator. Please refresh.");
    if (id === actor.actorId && change.isActive === false)
      throw new HttpError(409, "SELF_BAN_FORBIDDEN", "You cannot ban your own account.");
    await protectLastAdmin(tx, before, change);
    const securityChanged = (change.role !== undefined && change.role !== before.role) ||
      (change.isActive !== undefined && change.isActive !== before.isActive);
    const user = await tx.user.update({ where: { id }, data: {
      ...change,
      // Advance even when two successful updates happen within one millisecond.
      updatedAt: new Date(Math.max(Date.now(), before.updatedAt.getTime() + 1)),
      ...(securityChanged ? { authVersion: { increment: 1 }, authInvalidBefore: new Date() } : {}),
    }, select: publicSelect });
    if (securityChanged) await invalidateAdminCredentials(tx, id);
    await writeAudit(actor, "USER_UPDATED", id, {
      changedFields: Object.keys(change),
      before: { name: before.name, role: before.role, isActive: before.isActive },
      after: { name: user.name, role: user.role, isActive: user.isActive },
    }, tx);
    return user;
  });
}

export async function deleteAdminUser(id: string, actor: AdminActor) {
  if (id === actor.actorId) throw new HttpError(409, "SELF_DELETE_FORBIDDEN", "You cannot delete your own account.");
  const target = await securityTransaction(async tx => {
    await authorize(tx, actor);
    const user = await tx.user.findUnique({ where: { id } });
    if (!user) throw new HttpError(404, "NOT_FOUND", "User not found.");
    await protectLastAdmin(tx, user, { isActive: false });
    // Commit denial before the irreversible provider operation. A failure leaves
    // a disabled account that can be retried, rather than an active orphan.
    await tx.user.update({ where: { id }, data: { isActive: false, authVersion: { increment: 1 }, authInvalidBefore: new Date() } });
    await invalidateAdminCredentials(tx, id);
    await writeAudit(actor, "USER_DELETE_REQUESTED", id, { role: user.role }, tx);
    return { providerId: user.supabaseUserId };
  });
  if (target.providerId) {
    try { await supabaseAdmin.deleteUser(target.providerId); }
    catch (error) {
      if (!(error instanceof ProviderError && error.providerStatus === 404))
        throw new HttpError(503, "USER_DELETE_PENDING", "The account is disabled; provider deletion could not be confirmed. Retry deletion.");
    }
  }
  await securityTransaction(async tx => {
    await authorize(tx, actor);
    // Concurrent retries are idempotent and preserve the original audit trail.
    // Devices survive account deletion so other plants' transfer history keeps its source.
    await tx.deviceProvision.updateMany({ where: { claimedDevice: { userId: id } }, data: { claimedDeviceId: null } });
    const deleted = await tx.user.deleteMany({ where: { id, isActive: false } });
    if (!deleted.count && await tx.user.findUnique({ where: { id }, select: { id: true } }))
      throw new HttpError(409, "ADMIN_CONFLICT", "The account changed during deletion. Review its status and retry.");
    if (deleted.count) await writeAudit(actor, "USER_DELETED", id, {}, tx);
  });
}
