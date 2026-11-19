/** The product's licensable modules and their dependencies. Must match backend/src/modules/identity/entitlements.ts (a test checks it). */
export const MODULES = ['sales', 'purchasing', 'inventory', 'pos', 'accounting', 'gst', 'banking', 'approvals', 'manufacturing', 'payroll', 'extras'] as const;
export const DEPENDS: Readonly<Record<string, readonly string[]>> = { pos: ['sales', 'inventory'], gst: ['sales', 'accounting'], banking: ['accounting'], manufacturing: ['inventory'], payroll: ['accounting'] };
export const LIMIT_KEYS = ['users', 'companies', 'locations', 'terminals', 'sites'] as const;
export function moduleProblem(modules: readonly string[]): string | undefined {
  for (const m of modules) for (const d of DEPENDS[m] ?? []) if (!modules.includes(d)) return `${m} needs ${d}`;
  return undefined;
}
