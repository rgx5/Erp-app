import type { Variant } from '@/domain/types'

/**
 * The server insists that every variant has a size and a colour (both columns are NOT NULL and an empty string is
 * rejected as "missing"). But a lot of real items have neither — a single product, a service, a 1 kg pack, a Half portion
 * has only one axis. The phone keeps those as empty strings, so at the edge of the app they are swapped for a dash on
 * the way out and back to nothing on the way in. The dash is never shown to anyone on the phone.
 */
export const NO_OPTION = '-'

export const optionToWire = (v: string) => (v === '' ? NO_OPTION : v)
export const optionFromWire = (v: string) => (v === NO_OPTION ? '' : v)

/** A variant (or a partial variant update) as the server wants it. Fields that are not there stay not there. */
export function variantToWire<T extends { size?: string; color?: string }>(p: T): T {
  const out = { ...p }
  if (typeof out.size === 'string') out.size = optionToWire(out.size)
  if (typeof out.color === 'string') out.color = optionToWire(out.color)
  return out
}

export const variantFromWire = (v: Variant): Variant => ({ ...v, size: optionFromWire(v.size), color: optionFromWire(v.color) })
