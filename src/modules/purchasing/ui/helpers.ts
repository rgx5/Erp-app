import type { Supplier } from '@/domain/types'
import { PAY_MODES } from '../ops-payables'
import type { PayMode } from '../types'

/** Options for a supplier picker, A to Z. */
export const supplierOptions = (suppliers: Supplier[]) =>
  suppliers.map((s) => ({ value: s.id, label: s.name, sub: s.phone || undefined })).sort((a, b) => a.label.localeCompare(b.label))

export const MODE_LABEL: Record<PayMode, string> = { cash: 'Cash', upi: 'UPI', card: 'Card', bank: 'Bank transfer', cheque: 'Cheque' }
export const MODE_OPTIONS = PAY_MODES.map((m) => ({ value: m, label: MODE_LABEL[m] }))
export const REF_HINT: Record<PayMode, string> = { cash: '', upi: 'UPI reference (optional)', card: 'Card slip no. (optional)', bank: 'UTR / transfer reference (optional)', cheque: 'Cheque number' }

/** A date as typed (YYYY-MM-DD) is well-formed, or empty. */
export const dateOk = (s: string) => !s || /^\d{4}-\d{2}-\d{2}$/.test(s)
