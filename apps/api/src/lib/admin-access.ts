/**
 * The admin access policy: which area each admin path belongs to, and how the
 * required level is derived.
 *
 * This table is the single place access is decided. Two properties matter:
 *
 *  - **Fail closed.** A path that matches no entry is denied, not allowed. A
 *    route added later without a thought about permissions is therefore
 *    unreachable rather than wide open.
 *  - **Level follows the method.** A GET is a read and needs VIEW; anything
 *    else is a mutation and needs MANAGE. That is what makes the `viewOnly`
 *    flag meaningful without a second table: a viewer can look, and every
 *    write is refused.
 *
 * SUPERADMIN bypasses all of this, structurally, in `requireStaff`'s sibling
 * `requireAreaAccess` below — no entry in this table can lock a superadmin out.
 */
import type { RequestHandler } from 'express';
import { ApiError } from './errors.js';
import { canManage, canView, type AdminArea } from './permissions.js';

/**
 * Matched by longest prefix, so `/settings/content` (CONTENT) wins over
 * `/settings` (SETTINGS) regardless of declaration order.
 */
const AREA_PREFIXES: ReadonlyArray<{ prefix: string; area: AdminArea }> = [
  { prefix: '/settings/content', area: 'CONTENT' },
  { prefix: '/settings', area: 'SETTINGS' },
  { prefix: '/integrations', area: 'SETTINGS' },
  { prefix: '/social', area: 'CONTENT' },
  { prefix: '/members', area: 'MEMBERS' },
  { prefix: '/broker-links', area: 'BROKERS' },
  { prefix: '/broker-accounts', area: 'BROKERS' },
  { prefix: '/signals', area: 'SIGNALS' },
  { prefix: '/settlements', area: 'FINANCE' },
  { prefix: '/ranks', area: 'FINANCE' },
  { prefix: '/rank-awards', area: 'FINANCE' },
  { prefix: '/pools', area: 'FINANCE' },
  { prefix: '/payments', area: 'FINANCE' },
  { prefix: '/payouts', area: 'FINANCE' },
  { prefix: '/platform-fees', area: 'FINANCE' },
  { prefix: '/kyc', area: 'KYC' },
  { prefix: '/staff', area: 'STAFF' },
  { prefix: '/permissions', area: 'STAFF' },
  { prefix: '/notifications', area: 'CONTENT' },
  { prefix: '/education', area: 'CONTENT' },
  { prefix: '/events', area: 'CONTENT' },
  { prefix: '/support', area: 'CONTENT' },
  { prefix: '/audit', area: 'AUDIT' },
];

/** Longest-prefix match, or null when the path has no policy. */
export function resolveArea(path: string): AdminArea | null {
  let best: { prefix: string; area: AdminArea } | null = null;
  for (const entry of AREA_PREFIXES) {
    const matches = path === entry.prefix || path.startsWith(`${entry.prefix}/`);
    if (matches && (!best || entry.prefix.length > best.prefix.length)) best = entry;
  }
  return best?.area ?? null;
}

/**
 * Applied at the router level, after `requireStaff`. `req.path` here is
 * relative to the `/api/admin` mount, which is what the table above is keyed on.
 */
export const requireAreaAccess: RequestHandler = (req, _res, next) => {
  const staff = req.staff;
  if (!staff) {
    next(ApiError.forbidden('Staff access required'));
    return;
  }
  // Structural bypass — not a grant, so it cannot be edited away.
  if (staff.role === 'SUPERADMIN') {
    next();
    return;
  }

  const area = resolveArea(req.path);
  if (!area) {
    next(
      ApiError.forbidden(
        'This endpoint has no access policy and is closed by default',
        'AREA_UNMAPPED',
      ),
    );
    return;
  }

  const isRead = req.method === 'GET' || req.method === 'HEAD';
  const allowed = isRead
    ? canView(staff.permissions, staff.viewOnly, area)
    : canManage(staff.permissions, staff.viewOnly, area);

  if (!allowed) {
    next(
      ApiError.forbidden(
        isRead
          ? 'You do not have view access to this area'
          : 'You have view-only access to this area',
        'AREA_FORBIDDEN',
      ),
    );
    return;
  }
  next();
};
