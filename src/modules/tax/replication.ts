// Pure half of the tax module: collections, permissions, effects. See docs/MODULES.md.
import { registerCollections } from '@/data/state'
import { registerPermission } from '@/domain/permissions'
import { registerCollectionMeta } from '@/replication/registry'
import type { Doc } from '@/replication/types'
import { assetProblem } from './logic/assets'
import { loanRepaymentProblem } from './logic/loans'
import { taxDeductionProblem } from './logic/tds'
import type {
  BankAccount, Budget, CostCentre, CostCentreTag, DepreciationRun, FixedAsset, FxTag, Loan, LoanRepayment, Pdc,
  ReconciliationMark, TaxDeduction, TaxSection,
} from './types'
import './types'

registerCollections([
  'bankAccounts', 'reconciliationMarks', 'fixedAssets', 'depreciationRuns', 'taxSections', 'taxDeductions',
  'budgets', 'costCentres', 'costCentreTags', 'fxTags', 'loans', 'loanRepayments', 'pdcs',
])

// Bank accounts, GST exports, TDS/TCS, assets, budgets, cost centres, FX and loans are accounting's territory.
registerPermission('tax', ['manager'])

const num = (d: Doc, k: string) => (typeof d[k] === 'number' ? (d[k] as number) : NaN)
const str = (d: Doc, k: string) => (typeof d[k] === 'string' ? (d[k] as string) : '')

registerCollectionMeta(
  { name: 'bankAccounts', kind: 'master', perm: 'tax', readPerm: 'tax', validate: (d) => (str(d, 'name').trim() ? null : 'A bank account needs a name.') },
  { name: 'reconciliationMarks', kind: 'master', perm: 'tax', readPerm: 'tax', branched: true },
  {
    name: 'fixedAssets', kind: 'master', perm: 'tax', readPerm: 'tax', branched: true,
    validate: (d) => assetProblem({ name: str(d, 'name'), cost: num(d, 'cost'), salvageValue: num(d, 'salvageValue'), usefulLifeMonths: num(d, 'usefulLifeMonths') }),
  },
  {
    name: 'depreciationRuns', kind: 'ledger', perm: 'tax', readPerm: 'tax', branched: true,
    validate: (d) => (num(d, 'amount') >= 0 && Number.isFinite(num(d, 'periodStart')) && Number.isFinite(num(d, 'periodEnd')) ? null : 'A depreciation run needs a period and a non-negative amount.'),
  },
  { name: 'taxSections', kind: 'master', perm: 'tax', readPerm: 'tax', validate: (d) => (str(d, 'section').trim() ? null : 'Give the section a name.') },
  {
    name: 'taxDeductions', kind: 'ledger', perm: 'tax', readPerm: 'tax', branched: true,
    validate: (d) => taxDeductionProblem({ grossAmount: num(d, 'grossAmount'), ratePct: num(d, 'ratePct'), partyName: str(d, 'partyName') }),
  },
  { name: 'budgets', kind: 'master', perm: 'tax', readPerm: 'tax', branched: true, validate: (d) => (num(d, 'amount') >= 0 ? null : 'A budget cannot be negative.') },
  { name: 'costCentres', kind: 'master', perm: 'tax', readPerm: 'tax', validate: (d) => (str(d, 'name').trim() ? null : 'Give the cost centre a name.') },
  { name: 'costCentreTags', kind: 'master', perm: 'tax', readPerm: 'tax' },
  { name: 'fxTags', kind: 'master', perm: 'tax', readPerm: 'tax' },
  { name: 'loans', kind: 'master', perm: 'tax', readPerm: 'tax', branched: true, validate: (d) => (str(d, 'name').trim() && num(d, 'principal') > 0 ? null : 'A loan needs a name and a principal amount.') },
  {
    name: 'loanRepayments', kind: 'ledger', perm: 'tax', readPerm: 'tax', branched: true,
    validate: (d) => loanRepaymentProblem({ amount: num(d, 'amount'), principalPart: num(d, 'principalPart'), interestPart: num(d, 'interestPart') }),
  },
  { name: 'pdcs', kind: 'master', perm: 'tax', readPerm: 'tax', branched: true, validate: (d) => (str(d, 'chequeNo').trim() && num(d, 'amount') > 0 ? null : 'A cheque needs its number and amount.') },
)

export type { BankAccount, Budget, CostCentre, CostCentreTag, DepreciationRun, FixedAsset, FxTag, Loan, LoanRepayment, Pdc, ReconciliationMark, TaxDeduction, TaxSection }
