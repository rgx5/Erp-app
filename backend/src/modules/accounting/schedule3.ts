/**
 * The fixed structure of the statements, after Schedule III (Division I) of the Companies Act 2013, in its common simplified form.
 * What is editable is the *mapping* of chart accounts to these lines; the lines themselves are statutory.
 */
export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';
export interface StatementLine { code: string; label: string; accountTypes: AccountType[] }

export const BALANCE_SHEET_LINES: readonly StatementLine[] = [
  { code: 'BS.SHARE_CAPITAL', label: 'Share capital', accountTypes: ['equity'] },
  { code: 'BS.RESERVES', label: 'Reserves and surplus', accountTypes: ['equity'] },
  { code: 'BS.LT_BORROWINGS', label: 'Long-term borrowings', accountTypes: ['liability'] },
  { code: 'BS.OTHER_LT_LIAB', label: 'Other long-term liabilities', accountTypes: ['liability'] },
  { code: 'BS.ST_BORROWINGS', label: 'Short-term borrowings', accountTypes: ['liability'] },
  { code: 'BS.TRADE_PAYABLES', label: 'Trade payables', accountTypes: ['liability'] },
  { code: 'BS.OTHER_CL', label: 'Other current liabilities', accountTypes: ['liability'] },
  { code: 'BS.ST_PROVISIONS', label: 'Short-term provisions', accountTypes: ['liability'] },
  { code: 'BS.PPE', label: 'Property, plant and equipment (net of depreciation)', accountTypes: ['asset'] },
  { code: 'BS.INTANGIBLES', label: 'Intangible assets', accountTypes: ['asset'] },
  { code: 'BS.CWIP', label: 'Capital work-in-progress', accountTypes: ['asset'] },
  { code: 'BS.NC_INVESTMENTS', label: 'Non-current investments', accountTypes: ['asset'] },
  { code: 'BS.OTHER_NCA', label: 'Other non-current assets', accountTypes: ['asset'] },
  { code: 'BS.CURRENT_INVESTMENTS', label: 'Current investments', accountTypes: ['asset'] },
  { code: 'BS.INVENTORIES', label: 'Inventories', accountTypes: ['asset'] },
  { code: 'BS.RECEIVABLES', label: 'Trade receivables', accountTypes: ['asset'] },
  { code: 'BS.CASH', label: 'Cash and cash equivalents', accountTypes: ['asset'] },
  { code: 'BS.ST_LOANS_ADV', label: 'Short-term loans and advances', accountTypes: ['asset'] },
  { code: 'BS.OTHER_CA', label: 'Other current assets', accountTypes: ['asset'] },
];

export const PROFIT_LOSS_LINES: readonly StatementLine[] = [
  { code: 'PL.REVENUE', label: 'Revenue from operations', accountTypes: ['income'] },
  { code: 'PL.OTHER_INCOME', label: 'Other income', accountTypes: ['income'] },
  { code: 'PL.MATERIALS', label: 'Cost of materials consumed and goods sold', accountTypes: ['expense'] },
  { code: 'PL.INVENTORY_CHANGES', label: 'Changes in inventories and stock adjustments', accountTypes: ['expense'] },
  { code: 'PL.EMPLOYEE', label: 'Employee benefit expense', accountTypes: ['expense'] },
  { code: 'PL.FINANCE', label: 'Finance costs', accountTypes: ['expense'] },
  { code: 'PL.DEPRECIATION', label: 'Depreciation and amortisation expense', accountTypes: ['expense'] },
  { code: 'PL.OTHER_EXPENSES', label: 'Other expenses', accountTypes: ['expense'] },
  { code: 'PL.TAX', label: 'Tax expense', accountTypes: ['expense'] },
];

export const ALL_LINES = [...BALANCE_SHEET_LINES, ...PROFIT_LOSS_LINES];
export const lineByCode = new Map(ALL_LINES.map((l) => [l.code, l]));

/** Default mapping for the manufacturing template chart, by account code. Anything else must be mapped by hand. */
export const DEFAULT_MAPPING: Record<string, string> = {
  '1110': 'BS.CASH', '1120': 'BS.CASH', '1130': 'BS.RECEIVABLES', '1140': 'BS.ST_LOANS_ADV',
  '1210': 'BS.INVENTORIES', '1220': 'BS.INVENTORIES', '1230': 'BS.INVENTORIES', '1240': 'BS.INVENTORIES', '1250': 'BS.INVENTORIES', '1260': 'BS.INVENTORIES',
  '1310': 'BS.OTHER_CA', '1320': 'BS.OTHER_CA', '1330': 'BS.OTHER_CA', '1340': 'BS.OTHER_CA', '1510': 'BS.PPE', '1590': 'BS.PPE',
  '2110': 'BS.TRADE_PAYABLES', '2120': 'BS.TRADE_PAYABLES', '2130': 'BS.OTHER_CL', '2140': 'BS.OTHER_CL', '2210': 'BS.OTHER_CL', '2220': 'BS.OTHER_CL', '2230': 'BS.OTHER_CL', '2240': 'BS.OTHER_CL', '2310': 'BS.LT_BORROWINGS',
  '3100': 'BS.SHARE_CAPITAL', '3200': 'BS.RESERVES',
  '4100': 'PL.REVENUE', '4110': 'PL.REVENUE', '4120': 'PL.REVENUE', '4130': 'PL.REVENUE', '4900': 'PL.OTHER_INCOME',
  '5100': 'PL.MATERIALS', '5210': 'PL.EMPLOYEE', '5220': 'PL.OTHER_EXPENSES', '5230': 'PL.OTHER_EXPENSES', '5240': 'PL.OTHER_EXPENSES', '5250': 'PL.OTHER_EXPENSES', '5260': 'PL.OTHER_EXPENSES',
  '5300': 'PL.INVENTORY_CHANGES', '5400': 'PL.MATERIALS', '5500': 'PL.EMPLOYEE', '5600': 'PL.OTHER_EXPENSES', '5700': 'PL.DEPRECIATION', '5800': 'PL.FINANCE', '5900': 'PL.OTHER_EXPENSES',
};

/** Statement arithmetic in value units (1/10000), pure and exact. */
export interface PlTotals { revenue: bigint; otherIncome: bigint; totalRevenue: bigint; totalExpenses: bigint; profitBeforeTax: bigint; tax: bigint; profit: bigint }
export function profitLoss(by: (code: string) => bigint): PlTotals {
  const revenue = by('PL.REVENUE');
  const otherIncome = by('PL.OTHER_INCOME');
  const tax = by('PL.TAX');
  const totalExpenses = ['PL.MATERIALS', 'PL.INVENTORY_CHANGES', 'PL.EMPLOYEE', 'PL.FINANCE', 'PL.DEPRECIATION', 'PL.OTHER_EXPENSES'].reduce((a, c) => a + by(c), 0n);
  const totalRevenue = revenue + otherIncome;
  const profitBeforeTax = totalRevenue - totalExpenses;
  return { revenue, otherIncome, totalRevenue, totalExpenses, profitBeforeTax, tax, profit: profitBeforeTax - tax };
}
