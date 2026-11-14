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
  'purchasing:read',
  'purchasing:post',
  'purchasing:cancel',
  'purchasing:approve',
  'purchasing:manage',
  'payables:read',
  'payables:post',
  'payables:cancel',
  'manufacturing:read',
  'manufacturing:manage',
  'manufacturing:produce',
  'manufacturing:cancel',
] as const;

export type Permission = (typeof PERMISSIONS)[number];
export const WILDCARD = '*';
export const isPermission = (value: string): value is Permission => (PERMISSIONS as readonly string[]).includes(value);

export const OWNER_ROLE_NAME = 'Owner';

export const allows = (granted: ReadonlySet<string>, required: readonly string[]): boolean =>
  granted.has(WILDCARD) || required.every((permission) => granted.has(permission));
