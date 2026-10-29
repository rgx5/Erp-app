import { listOf, type DataState } from '@/data/state'
import { round2 } from '@/domain/money'
import { toCsv, type CsvCell } from '@/domain/csv'
import { fmtDate } from '@/domain/dates'
import type { DepreciationRun, DepreciationMethod, FixedAsset } from '../types'

/** Straight-line and written-down-value depreciation, kept simple: one amount a month, never below the salvage value. */

export function assetProblem(d: { name: string; cost: number; salvageValue: number; usefulLifeMonths: number }): string | null {
  if (!d.name?.trim()) return 'Give the asset a name.'
  if (!(d.cost > 0)) return 'The cost must be more than zero.'
  if (!(d.salvageValue >= 0)) return 'The salvage value cannot be negative.'
  if (d.salvageValue >= d.cost) return 'The salvage value must be less than the cost.'
  if (!(d.usefulLifeMonths > 0)) return 'Enter a useful life in months.'
  return null
}

/** The accumulated depreciation booked on an asset so far (its posted runs, net of any reversal). */
export function accumulatedDepreciation(state: DataState, assetId: string): number {
  const runs = listOf(state.depreciationRuns).filter((r) => r.assetId === assetId)
  const reversed = new Set(runs.filter((r) => r.reversesId).map((r) => r.reversesId))
  return round2(runs.filter((r) => !reversed.has(r.id) && !r.reversesId).reduce((s, r) => s + r.amount, 0) - runs.filter((r) => r.reversesId).reduce((s, r) => s + r.amount, 0))
}

export const bookValue = (asset: FixedAsset, accumulated: number) => round2(asset.cost - accumulated)

/** Depreciable amount left for one more month, straight-line: (cost − salvage) ÷ life, never past the salvage floor. */
export function slmMonthlyAmount(asset: Pick<FixedAsset, 'cost' | 'salvageValue' | 'usefulLifeMonths'>, accumulated: number): number {
  const straight = round2((asset.cost - asset.salvageValue) / asset.usefulLifeMonths)
  const room = round2(asset.cost - asset.salvageValue - accumulated)
  return Math.max(0, Math.min(straight, room))
}

/** The annual WDV rate that would run the asset down to its salvage value over its useful life, when none is given. */
export function impliedWdvRatePct(asset: Pick<FixedAsset, 'cost' | 'salvageValue' | 'usefulLifeMonths'>): number {
  const years = asset.usefulLifeMonths / 12
  if (!(years > 0) || !(asset.cost > 0) || asset.salvageValue <= 0) return years > 0 ? 100 : 0
  return round2((1 - Math.pow(asset.salvageValue / asset.cost, 1 / years)) * 100)
}

/** One month of WDV depreciation on the book value carried forward, never past the salvage floor. */
export function wdvMonthlyAmount(asset: Pick<FixedAsset, 'cost' | 'salvageValue' | 'usefulLifeMonths' | 'wdvRatePct'>, accumulated: number): number {
  const ratePct = asset.wdvRatePct ?? impliedWdvRatePct(asset)
  const carrying = bookValue(asset as FixedAsset, accumulated)
  const monthly = round2((carrying * ratePct) / 100 / 12)
  const room = round2(carrying - asset.salvageValue)
  return Math.max(0, Math.min(monthly, room))
}

export function nextDepreciationAmount(asset: FixedAsset, accumulated: number): number {
  return asset.method === 'wdv' ? wdvMonthlyAmount(asset, accumulated) : slmMonthlyAmount(asset, accumulated)
}

export interface ScheduleRow { periodStart: number; periodEnd: number; amount: number; accumulatedAfter: number; bookValueAfter: number }

/** A forward schedule of `months` periods from `fromAccumulated`, for the screen to show before anything is posted. */
export function depreciationSchedule(asset: FixedAsset, months: number, fromAccumulated = 0): ScheduleRow[] {
  const rows: ScheduleRow[] = []
  let acc = fromAccumulated
  const start = new Date(asset.purchaseDate)
  for (let i = 0; i < months; i++) {
    const amount = nextDepreciationAmount(asset, acc)
    if (amount <= 0) break
    const periodStart = new Date(start.getFullYear(), start.getMonth() + i, 1).getTime()
    const periodEnd = new Date(start.getFullYear(), start.getMonth() + i + 1, 0, 23, 59, 59, 999).getTime()
    acc = round2(acc + amount)
    rows.push({ periodStart, periodEnd, amount, accumulatedAfter: acc, bookValueAfter: bookValue(asset, acc) })
  }
  return rows
}

export const DEPRECIATION_EXPENSE_CATEGORY = 'Depreciation'
export const ACCUM_DEPRECIATION_KEY = 'tax_accum_depreciation'

export interface AssetRegisterRow { asset: FixedAsset; accumulated: number; bookValue: number }
export function assetRegister(state: DataState): AssetRegisterRow[] {
  return listOf(state.fixedAssets).map((asset) => {
    const accumulated = accumulatedDepreciation(state, asset.id)
    return { asset, accumulated, bookValue: bookValue(asset, accumulated) }
  }).sort((a, b) => a.asset.code.localeCompare(b.asset.code))
}

export function assetRegisterCsv(rows: AssetRegisterRow[]) {
  const head: CsvCell[] = ['Code', 'Name', 'Category', 'Purchased', 'Cost', 'Method', 'Accumulated depreciation', 'Book value', 'Status']
  return toCsv([head, ...rows.map((r): CsvCell[] => [r.asset.code, r.asset.name, r.asset.category, fmtDate(r.asset.purchaseDate), r.asset.cost, r.asset.method === 'wdv' ? 'WDV' : 'SLM', r.accumulated, r.bookValue, r.asset.status])])
}

export const METHOD_LABEL: Record<DepreciationMethod, string> = { slm: 'Straight-line', wdv: 'Written-down value' }

export type { DepreciationRun }
