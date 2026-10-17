import type { AdminRole } from './auth'

export type Permission = 'users.read' | 'users.manage' | 'devices.read' | 'devices.manage' | 'devices.provision' | 'sessions.revoke' | 'settings.read' | 'settings.manage' | 'integrations.read' | 'audit.read'

const permissions: Record<AdminRole, readonly Permission[]> = {
  ADMIN: ['users.read', 'users.manage', 'devices.read', 'devices.manage', 'devices.provision', 'sessions.revoke', 'settings.read', 'settings.manage', 'integrations.read', 'audit.read'],
  LEAD_DEV: ['devices.read', 'devices.manage'],
}

export function hasPermission(role: AdminRole, permission: Permission): boolean {
  return permissions[role].includes(permission)
}
