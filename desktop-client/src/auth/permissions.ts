/** `*` (the owner) allows everything; otherwise every required permission must be held. */
export const can = (granted: readonly string[], ...required: string[]): boolean => granted.includes('*') || required.every((p) => granted.includes(p))
export const canAny = (granted: readonly string[], ...options: string[]): boolean => granted.includes('*') || options.some((p) => granted.includes(p))
