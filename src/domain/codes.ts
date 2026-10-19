import type { Category, Product, User } from './types'

/**
 * A scannable SKU: item code, then the first three letters of the second option and the first option when they exist.
 * Upper case and without spaces, so it can be typed or scanned reliably (barcode lookup upper-cases what it receives).
 */
export function skuFor(styleCode: string, color: string, size: string): string {
  const clean = (s: string) => s.replace(/\s+/g, '').toUpperCase()
  return [clean(styleCode), clean(color).slice(0, 3), clean(size)].filter(Boolean).join('-')
}

/**
 * How a variant is described to a person: "M / Navy", or just "Kanjivaram" for an item that has no second option,
 * or nothing at all for a plain single item. Never leaves a dangling " / ".
 */
export function variantLabel(size: string | undefined, color: string | undefined): string {
  return [size, color].map((s) => (s ?? '').trim()).filter(Boolean).join(' / ')
}

/** Two-letter prefixes: a category's own, else made from its group and name (Men + Shirts → MS). */
export function stylePrefix(c: Category | undefined): string {
  if (!c) return 'IT'
  return c.config?.prefix?.trim().toUpperCase() || `${(c.group[0] ?? 'X')}${(c.name[0] ?? 'X')}`.toUpperCase()
}

/** The next free item code for a category: WS-101, WS-102 … (never reuses a number already taken). */
export function nextStyleCode(c: Category | undefined, products: Array<Pick<Product, 'styleCode'>>): string {
  const prefix = stylePrefix(c)
  const used = new Set(products.map((p) => p.styleCode.toUpperCase()))
  let max = 100
  for (const code of used) {
    const m = new RegExp(`^${prefix}-(\\d+)$`).exec(code)
    if (m) max = Math.max(max, Number(m[1]))
  }
  let n = max + 1
  while (used.has(`${prefix}-${n}`)) n++
  return `${prefix}-${n}`
}

/** "1" → "01". Codes are 1–3 digits; two-digit padding keeps them lining up on buttons and reports. */
export const normalizeStaffCode = (raw: string): string => {
  const d = raw.replace(/\D/g, '').slice(0, 3)
  return d.length === 1 ? '0' + d : d
}
export const isValidStaffCode = (code: string) => /^\d{2,3}$/.test(code)

/** The smallest free staff code (01, 02, …), ignoring `exceptId`'s own code. */
export function nextStaffCode(users: Pick<User, 'id' | 'code'>[], exceptId?: string): string {
  const taken = new Set(users.filter((u) => u.id !== exceptId && u.code).map((u) => u.code))
  for (let n = 1; n < 1000; n++) {
    const c = String(n).padStart(2, '0')
    if (!taken.has(c)) return c
  }
  return ''
}

const GROUP_RANK = (groups: string[]) => (g: string) => { const i = groups.indexOf(g); return i === -1 ? groups.length : i }

/** Categories in the order their industry pack lists the groups, alphabetical inside each group. */
export function sortCategories<T extends Pick<Category, 'name' | 'group'>>(cats: T[], groupOrder: string[] = []): T[] {
  const rank = GROUP_RANK(groupOrder)
  return [...cats].sort((a, b) => rank(a.group) - rank(b.group) || a.name.localeCompare(b.name))
}
