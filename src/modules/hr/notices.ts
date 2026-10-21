import { listOf, type DataState } from '@/data/state'
import { decisionsByRef, statusOf } from './logic/decisions'
import { payrollPreview } from './logic/payroll'
import { hrSettings } from './logic/settings'
import { livePayslips } from './logic/slips'
import { addMonths, diffDays, labelYM, ymdOf } from './logic/ymd'

export interface Waiting { leave: number; claims: number; regularisations: number; total: number }

/** Requests that have not been answered. */
export function waitingApprovals(s: Pick<DataState, 'leaveRequests' | 'expenseClaims' | 'regularisations' | 'hrDecisions'>): Waiting {
  const by = decisionsByRef(s)
  const open = (list: Array<{ id: string }>) => list.filter((r) => statusOf(by.get(r.id)) === 'pending').length
  const leave = open(listOf(s.leaveRequests ?? {}))
  const claims = open(listOf(s.expenseClaims ?? {}))
  const regularisations = open(listOf(s.regularisations ?? {}))
  return { leave, claims, regularisations, total: leave + claims + regularisations }
}

/** Documents (Aadhaar, licence, contract) that have run out or will within 30 days. */
export function expiringDocs(s: Pick<DataState, 'employeeDocs' | 'employees'>, now: number) {
  const today = ymdOf(now)
  const docs = listOf(s.employeeDocs ?? {}).filter((d) => d.expiresOn && diffDays(today, d.expiresOn) <= 30 && (s.employees?.[d.employeeId]?.active ?? false))
  return { expired: docs.filter((d) => d.expiresOn! < today).length, soon: docs.filter((d) => d.expiresOn! >= today).length }
}

/** The month before this one has people with pay terms but no payslip, and salary day has passed. */
export function payrollOverdue(s: DataState, now: number): { month: string; label: string; people: number } | null {
  if (!Object.keys(s.employeePay ?? {}).length) return null // nobody here may see pay, or nobody is paid through the app
  const today = ymdOf(now)
  const settings = hrSettings(s)
  if (Number(today.slice(8, 10)) < settings.payDay) return null
  const month = addMonths(today.slice(0, 7), -1)
  if (livePayslips(s).some((p) => p.month === month)) return null
  const people = payrollPreview(s, month, now).filter((r) => !r.existing && r.pay).length
  return people ? { month, label: labelYM(month), people } : null
}
