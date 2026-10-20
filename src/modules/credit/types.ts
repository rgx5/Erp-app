export type CollectionMode = 'cash' | 'upi' | 'card' | 'bank' | 'cheque'

/** What a customer may owe, and for how long. One per customer; the id is the customer's id. */
export interface CustomerTerms {
  id: string
  customerId: string
  /** The most the customer may owe at once. 0 = no limit. */
  creditLimit: number
  /** Days from the sale until it is due. */
  creditDays: number
  /** No credit at all for this customer (they must pay at the counter). */
  blocked: boolean
  notes: string
}

/** Money received from a customer against what they owe (a receipt). Posted once; a mistake is reversed by a new document. */
export interface Collection {
  id: string
  /** RC-0001 */
  no: string
  customerId: string
  amount: number
  mode: CollectionMode
  /** Cheque number, UPI reference… */
  ref: string
  date: number
  /** Which bills it settles. The part not allocated stays as an advance on the customer's account. */
  allocations: Array<{ billId: string; amount: number }>
  advance: number
  note: string
  userId: string
  branchId?: string
}

/** A gift card or voucher. Its balance is never stored: it is the sum of its transactions. */
export interface GiftCard {
  id: string
  /** What the customer types or scans. Upper case, unique. */
  code: string
  value: number
  customerId?: string
  expiresAt?: number
  note: string
  issuedAt: number
  issuedBy: string
  active: boolean
}

export type GiftCardTxnType = 'issue' | 'redeem' | 'refund'

export interface GiftCardTxn {
  id: string
  cardId: string
  type: GiftCardTxnType
  /** Always positive; the type says which way it moves. */
  amount: number
  /** How the card was paid for (issue) / the sale it was spent on (redeem). */
  mode?: CollectionMode
  billId?: string
  date: number
  userId: string
  note: string
  branchId?: string
}

/** A customer pays money in and gets the same amount as store credit. */
export interface CreditTopup {
  id: string
  no: string
  customerId: string
  amount: number
  mode: CollectionMode
  ref: string
  date: number
  userId: string
  branchId?: string
}

/** The shop's settings for this module (one document, id 'credit'). */
export interface CreditSettings {
  id: 'credit'
  /** UPI id the shop is paid on (shop@bank). */
  upiId: string
  payeeName: string
  /** Days to pay when a customer has no terms of their own. */
  defaultDays: number
  reminderTone: 'polite' | 'firm'
}

declare module '@/data/state' {
  interface CollMap {
    customerTerms: CustomerTerms
    collections: Collection
    giftCards: GiftCard
    giftCardTxns: GiftCardTxn
    creditTopups: CreditTopup
    creditSettings: CreditSettings
  }
}

declare module '@/domain/types' {
  interface Customer {
    /** Net amount the customer owes the shop (negative = they have paid in advance). Kept by the server; the phone computes it from documents. */
    dueBalance?: number
  }
}
