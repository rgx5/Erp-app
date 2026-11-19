/**
 * Which edition of the product this business is on, worked out from the modules it has licensed (not from the plan's name, so a client that was
 * adjusted by hand still gets the right experience). A business with no licence restrictions sees everything ("full").
 *
 *   starter        small shops: products, stock, sales and the counter. Everything else stays out of the way.
 *   growth         adds buying, accounts, GST returns, banking
 *   enterprise     adds approvals and payroll
 *   manufacturing  adds production
 */
export type Edition = 'starter' | 'growth' | 'enterprise' | 'manufacturing' | 'full'

export function editionOf(me: { entitlements?: { restricted: boolean; modules: string[] } | undefined } | null | undefined): Edition {
  const e = me?.entitlements
  if (!e?.restricted) return 'full'
  const m = new Set(e.modules)
  if (m.has('manufacturing')) return 'manufacturing'
  if (m.has('approvals') || m.has('payroll')) return 'enterprise'
  if (m.has('accounting') || m.has('purchasing')) return 'growth'
  return 'starter'
}

/** The small-business experience: the counter is home, advanced screens and accounting wording are hidden. */
export const isStarter = (me: Parameters<typeof editionOf>[0]): boolean => editionOf(me) === 'starter'
