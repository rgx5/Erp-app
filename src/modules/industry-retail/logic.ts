import { round2 } from '@/domain/money'
import { listOf, type DataState } from '@/data/state'
import type { Bill } from '@/domain/types'
import type { AlterationJob, AlterationStatus, Boq, BoqLine, BoqStatus, Prescription, TradeIn } from './types'

// ───────────────────────────── pharmacy: Schedule H flag ─────────────────────────────

export const isScheduleH = (state: DataState, productId: string): boolean => !!state.rxFlags?.[productId]?.scheduleH

/** Items flagged Schedule H / H1 — a prescription register of what needs one, not of who bought what. */
export const scheduleHItems = (state: DataState): string[] =>
  listOf(state.rxFlags ?? {}).filter((f) => f.scheduleH).map((f) => f.id)

// ───────────────────────────── pharmacy: prescriptions ─────────────────────────────

export const prescriptionProblem = (d: Pick<Prescription, 'patientName' | 'doctorName'>): string | null => {
  if (!d.patientName.trim()) return 'Enter the patient’s name.'
  if (!d.doctorName.trim()) return 'Enter the doctor’s name.'
  return null
}

/** The bill a prescription names, by its number (typed, not picked) — so a slip can be logged before or after billing. */
export function billIdForNo(state: DataState, billNo: string): string | undefined {
  const no = billNo.trim()
  if (!no) return undefined
  return listOf(state.bills).find((b) => b.no === no)?.id
}

export const prescriptionsFor = (state: DataState, billId: string): Prescription[] =>
  listOf(state.prescriptions ?? {}).filter((p) => p.billId === billId)

export const recentPrescriptions = (state: DataState, limit = 50): Prescription[] =>
  listOf(state.prescriptions ?? {}).sort((a, b) => b.date - a.date).slice(0, limit)

// ───────────────────────────── pharmacy: generic substitutes ─────────────────────────────

/** The substitutes recorded for a branded item, resolved to products that still exist and are still sold. */
export function substitutesOf(state: DataState, productId: string) {
  const ids = state.substituteGroups?.[productId]?.subs ?? []
  return ids.map((id) => state.products[id]).filter((p): p is NonNullable<typeof p> => !!p && p.active)
}

export const hasSubstitutes = (state: DataState, productId: string) => (state.substituteGroups?.[productId]?.subs?.length ?? 0) > 0

// ───────────────────────────── electronics: trade-in ─────────────────────────────

export const TRADE_IN_CONDITION_LABEL: Record<TradeIn['condition'], string> = { working: 'Working', minor_damage: 'Minor damage', not_working: 'Not working' }

/** What a checkout panel keeps on the cart / bill (`bill.ext['industry-retail'].tradeIn`). */
export interface TradeInExt {
  device: string
  condition: TradeIn['condition']
  value: number
  notes: string
}

/** What a checkout panel keeps for an EMI plan printed on the receipt (`bill.ext['industry-retail'].emi`) — informational only. */
export interface EmiExt {
  downPayment: number
  months: number
}

export const tradeInOf = (bill: Pick<Bill, 'ext'>): TradeInExt | undefined => (bill.ext?.['industry-retail'] as { tradeIn?: TradeInExt } | undefined)?.tradeIn
export const emiOf = (bill: Pick<Bill, 'ext'>): EmiExt | undefined => (bill.ext?.['industry-retail'] as { emi?: EmiExt } | undefined)?.emi

/** What a trade-in's payment line must equal: the value agreed for the device (0 when none is being traded in). */
export const tradeInAmount = (bill: Pick<Bill, 'ext'>): number => round2(tradeInOf(bill)?.value ?? 0)

/** The monthly instalment an EMI plan implies: the bill total less the down payment, spread over the months. 0 when it does not add up. */
export function emiMonthly(total: number, emi: EmiExt): number {
  if (!(emi.months > 0)) return 0
  return round2(Math.max(0, total - emi.downPayment) / emi.months)
}

export const emiLine = (total: number, emi: EmiExt): string =>
  `EMI: ₹${emi.downPayment} down + ${emi.months} month${emi.months === 1 ? '' : 's'} of ₹${emiMonthly(total, emi)}`

export const recentTradeIns = (state: DataState, limit = 50): TradeIn[] =>
  listOf(state.tradeIns ?? {}).sort((a, b) => b.date - a.date).slice(0, limit)

// ───────────────────────────── apparel: alteration jobs ─────────────────────────────

export const ALTERATION_LABEL: Record<AlterationStatus, string> = {
  received: 'Received', in_progress: 'In progress', ready: 'Ready', delivered: 'Delivered', cancelled: 'Cancelled',
}

const ALTERATION_FLOW: Record<AlterationStatus, AlterationStatus[]> = {
  received: ['in_progress', 'ready', 'cancelled'],
  in_progress: ['ready', 'received', 'cancelled'],
  ready: ['delivered', 'in_progress', 'cancelled'],
  delivered: [],
  cancelled: ['received'],
}
export const nextAlterationStatuses = (s: AlterationStatus): AlterationStatus[] => ALTERATION_FLOW[s]
export const isOpenAlteration = (j: Pick<AlterationJob, 'status'>) => j.status !== 'delivered' && j.status !== 'cancelled'
export const isOverdueAlteration = (j: Pick<AlterationJob, 'status' | 'dueDate'>, now: number) => isOpenAlteration(j) && j.dueDate < now

export const openAlterationJobs = (state: DataState): AlterationJob[] =>
  listOf(state.alterationJobs ?? {}).filter(isOpenAlteration).sort((a, b) => a.dueDate - b.dueDate)

export function overdueAlterations(state: DataState, now: number): { jobs: number; charge: number } {
  const jobs = openAlterationJobs(state).filter((j) => isOverdueAlteration(j, now))
  return { jobs: jobs.length, charge: round2(jobs.reduce((s, j) => s + j.charge, 0)) }
}

// ───────────────────────────── hardware: BOQ ─────────────────────────────

export const BOQ_LABEL: Record<BoqStatus, string> = { draft: 'Draft', sent: 'Sent', converted: 'Converted', closed: 'Closed' }
const BOQ_FLOW: Record<BoqStatus, BoqStatus[]> = { draft: ['sent'], sent: ['draft', 'converted', 'closed'], converted: ['closed'], closed: [] }
export const nextBoqStatuses = (s: BoqStatus): BoqStatus[] => BOQ_FLOW[s]
export const canEditBoq = (b: Pick<Boq, 'status'>) => b.status === 'draft' || b.status === 'sent'

export const boqTotalQty = (items: Pick<BoqLine, 'qty'>[]) => round2(items.reduce((s, l) => s + l.qty, 0))

export function boqProblem(projectName: string, items: BoqLine[]): string | null {
  if (!projectName.trim()) return 'Give the project a name.'
  if (!items.length) return 'Add at least one item.'
  for (const l of items) {
    if (!l.name.trim()) return 'Every line needs an item.'
    if (!(l.qty > 0)) return `${l.name} needs a quantity.`
  }
  return null
}

export const openBoqs = (state: DataState): Boq[] =>
  listOf(state.boqs ?? {}).filter((b) => b.status !== 'closed').sort((a, b) => b.date - a.date)
