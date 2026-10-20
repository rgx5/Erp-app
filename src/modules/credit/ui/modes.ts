import type { CollectionMode } from '../types'

/** The ways money can reach the shop outside a sale. */
export const MODE_OPTIONS: Array<{ value: CollectionMode; label: string }> = [
  { value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI' }, { value: 'card', label: 'Card' }, { value: 'bank', label: 'Bank' }, { value: 'cheque', label: 'Cheque' },
]
export const REF_HINT: Record<CollectionMode, string> = {
  cash: '', upi: 'UPI transaction ID (optional)', card: 'Approval code (optional)', bank: 'NEFT / IMPS reference (optional)', cheque: 'Cheque number and bank (optional)',
}
