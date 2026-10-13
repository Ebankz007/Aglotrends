import { schema } from '../db.js';
import { normalizePermissionMap } from './permissions.js';

type UserRow = typeof schema.users.$inferSelect;

/**
 * The user shape sent to clients. One definition, used by login, the 2FA
 * challenge, and /auth/me, so the console never sees three slightly different
 * versions of "who am I".
 *
 * Permission fields are surfaced for everyone but only populated for staff —
 * a member's map is always empty, and the console hides itself on `role`.
 */
export function publicUser(u: UserRow) {
  const isStaff = u.role === 'ADMIN' || u.role === 'SUPERADMIN';
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    role: u.role,
    status: u.status,
    sponsorId: u.sponsorId,
    isActiveMember: u.isActiveMember,
    highestAssociateRank: u.highestAssociateRank,
    highestLeadershipRank: u.highestLeadershipRank,
    twoFactorEnabled: u.twoFactorEnabled,
    permissions: isStaff ? normalizePermissionMap(u.permissions) : {},
    viewOnly: isStaff ? u.viewOnly : false,
  };
}
