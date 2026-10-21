import { listOf, type DataState } from '@/data/state'
import type { HomeNotice } from '../registry'
import { jobBook } from './jobs'
import { isLate } from './production'

/** Home-screen alerts: orders past their date, jobs due or waiting to be handed over. Pure and quick. */
export function lateOrdersNotice(state: DataState, now: number): HomeNotice | null {
  const late = listOf(state.workOrders).filter((w) => isLate(w, now))
  return late.length ? { id: 'mf-late', tone: 'warning', title: `${late.length} work order${late.length === 1 ? ' is' : 's are'} past the due date`, body: late.slice(0, 3).map((w) => w.no).join(', '), action: 'Open', to: '/m/manufacturing/orders' } : null
}

export function jobsNotice(state: DataState, now: number): HomeNotice | null {
  if (!listOf(state.jobOrders).length) return null
  const b = jobBook(state, now)
  if (b.late.length) return { id: 'mf-jobs-late', tone: 'danger', title: `${b.late.length} customer job${b.late.length === 1 ? ' is' : 's are'} late`, body: b.late.slice(0, 3).map((j) => j.no).join(', '), action: 'Open', to: '/m/manufacturing/jobs' }
  if (b.dueSoon.length) return { id: 'mf-jobs-soon', tone: 'primary', title: `${b.dueSoon.length} customer job${b.dueSoon.length === 1 ? ' is' : 's are'} due within 2 days`, action: 'Open', to: '/m/manufacturing/jobs' }
  return null
}

export function readyJobsNotice(state: DataState, now: number): HomeNotice | null {
  if (!listOf(state.jobOrders).length) return null
  const n = jobBook(state, now).ready
  return n ? { id: 'mf-jobs-ready', tone: 'success', title: `${n} job${n === 1 ? ' is' : 's are'} ready to hand over`, action: 'Open', to: '/m/manufacturing/jobs' } : null
}
