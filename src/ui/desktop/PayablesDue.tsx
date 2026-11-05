import React, { useMemo } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { csvFileName } from '@/domain/csv'
import { fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useApp, useCan } from '@/data/store'
import { shareFile } from '@/features/shareFile'
import { dueList, type DueItem, type DueWhen } from '@/modules/purchasing/payables'
import { dueCsv } from '@/modules/purchasing/reports'
import { settingsOf } from '@/modules/purchasing/approvals'
import { T } from '@/ui/Text'
import { Download } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'
import { DataTable, DeskButton, DeskPage, KpiStrip, KpiTile, Pill, Toolbar, cellNum, cellText, type Column } from './kit'

const TITLE: Record<DueWhen, string> = { overdue: 'Overdue', soon: 'Due soon', later: 'Coming up' }
const TONE = { overdue: 'danger', soon: 'warning', later: 'default' } as const

type Row = DueItem & { id: string }

/**
 * The desktop "what to pay" screen: a KPI strip split by overdue / due soon / coming up, and one dense grid of
 * every bill to pay, soonest first — instead of the phone's three stacked sections. Every row comes from the same
 * `dueList` the phone `m/purchasing/payables/due.tsx` calls.
 */
export function DesktopPayablesDue() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('purchases')
  const data = useApp((s) => s.data)
  const now = Date.now()
  const items = useMemo(() => dueList(data, now), [data, now])
  const days = settingsOf(data).remindDays

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="What to pay" />}>
        <View style={{ padding: 20 }}><T tone="mute">Payables are for the owner and managers.</T></View>
      </DeskPage>
    )
  }

  const byWhen = (w: DueWhen) => items.filter((i) => i.when === w)
  const sum = (rows: DueItem[]) => rows.reduce((s, r) => s + r.owed, 0)
  const sorted: Row[] = items.map((i) => ({ ...i, id: i.ref })).sort((a, b) => (a.when === b.when ? a.dueDate - b.dueDate : a.when === 'overdue' ? -1 : b.when === 'overdue' ? 1 : a.when === 'soon' ? -1 : 1))

  const columns: Array<Column<Row>> = [
    { key: 'supplier', label: 'Supplier', sortValue: (r) => data.suppliers[r.supplierId]?.name ?? '', render: (r) => cellText(data.suppliers[r.supplierId]?.name ?? 'Supplier', true) },
    { key: 'no', label: 'Bill', width: 160, sortValue: (r) => r.no, render: (r) => cellText(r.no) },
    { key: 'due', label: 'Due', width: 110, sortValue: (r) => r.dueDate, render: (r) => cellText(fmtDayShort(r.dueDate)) },
    { key: 'owed', label: 'Owed', width: 110, align: 'right', sortValue: (r) => r.owed, render: (r) => cellNum(inr(r.owed, 0), true) },
    { key: 'when', label: 'When', width: 130, sortValue: (r) => r.when, render: (r) => <Pill tone={TONE[r.when]} label={r.when === 'overdue' ? `${r.days}d late` : TITLE[r.when]} /> },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title="What to pay"
          subtitle={`Warning ${days} days ahead`}
          right={items.length ? <DeskButton label="CSV" icon={<Download size={14} color={c.ink} />} onPress={() => void shareFile(csvFileName('payments due'), dueCsv(data, now)).catch(() => toast('Could not export', 'err'))} /> : undefined}
        />
      }
    >
      <KpiStrip>
        <KpiTile label="Overdue" value={inr(sum(byWhen('overdue')), 0)} tone="danger" delta={`${byWhen('overdue').length} bills`} />
        <KpiTile label="Due soon" value={inr(sum(byWhen('soon')), 0)} tone="warning" delta={`${byWhen('soon').length} bills`} />
        <KpiTile label="Coming up" value={inr(sum(byWhen('later')), 0)} tone="default" delta={`${byWhen('later').length} bills`} />
      </KpiStrip>

      <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable
          rows={sorted}
          columns={columns}
          onRowPress={(r) => router.push({ pathname: '/m/purchasing/payables/pay', params: { supplierId: r.supplierId, amount: String(r.owed) } })}
          emptyLabel="Nothing to pay"
        />
      </View>
    </DeskPage>
  )
}
