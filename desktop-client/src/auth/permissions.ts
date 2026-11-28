/** `*` (the owner) allows everything a company can do, but not the `platform:` tier (that needs `platform:*`); otherwise every required permission must be held. */
const has = (granted: readonly string[], p: string): boolean => (p.startsWith('platform:') ? granted.includes('platform:*') : granted.includes('*')) || granted.includes(p)
export const can = (granted: readonly string[], ...required: string[]): boolean => required.every((p) => has(granted, p))
export const canAny = (granted: readonly string[], ...options: string[]): boolean => options.some((p) => has(granted, p))
/** Our own team's Super admin: sees the platform tier (licensing, migration) that a company's owner does not. */
export const isSuperAdmin = (granted: readonly string[]): boolean => granted.includes('platform:*')

/** Is this module part of the signed-in tenant's plan? Core pages (no module) and unrestricted tenants always are. */
export const licensed = (me: { entitlements?: { restricted: boolean; modules: string[] } | undefined } | null | undefined, module: string | undefined): boolean =>
  module === undefined || !me?.entitlements?.restricted || me.entitlements.modules.includes(module)
