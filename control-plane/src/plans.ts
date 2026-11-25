import { moduleProblem } from './modules.js';

/**
 * The editions we sell. One list, used to pre-fill a licence in the dashboard and to describe what each client type gets. A licence is still
 * just modules + limits (so any client can be adjusted individually); an edition is the starting point.
 *
 * The books (ledger) are always on underneath every edition: "accounting" only licenses the screens and reports, so a small shop gets correct
 * GST, stock and sales postings without ever seeing an accounting screen.
 */
export interface Edition { id: 'starter' | 'growth' | 'enterprise' | 'manufacturing'; plan: string; audience: string; modules: string[]; limits: Record<string, number> }

export const EDITIONS: readonly Edition[] = [
  { id: 'starter', plan: 'Starter', audience: 'Small shops and counters: products, stock and sales, with the billing counter as the home screen',
    modules: ['sales', 'inventory', 'pos'], limits: { users: 3, companies: 1, locations: 1, terminals: 2, sites: 1 } },
  { id: 'growth', plan: 'Growth', audience: 'Growing businesses: adds buying from suppliers, accounts, GST returns, bank reconciliation and expenses',
    modules: ['sales', 'inventory', 'pos', 'purchasing', 'accounting', 'gst', 'banking', 'extras'], limits: { users: 15, companies: 1, locations: 3, terminals: 5, sites: 1 } },
  { id: 'enterprise', plan: 'Enterprise', audience: 'Complete ERP: adds approvals, payroll and lead management, more people, companies and locations',
    modules: ['sales', 'inventory', 'pos', 'purchasing', 'accounting', 'gst', 'banking', 'extras', 'approvals', 'payroll', 'leads'], limits: { users: 100, companies: 10, locations: 25, terminals: 25, sites: 5 } },
  { id: 'manufacturing', plan: 'Manufacturing', audience: 'Manufacturers: everything, plus bills of material, work orders, job work and production costing',
    modules: ['sales', 'inventory', 'pos', 'purchasing', 'accounting', 'gst', 'banking', 'extras', 'approvals', 'payroll', 'leads', 'manufacturing'], limits: { users: 250, companies: 10, locations: 50, terminals: 50, sites: 10 } },
];

/** Every edition must be a valid licence (dependencies satisfied) and each one must include the one below it. */
export function editionProblems(): string[] {
  const out: string[] = [];
  EDITIONS.forEach((e, i) => {
    const p = moduleProblem(e.modules); if (p) out.push(`${e.id}: ${p}`);
    const below = EDITIONS[i - 1]; if (below && !below.modules.every((m) => e.modules.includes(m))) out.push(`${e.id} must include everything in ${below.id}`);
  });
  return out;
}
