/**
 * Every permission the system knows. A role or API key may only hold values from this list (plus the `*` wildcard, which
 * only the built-in owner role has). Later slices append their own; nothing is granted implicitly.
 */
export const PERMISSIONS = [
  'organization:read',
  'organization:write',
  'users:read',
  'users:write',
  'roles:read',
  'roles:write',
  'api_keys:manage',
  'audit:read',
  'numbering:read',
  'numbering:write',
  'masterdata:read',
  'masterdata:write',
  'tax:manage',
  'pricing:manage',
  'accounting:read',
  'accounting:post',
  'accounting:reverse',
  'accounting:manage',
  'accounting:reopen',
  'accounting:close_year',
  'stock:read',
  'stock:post',
  'stock:manage',
  'cheques:read',
  'cheques:post',
  'loans:read',
  'loans:post',
  'tcs:read',
  'tcs:manage',
  'sales:read',
  'sales:post',
  'sales:cancel',
  'sales:manage',
  'receivables:read',
  'receivables:post',
  'receivables:writeoff',
  'pos:read',
  'pos:sell',
  'pos:return',
  'pos:manage',
  'pos:sync',
  'purchasing:read',
  'purchasing:post',
  'purchasing:cancel',
  'purchasing:approve',
  'purchasing:manage',
  'payables:read',
  'payables:post',
  'payables:cancel',
  'payroll:read',
  'payroll:manage',
  'payroll:process',
  'payroll:cancel',
  'gst:read',
  'gst:manage',
  'manufacturing:read',
  'manufacturing:manage',
  'manufacturing:produce',
  'manufacturing:cancel',
  'approvals:read',
  'approvals:decide',
  'approvals:manage',
  'bank:read',
  'bank:manage',
  'bank:reconcile',
  'dashboard:read',
  'expenses:read',
  'expenses:post',
  'expenses:cancel',
  'expenses:manage',
  'retail:read', 'pos:approve',
  'retail:manage',
  'leads:read',
  'leads:read_all',
  'leads:write',
  'leads:manage',
  // Platform tier: held only by our own team's Super admin accounts, never by a client's staff. The `*` of a company's owner does not reach these.
  'platform:licensing',
  'platform:migrate',
  'platform:support',
] as const;

export type Permission = (typeof PERMISSIONS)[number];
export const WILDCARD = '*';
export const isPermission = (value: string): value is Permission => (PERMISSIONS as readonly string[]).includes(value);

export const OWNER_ROLE_NAME = 'Owner';

/** Grants every platform-tier permission. Held by the built-in Super admin role only. */
export const PLATFORM_WILDCARD = 'platform:*';
export const SUPER_ADMIN_ROLE_NAME = 'Super admin';
export const isPlatformPermission = (permission: string): boolean => permission.startsWith('platform:');
/** The owner's `*` covers everything a company can do, but never the platform tier: that needs `platform:*` or the permission itself. */
export const allows = (granted: ReadonlySet<string>, required: readonly string[]): boolean =>
  required.every((permission) => (isPlatformPermission(permission) ? granted.has(PLATFORM_WILDCARD) || granted.has(permission) : granted.has(WILDCARD) || granted.has(permission)));
/** Does this holder belong to our own team (can they see and manage platform-tier things)? */
export const isPlatformHolder = (granted: ReadonlySet<string>): boolean => granted.has(PLATFORM_WILDCARD);
