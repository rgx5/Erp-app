import { and, desc, eq, lte, sql } from 'drizzle-orm';
import type { Tx } from '../../platform/database/database.js';
import { toUnits } from '../accounting/money.js';
import type { Rules, Slab } from './payroll-calc.js';
import { payrollRates, payrollSlabs } from './payroll.schema.js';

const pctUnits = (text: string): bigint => { const [i = '0', f = ''] = text.split('.'); return BigInt(i) * 10_000n + BigInt(f.padEnd(4, '0').slice(0, 4)); };

/** The rule set in force on a date: for each rate the latest row on or before it; for each slab kind the set with the latest effective date. */
export async function resolveRules(tx: Tx, tenantId: string, companyId: string, date: string, regime: 'new' | 'old', stateCode: string): Promise<{ rules: Rules; missing: string[] }> {
  const rows = await tx.select().from(payrollRates).where(and(eq(payrollRates.tenantId, tenantId), eq(payrollRates.companyId, companyId), lte(payrollRates.effectiveFrom, date))).orderBy(desc(payrollRates.effectiveFrom));
  const missing: string[] = [];
  const rate = (code: string): bigint => {
    const r = rows.find((x) => x.code === code);
    if (!r) { missing.push(code); return 0n; }
    return pctUnits(r.value.replace(/0+$/, '').replace(/\.$/, '') || '0');
  };
  const slabsOf = async (kind: string, state?: string): Promise<Slab[]> => {
    const [latest] = await tx.select({ d: sql<string>`MAX(${payrollSlabs.effectiveFrom})::text` }).from(payrollSlabs).where(and(eq(payrollSlabs.tenantId, tenantId), eq(payrollSlabs.companyId, companyId), eq(payrollSlabs.kind, kind), lte(payrollSlabs.effectiveFrom, date), state ? eq(payrollSlabs.stateCode, state) : sql`${payrollSlabs.stateCode} IS NULL`));
    if (!latest?.d) { missing.push(state ? `${kind}:${state}` : kind); return []; }
    const set = await tx.select().from(payrollSlabs).where(and(eq(payrollSlabs.tenantId, tenantId), eq(payrollSlabs.companyId, companyId), eq(payrollSlabs.kind, kind), eq(payrollSlabs.effectiveFrom, latest.d), state ? eq(payrollSlabs.stateCode, state) : sql`${payrollSlabs.stateCode} IS NULL`));
    return set.map((s) => ({ from: toUnits(s.fromAmount), to: s.toAmount === null ? null : toUnits(s.toAmount), ratePercent: s.ratePercent === null ? null : pctUnits(s.ratePercent), fixed: s.fixedAmount === null ? null : toUnits(s.fixedAmount) }));
  };
  // Rates are stored with 6 decimals as numbers; money-like ones are whole rupees in 1/10000, percentages in 1/10000 %.
  const money = (code: string): bigint => rate(code);
  const regimeKey = regime === 'new' ? 'new' : 'old';
  const rules: Rules = {
    pfEmployeePct: rate('pf_employee_percent'), pfEmployerPct: rate('pf_employer_percent'), pfCeiling: money('pf_wage_ceiling'), esiEmployeePct: rate('esi_employee_percent'), esiEmployerPct: rate('esi_employer_percent'), esiCeiling: money('esi_wage_ceiling'),
    ptSlabs: await slabsOf('pt', stateCode), tdsSlabs: await slabsOf(regime === 'new' ? 'tds_new' : 'tds_old'),
    stdDeduction: money(`tds_std_deduction_${regimeKey}`), rebateLimit: money(`tds_rebate_limit_${regimeKey}`), rebateAmount: money(`tds_rebate_amount_${regimeKey}`), cessPct: rate('tds_cess_percent'),
  };
  return { rules, missing: [...new Set(missing)] };
}
