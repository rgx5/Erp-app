import type { PartyType } from '../postings'

export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense'

/** One account in the chart of accounts. */
export interface Account {
  id: string
  /** The number people know it by (1001, 4001…). Unique. */
  code: string
  name: string
  type: AccountType
  /** Id of the account this one is grouped under (optional). */
  parent?: string
  /** Built in: it can be renamed and switched off but never deleted, and its type cannot change. */
  system: boolean
  /** The well-known key (`cash`, `sales`, `expense:Rent`…) that documents post to this account with. */
  key?: string
  /** Sub-group for reports: 'Cost of sales' separates direct costs from operating expenses on the profit & loss. */
  group?: string
  /** The balance before any document in this system, on the account's normal side (debit for assets and expenses, credit for the rest). Negative = the other side. */
  openingBalance: number
  openingDate?: number
  active: boolean
  createdAt: number
}

export type VoucherType = 'receipt' | 'payment' | 'journal' | 'contra' | 'closing'

export interface VoucherLine {
  /** An account code, id, or well-known key. */
  account: string
  debit?: number
  credit?: number
  party?: { type: PartyType; id: string }
}

/** A posted accounting entry made by hand (or by closing a year). Never edited: a mistake is reversed by another voucher. */
export interface Voucher {
  id: string
  no: string
  type: VoucherType
  date: number
  narration: string
  lines: VoucherLine[]
  /** Photos / files (ids from the server file store, or local URIs). */
  attachments?: string[]
  /** The voucher this one reverses. */
  reversesId?: string
  /** The financial year this closing voucher closes. */
  yearId?: string
  createdBy: string
  createdAt: number
  branchId?: string
}

export interface FinancialYear {
  id: string
  label: string
  start: number
  end: number
  status: 'open' | 'closed'
  closedAt?: number
  closedBy?: string
  closingVoucherId?: string
}

/** "Nothing on or before this date may be posted or changed." The latest lock wins. */
export interface PeriodLock {
  id: string
  /** End of the last locked day. */
  throughDate: number
  note: string
  createdBy: string
  createdAt: number
}

declare module '@/data/state' {
  interface CollMap {
    accounts: Account
    vouchers: Voucher
    financialYears: FinancialYear
    periodLocks: PeriodLock
  }
}
