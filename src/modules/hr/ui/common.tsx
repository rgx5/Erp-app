import React, { useMemo } from 'react'
import { ScrollView, View } from 'react-native'
import { csvFileName, toCsv } from '@/domain/csv'
import { inr } from '@/domain/money'
import { useStore } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { perform, useApp, currentUser } from '@/data/store'
import type { DataState } from '@/data/state'
import { printHtml, sharePdf } from '@/features/share'
import { shareFile } from '@/features/shareFile'
import { Button } from '@/ui/Button'
import { Select } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Card, Tap } from '@/ui/primitives'
import { EmptyState } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { ChevronLeft, ChevronRight, Download, FileText, Printer } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'
import { tableHtml } from '../html'
import { employeeOfUser, buildIndex, type HrIndex } from '../logic/select'
import { tableCsvRows, type HrTable } from '../logic/reports'
import { addMonths, labelYM, ymOf } from '../logic/ymd'
import type { Employee, YM } from '../types'

/** The documents of the module grouped per person, the employee who signs in as this user, and the current minute. */
export function useHr(): { data: DataState; idx: HrIndex; me: Employee | undefined; now: number } {
  const data = useApp((s) => s.data)
  const userId = useApp((s) => currentUser(s)?.id)
  const idx = useMemo(() => buildIndex(data), [data])
  const me = useMemo(() => employeeOfUser(data, userId), [data, userId])
  return { data, idx, me, now: Math.floor(Date.now() / 60_000) * 60_000 }
}

/** Runs an operation, shows its refusal in a toast, and returns its result (undefined when it was refused). */
export function act<R extends { changes: import('@/data/state').Changes }>(fn: (s: DataState, ctx: import('@/data/ops').OpCtx) => R, ok?: string): R | undefined {
  try {
    const r = perform(fn)
    if (ok) toast(ok, 'ok')
    return r
  } catch (e) {
    toast(e instanceof OpError ? e.message : 'Something went wrong. Nothing was saved.', 'err')
    return undefined
  }
}

export function Denied({ title, who }: { title: string; who: string }) {
  return <Screen title={title} back><T tone="mute">{who}</T></Screen>
}

/** ‹ October 2026 › */
export function MonthBar({ month, onChange, max }: { month: YM; onChange: (m: YM) => void; max?: YM }) {
  const { c } = useTheme()
  const cap = max ?? ymOf(Date.now())
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 }}>
      <Tap onPress={() => onChange(addMonths(month, -1))} style={{ padding: 10 }} accessibilityLabel="Previous month"><ChevronLeft size={22} color={c.ink} /></Tap>
      <T v="title">{labelYM(month)}</T>
      <Tap onPress={() => month < cap && onChange(addMonths(month, 1))} style={{ padding: 10, opacity: month < cap ? 1 : 0.3 }} accessibilityLabel="Next month"><ChevronRight size={22} color={c.ink} /></Tap>
    </View>
  )
}

export function EmployeeSelect({ label = 'Employee', value, onChange, employees, error }: { label?: string; value: string; onChange: (id: string) => void; employees: Employee[]; error?: string | null }) {
  return <Select label={label} value={value} onChange={onChange} searchable={employees.length > 8} error={error} placeholder="Choose a person" options={employees.map((e) => ({ value: e.id, label: e.name, sub: [e.code, e.designation].filter(Boolean).join(' · ') }))} />
}

const cell = (v: unknown) => (typeof v === 'number' ? inr(v, Number.isInteger(v) ? 0 : 2) : v === null || v === undefined ? '' : String(v))

/** A report on the screen: columns stay in line, wide ones scroll sideways. */
export function TableCard({ table }: { table: HrTable }) {
  const { c } = useTheme()
  const bold = new Set(table.bold ?? [])
  const w = (i: number) => (table.columns[i].align === 'right' ? 92 : i === 1 ? 150 : 100)
  if (!table.rows.length) return <EmptyState icon={<FileText size={26} color={c.primary} />} title="Nothing to show" hint="There is no data for this yet." compact />
  return (
    <Card padded={false}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          <View style={{ flexDirection: 'row', gap: 8, paddingVertical: 9, paddingHorizontal: 12, backgroundColor: c.sunken }}>
            {table.columns.map((col, i) => <T key={i} v="label" tone="soft" align={col.align} style={{ width: w(i) }}>{col.label}</T>)}
          </View>
          {table.rows.map((r, ri) => (
            <View key={ri} style={{ flexDirection: 'row', gap: 8, paddingVertical: 9, paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: c.line, backgroundColor: bold.has(ri) ? c.surfaceAlt : undefined }}>
              {r.map((v, i) => <T key={i} v={table.columns[i]?.align === 'right' ? 'num' : bold.has(ri) ? 'bodyStrong' : 'body'} align={table.columns[i]?.align} style={{ width: w(i) }} numberOfLines={2}>{cell(v)}</T>)}
            </View>
          ))}
        </View>
      </ScrollView>
    </Card>
  )
}

/** CSV / Print / PDF of a report. */
export function ExportBar({ table }: { table: HrTable }) {
  const { c } = useTheme()
  const store = useStore()
  if (!table.rows.length) return null
  const name = store?.name ?? 'OneSyncERP'
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <View style={{ flex: 1 }}><Button label="CSV" kind="outline" block icon={<Download size={18} color={c.ink} />} onPress={() => void shareFile(csvFileName(table.title), toCsv(tableCsvRows(table)))} /></View>
      <View style={{ flex: 1 }}><Button label="Print" kind="outline" block icon={<Printer size={18} color={c.ink} />} onPress={() => void printHtml(tableHtml(name, table))} /></View>
      <View style={{ flex: 1 }}><Button label="PDF" kind="outline" block icon={<FileText size={18} color={c.ink} />} onPress={() => void sharePdf(tableHtml(name, table), csvFileName(table.title, 'pdf'))} /></View>
    </View>
  )
}

/** The reminder that statutory rates are only defaults. */
export const RATES_NOTE = 'Statutory rates here are starting points. Your accountant should confirm the current PF, ESI, professional tax and TDS rules for your state before you pay salaries. This is not legal or tax advice.'

export const MODE_OPTIONS: Array<{ value: 'cash' | 'bank' | 'upi'; label: string }> = [{ value: 'cash', label: 'Cash' }, { value: 'bank', label: 'Bank' }, { value: 'upi', label: 'UPI' }]
