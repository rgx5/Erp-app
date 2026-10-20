import type { Role } from './types'

/** Cashiers run the counter; managers run the floor; the owner sees the money. Mirrors the server's matrix exactly —
 *  the API enforces it independently of the app. */
export type CorePermission =
  | 'pos' | 'inventory' | 'purchases' | 'stock' | 'customers'
  | 'expenses' | 'reports' | 'settings' | 'viewProfit' | 'deleteBill' | 'bigDiscount'
/** The core permissions are typed; a module may add its own (`'accounting'`, `'hr'`…) with `registerPermission`. */
export type Permission = CorePermission | (string & {})

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: ['pos', 'inventory', 'purchases', 'stock', 'customers', 'expenses', 'reports', 'settings', 'viewProfit', 'deleteBill', 'bigDiscount'],
  manager: ['pos', 'inventory', 'purchases', 'stock', 'customers', 'expenses', 'reports', 'bigDiscount'],
  cashier: ['pos', 'customers'],
}

export const can = (role: Role | undefined, perm: Permission) => (role ? ROLE_PERMISSIONS[role].includes(perm) : false)

/** Adds a permission and says which of the built-in roles have it by default (the owner always does). Idempotent. */
export function registerPermission(perm: Permission, defaultRoles: Role[] = []) {
  for (const role of new Set<Role>(['owner', ...defaultRoles])) if (!ROLE_PERMISSIONS[role].includes(perm)) ROLE_PERMISSIONS[role].push(perm)
}

export const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', manager: 'Manager', cashier: 'Cashier' }
export const ROLE_HELP: Record<Role, string> = {
  owner: 'Everything, including profit, settings and staff.',
  manager: 'Billing, stock, purchases, expenses and reports.',
  cashier: 'The billing counter and customers only.',
}
