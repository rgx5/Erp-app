export interface TemplateAccount {
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
  parent?: string;
  group?: true;
  control?: 'receivable' | 'payable' | 'inventory' | 'work_in_progress' | 'tax';
}

/**
 * An OPT-IN starting chart for an Indian manufacturing business. It is applied only when asked for, never automatically, and
 * every account can be renamed or deactivated afterwards. It is a convenience, not an accounting policy: your accountant decides
 * the real chart. Subledger-controlled accounts (receivables, payables, stock, WIP, GST) are marked as control accounts so that
 * only the subledgers, not manual journals, can post to them.
 */
export const MANUFACTURING_INDIA_TEMPLATE: readonly TemplateAccount[] = [
  { code: '1000', name: 'Assets', type: 'asset', group: true },
  { code: '1100', name: 'Current assets', type: 'asset', group: true, parent: '1000' },
  { code: '1110', name: 'Cash in hand', type: 'asset', parent: '1100' },
  { code: '1120', name: 'Bank accounts', type: 'asset', parent: '1100' },
  { code: '1130', name: 'Trade receivables', type: 'asset', parent: '1100', control: 'receivable' },
  { code: '1140', name: 'Advances to suppliers', type: 'asset', parent: '1100' },
  { code: '1200', name: 'Inventory', type: 'asset', group: true, parent: '1000' },
  { code: '1210', name: 'Raw material inventory', type: 'asset', parent: '1200', control: 'inventory' },
  { code: '1220', name: 'Packing material inventory', type: 'asset', parent: '1200', control: 'inventory' },
  { code: '1230', name: 'Work in progress', type: 'asset', parent: '1200', control: 'work_in_progress' },
  { code: '1240', name: 'Finished goods inventory', type: 'asset', parent: '1200', control: 'inventory' },
  { code: '1250', name: 'Stores and consumables', type: 'asset', parent: '1200', control: 'inventory' },
  { code: '1260', name: 'Material with subcontractors', type: 'asset', parent: '1200', control: 'inventory' },
  { code: '1300', name: 'GST and tax receivable', type: 'asset', group: true, parent: '1000' },
  { code: '1310', name: 'Input CGST', type: 'asset', parent: '1300', control: 'tax' },
  { code: '1320', name: 'Input SGST', type: 'asset', parent: '1300', control: 'tax' },
  { code: '1330', name: 'Input IGST', type: 'asset', parent: '1300', control: 'tax' },
  { code: '1340', name: 'TDS and TCS receivable', type: 'asset', parent: '1300', control: 'tax' },
  { code: '1500', name: 'Fixed assets', type: 'asset', group: true, parent: '1000' },
  { code: '1510', name: 'Plant and machinery', type: 'asset', parent: '1500' },
  { code: '1590', name: 'Accumulated depreciation', type: 'asset', parent: '1500' },
  { code: '2000', name: 'Liabilities', type: 'liability', group: true },
  { code: '2100', name: 'Current liabilities', type: 'liability', group: true, parent: '2000' },
  { code: '2110', name: 'Trade payables', type: 'liability', parent: '2100', control: 'payable' },
  { code: '2120', name: 'Goods received not invoiced', type: 'liability', parent: '2100', control: 'inventory' },
  { code: '2130', name: 'Advances from customers', type: 'liability', parent: '2100' },
  { code: '2140', name: 'Accrued expenses', type: 'liability', parent: '2100' },
  { code: '2200', name: 'Duties and taxes payable', type: 'liability', group: true, parent: '2000' },
  { code: '2210', name: 'Output CGST', type: 'liability', parent: '2200', control: 'tax' },
  { code: '2220', name: 'Output SGST', type: 'liability', parent: '2200', control: 'tax' },
  { code: '2230', name: 'Output IGST', type: 'liability', parent: '2200', control: 'tax' },
  { code: '2240', name: 'TDS payable', type: 'liability', parent: '2200', control: 'tax' },
  { code: '2300', name: 'Loans', type: 'liability', group: true, parent: '2000' },
  { code: '2310', name: 'Secured loans', type: 'liability', parent: '2300' },
  { code: '3000', name: 'Equity', type: 'equity', group: true },
  { code: '3100', name: 'Share capital / owner capital', type: 'equity', parent: '3000' },
  { code: '3200', name: 'Retained earnings', type: 'equity', parent: '3000' },
  { code: '4000', name: 'Income', type: 'income', group: true },
  { code: '4100', name: 'Sales of finished goods', type: 'income', parent: '4000' },
  { code: '4110', name: 'Sales of traded goods', type: 'income', parent: '4000' },
  { code: '4120', name: 'Sales of scrap', type: 'income', parent: '4000' },
  { code: '4130', name: 'Job work and service income', type: 'income', parent: '4000' },
  { code: '4900', name: 'Other income', type: 'income', parent: '4000' },
  { code: '5000', name: 'Expenses', type: 'expense', group: true },
  { code: '5100', name: 'Cost of goods sold', type: 'expense', parent: '5000' },
  { code: '5200', name: 'Manufacturing costs', type: 'expense', group: true, parent: '5000' },
  { code: '5210', name: 'Direct labour', type: 'expense', parent: '5200' },
  { code: '5220', name: 'Manufacturing overheads', type: 'expense', parent: '5200' },
  { code: '5230', name: 'Overheads absorbed', type: 'expense', parent: '5200' },
  { code: '5240', name: 'Subcontracting charges', type: 'expense', parent: '5200' },
  { code: '5250', name: 'Scrap and wastage', type: 'expense', parent: '5200' },
  { code: '5260', name: 'Production variances', type: 'expense', parent: '5200' },
  { code: '5300', name: 'Inventory adjustments', type: 'expense', parent: '5000' },
  { code: '5400', name: 'Purchase price variance', type: 'expense', parent: '5000' },
  { code: '5500', name: 'Salaries and wages', type: 'expense', parent: '5000' },
  { code: '5600', name: 'Rent and utilities', type: 'expense', parent: '5000' },
  { code: '5700', name: 'Depreciation', type: 'expense', parent: '5000' },
  { code: '5800', name: 'Bank charges and interest', type: 'expense', parent: '5000' },
  { code: '5900', name: 'Other expenses', type: 'expense', parent: '5000' },
];
