/** `*` (the owner) allows everything; otherwise every required permission must be held. */
export const can = (granted: readonly string[], ...required: string[]): boolean => granted.includes('*') || required.every((p) => granted.includes(p))
export const canAny = (granted: readonly string[], ...options: string[]): boolean => granted.includes('*') || options.some((p) => granted.includes(p))

/** Is this module part of the signed-in tenant's plan? Core pages (no module) and unrestricted tenants always are. */
export const licensed = (me: { entitlements?: { restricted: boolean; modules: string[] } | undefined } | null | undefined, module: string | undefined): boolean =>
  module === undefined || !me?.entitlements?.restricted || me.entitlements.modules.includes(module)
