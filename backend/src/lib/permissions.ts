import type { Role } from "../generated/postgres-client/index.js";
import { asyncRoute, HttpError } from "./http.js";

export type Permission = "users.read" | "users.manage" | "devices.read" | "devices.manage" | "audit.read";

export const permissions: Readonly<Record<Role, readonly Permission[]>> = {
  ADMIN: ["users.read", "users.manage", "devices.read", "devices.manage", "audit.read"],
  LEAD_DEV: ["devices.read"],
  USER: [],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return permissions[role]?.includes(permission) ?? false;
}

/** Must follow authentication; the role comes from the current application row. */
export function requirePermission(permission: Permission) {
  return asyncRoute((_req, res, next) => {
    const role: Role | undefined = res.locals.auth?.user?.role;
    if (!role || !hasPermission(role, permission))
      throw new HttpError(403, "FORBIDDEN", "You do not have permission to perform this action.");
    next();
  });
}

/** Personal mobile device writes remain available to USER, never to LEAD_DEV. */
export const requireDeviceWrite = asyncRoute((_req, res, next) => {
  const role: Role | undefined = res.locals.auth?.user?.role;
  if (!role || role === "LEAD_DEV")
    throw new HttpError(403, "FORBIDDEN", "Device changes are not permitted for this role.");
  next();
});
