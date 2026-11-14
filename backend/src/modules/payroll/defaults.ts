/**
 * Statutory defaults offered as a STARTING POINT for financial year 2025-26 (India). They are not a source of truth: your accountant
 * must confirm every figure, and each change is a new dated rule set, never an edit.
 */
export const DEFAULT_RATES: Record<string, string> = {
  pf_employee_percent: '12', pf_employer_percent: '12', pf_wage_ceiling: '15000', esi_employee_percent: '0.75', esi_employer_percent: '3.25', esi_wage_ceiling: '21000',
  tds_std_deduction_new: '75000', tds_std_deduction_old: '50000', tds_rebate_limit_new: '1200000', tds_rebate_amount_new: '60000', tds_rebate_limit_old: '500000', tds_rebate_amount_old: '12500', tds_cess_percent: '4',
};
export const DEFAULT_TDS_NEW: { from: string; to: string | null; rate: string }[] = [
  { from: '0', to: '400000', rate: '0' }, { from: '400000', to: '800000', rate: '5' }, { from: '800000', to: '1200000', rate: '10' }, { from: '1200000', to: '1600000', rate: '15' },
  { from: '1600000', to: '2000000', rate: '20' }, { from: '2000000', to: '2400000', rate: '25' }, { from: '2400000', to: null, rate: '30' },
];
export const DEFAULT_TDS_OLD: { from: string; to: string | null; rate: string }[] = [
  { from: '0', to: '250000', rate: '0' }, { from: '250000', to: '500000', rate: '5' }, { from: '500000', to: '1000000', rate: '20' }, { from: '1000000', to: null, rate: '30' },
];
/** Maharashtra professional tax (monthly), as a worked example for the `pt` slab set; other states are entered by hand. */
export const DEFAULT_PT_MAHARASHTRA: { from: string; to: string | null; fixed: string }[] = [
  { from: '0', to: '7500', fixed: '0' }, { from: '7500.0001', to: '10000', fixed: '175' }, { from: '10000.0001', to: null, fixed: '200' },
];
