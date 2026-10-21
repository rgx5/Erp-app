import { round3 } from '@/domain/qty'
import { DAY } from '@/domain/dates'
import { listOf, type DataState } from '@/data/state'
import type { CustomerMaterial, JobKind, JobOrder, JobStage, JobStatus, WorkOrder } from './types'

export const JOB_LABEL: Record<JobStatus, string> = { received: 'Received', in_production: 'In production', ready: 'Ready', delivered: 'Delivered', cancelled: 'Cancelled' }
export const JOB_KIND_LABEL: Record<JobKind, string> = { made_to_order: 'Made to order', job_work: 'Job work (customer’s material)' }

/** Stages a tailor's order usually goes through; a job starts with these unless told otherwise. */
export const DEFAULT_STAGES = ['Cutting', 'Stitching', 'Finishing', 'Trial', 'Ready']

export const newStages = (names: string[] = DEFAULT_STAGES): JobStage[] => names.map((n) => n.trim()).filter(Boolean).map((name) => ({ name }))

export const isOpenJob = (j: JobOrder) => j.status === 'received' || j.status === 'in_production' || j.status === 'ready'

/** What of the customer's material is still with us: received − used − returned (per line). */
export const materialOutstanding = (m: CustomerMaterial) => round3(m.received - m.used - m.returned)
export const materialsWithUs = (j: JobOrder) => j.materials.filter((m) => materialOutstanding(m) > 0)

export const stagesDone = (j: JobOrder) => j.stages.filter((s) => s.doneAt).length

/** Status after a stage is ticked: with no work order, the stages alone say how far the job is. */
export function statusFromStages(j: JobOrder): JobStatus {
  if (j.status === 'delivered' || j.status === 'cancelled') return j.status
  const done = stagesDone(j)
  if (j.stages.length && done === j.stages.length) return 'ready'
  return done > 0 ? 'in_production' : j.workOrderId ? j.status : 'received'
}

/** Status of a job once its work order changes. */
export function statusFromWorkOrder(j: JobOrder, wo: WorkOrder): JobStatus {
  if (j.status === 'delivered' || j.status === 'cancelled') return j.status
  if (wo.status === 'done') return 'ready'
  if (wo.status === 'in_progress') return 'in_production'
  if (wo.status === 'cancelled') return 'received'
  return j.status
}

export const jobDueIn = (j: JobOrder, now: number): number | null => (j.dueDate ? Math.ceil((j.dueDate - now) / DAY) : null)
export const isJobLate = (j: JobOrder, now: number) => isOpenJob(j) && j.status !== 'ready' && !!j.dueDate && j.dueDate < now

export function jobBook(state: DataState, now: number) {
  const open = listOf(state.jobOrders).filter(isOpenJob)
  return {
    open: open.length,
    ready: open.filter((j) => j.status === 'ready').length,
    late: open.filter((j) => isJobLate(j, now)),
    dueSoon: open.filter((j) => j.status !== 'ready' && j.dueDate && j.dueDate >= now && j.dueDate - now <= 2 * DAY),
    materialsWithUs: open.filter((j) => materialsWithUs(j).length),
  }
}
