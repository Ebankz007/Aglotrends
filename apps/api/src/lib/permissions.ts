/**
 * Admin access control — the areas a staff member can be granted, and the
 * levels they can hold in each.
 *
 * The model is deliberately two-dimensional:
 *
 *   area  ×  level          →  what a staff member may do
 *   viewOnly (a single flag) →  a cap that forces every area down to VIEW
 *
 * The flag exists because "make this person read-only" is the common request and
 * should not mean editing nine rows. It is a *cap*, never a grant: it can only
 * take access away, so it can never be used to escalate.
 *
 * SUPERADMIN is not expressed here. It bypasses this module entirely — see
 * `requireStaff` in lib/auth.ts. That is structural, so no permission map can
 * lock a superadmin out of their own console.
 *
 * Framework-free on purpose: the API middleware and the tests both consume it.
 */

export const ADMIN_AREAS = [
  { id: 'MEMBERS', label: 'Members', description: 'Member directory, profiles and account status' },
  { id: 'BROKERS', label: 'Brokers', description: 'Broker links and connected broker accounts' },
  { id: 'SIGNALS', label: 'Signals', description: 'Signal drafts, publishing and delivery' },
  { id: 'FINANCE', label: 'Finance', description: 'Payments, payouts, settlements, pools and fees' },
  { id: 'KYC', label: 'KYC', description: 'Identity verification review queue' },
  {
    id: 'CONTENT',
    label: 'Content',
    description: 'Education, events, support, site content and broadcasts',
  },
  { id: 'SETTINGS', label: 'Settings', description: 'Platform switches, gateway and fee configuration' },
  { id: 'STAFF', label: 'Staff', description: 'Staff accounts, roles and permissions' },
  { id: 'AUDIT', label: 'Audit', description: 'Administrative audit trail' },
] as const;

export type AdminArea = (typeof ADMIN_AREAS)[number]['id'];

export const ADMIN_AREA_IDS: readonly AdminArea[] = ADMIN_AREAS.map((area) => area.id);

export const PERMISSION_LEVELS = ['NONE', 'VIEW', 'MANAGE'] as const;
export type PermissionLevel = (typeof PERMISSION_LEVELS)[number];

/** Areas absent from the map are NONE. */
export type PermissionMap = Partial<Record<AdminArea, PermissionLevel>>;

const RANK: Record<PermissionLevel, number> = { NONE: 0, VIEW: 1, MANAGE: 2 };

export function isAdminArea(value: string): value is AdminArea {
  return (ADMIN_AREA_IDS as readonly string[]).includes(value);
}

export function isPermissionLevel(value: unknown): value is PermissionLevel {
  return typeof value === 'string' && (PERMISSION_LEVELS as readonly string[]).includes(value);
}

/** The stored level for an area, defaulting to NONE. */
export function levelFor(permissions: PermissionMap, area: AdminArea): PermissionLevel {
  return permissions[area] ?? 'NONE';
}

/**
 * The level actually in force once `viewOnly` is applied. This is the only
 * function the middleware should consult — going straight to the map would
 * silently ignore the read-only cap.
 */
export function effectiveLevel(
  permissions: PermissionMap,
  viewOnly: boolean,
  area: AdminArea,
): PermissionLevel {
  const level = permissions[area] ?? 'NONE';
  if (viewOnly && level === 'MANAGE') return 'VIEW';
  return level;
}

export function canView(
  permissions: PermissionMap,
  viewOnly: boolean,
  area: AdminArea,
): boolean {
  return effectiveLevel(permissions, viewOnly, area) !== 'NONE';
}

export function canManage(
  permissions: PermissionMap,
  viewOnly: boolean,
  area: AdminArea,
): boolean {
  return effectiveLevel(permissions, viewOnly, area) === 'MANAGE';
}

/** Every area at MANAGE — what a SUPERADMIN effectively holds, for display. */
export function fullAccessMap(): Record<AdminArea, PermissionLevel> {
  return Object.fromEntries(ADMIN_AREA_IDS.map((area) => [area, 'MANAGE'])) as Record<
    AdminArea,
    PermissionLevel
  >;
}

/**
 * Coerces untrusted input into a valid map: unknown areas and unknown levels are
 * dropped rather than rejected, and NONE entries are omitted so the stored value
 * stays small and readable. Dropping is the safe direction — a malformed grant
 * can only ever lose access, never invent it.
 */
export function normalizePermissionMap(input: unknown): Partial<Record<AdminArea, PermissionLevel>> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const source = input as Record<string, unknown>;
  const result: Partial<Record<AdminArea, PermissionLevel>> = {};
  for (const area of ADMIN_AREA_IDS) {
    const value = source[area];
    if (value === 'VIEW' || value === 'MANAGE') result[area] = value;
  }
  return result;
}

/** A compact human summary, e.g. "Members (manage), KYC (view)" — for the audit log. */
export function describePermissions(map: Partial<Record<AdminArea, PermissionLevel>>): string {
  const parts = ADMIN_AREAS.filter((area) => map[area.id]).map(
    (area) => `${area.label} (${map[area.id]!.toLowerCase()})`,
  );
  return parts.length > 0 ? parts.join(', ') : 'no access';
}
