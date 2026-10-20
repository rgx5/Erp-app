import type { Tone } from '@/ui/theme'
import type { ChallanStatus, OrderStatus, QuoteStatus } from '../types'

export const QUOTE_TONE: Record<QuoteStatus, Tone> = { draft: 'default', sent: 'primary', accepted: 'success', rejected: 'danger', expired: 'warning', converted: 'success' }
export const ORDER_TONE: Record<OrderStatus, Tone> = { open: 'primary', ready: 'success', delivered: 'default', cancelled: 'danger' }
export const CHALLAN_TONE: Record<ChallanStatus, Tone> = { packed: 'warning', dispatched: 'primary', delivered: 'success' }
