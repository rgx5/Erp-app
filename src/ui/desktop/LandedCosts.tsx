import React, { useMemo } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import { OpError } from '@/data/ops'
import { perform, useApp, useCan } from '@/data/store'
import { landedList } from '@/modules/purchasing/landed'
import { reverseLandedCost } from '@/modules/purchasing/ops-landed'
import { T } from '@/ui/Text'
import { Plus } from '@/ui/icons'
import { ask, toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'
import { DataTable, DeskButton, DeskPage, KpiStrip, KpiTile, Pill, Toolbar, cellNum, cellText, type Column } from './kit'

type LandedRow = { id: string; no: string; receiptNo: string; purchaseId: string; supplierName: string; date: number; total: number; reversed: boolean }

/**
 * The desktop landed-cost screen: a KPI strip for what has been added to cost, and a dense grid of every entry —
 * instead of the phone's stacked list with inline cancel buttons. Every row comes from the same `landedList` the
 * phone `m/purchasing/landed/index.tsx` calls.
 */
export function DesktopLandedCosts() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('purchases')
  const data = useApp((s) => s.data)
  const list = useMemo(() => landedList(data), [data])

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Landed cost" />}>
        <View style={{ padding: 20 }}><T tone="mute">Landed cost is for the owner and managers.</T></View>
      </DeskPage>
    )
  }

  async function cancel(id: string, no: string) {
    if (!(await ask({ title: `Cancel ${no}?`, message: 'The charges come out of the items’ cost again.', confirm: 'Cancel', danger: true }))) return
    try { perform((s, ctx) => reverseLandedCost(s, id, 'Cancelled', ctx)); toast('Cancelled', 'ok') } catch (e) { toast(e instanceof OpError ? e.message : 'Could not cancel', 'err') }
  }

  const active = list.filter((l) => !l.reversed)
  const total = active.reduce((s, l) => s + l.total, 0)
  const rows: LandedRow[] = list.map((l) => ({
    id: l.id, no: l.no, receiptNo: data.purchases[l.purchaseId]?.no ?? 'Receipt', purchaseId: l.purchaseId, supplierName: data.suppliers[l.supplierId]?.name ?? 'Supplier', date: l.date, total: l.total, reversed: l.reversed,
  }))

  const columns: Array<Column<LandedRow>> = [
    { key: 'no', label: 'Entry', width: 150, sortValue: (r) => r.no, render: (r) => cellText(r.no, true) },
    { key: 'receipt', label: 'Receipt', width: 140, sortValue: (r) => r.receiptNo, render: (r) => cellText(r.receiptNo) },
    { key: 'supplier', label: 'Supplier', sortValue: (r) => r.supplierName, render: (r) => cellText(r.supplierName) },
    { key: 'date', label: 'Date', width: 110, sortValue: (r) => r.date, render: (r) => cellText(fmtDayShort(r.date)) },
    { key: 'total', label: 'Total', width: 110, align: 'right', sortValue: (r) => r.total, render: (r) => cellNum(inr(r.total, 0), true) },
    { key: 'status', label: '', width: 110, render: (r) => (r.reversed ? <Pill tone="danger" label="Cancelled" /> : <DeskButton label="Cancel" onPress={() => void cancel(r.id, r.no)} />) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar title="Landed cost" subtitle="What it took to bring the goods in"
          right={<DeskButton label="Add freight / duty" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={() => router.push('/m/purchasing/landed/new')} />} />
      }
    >
      <KpiStrip>
        <KpiTile label="Added to cost" value={inr(total, 0)} tone="primary" delta={`${active.length} ${active.length === 1 ? 'entry' : 'entries'}`} />
      </KpiStrip>

      <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, marginTop: 4, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable rows={rows} columns={columns} emptyLabel="No landed costs" />
      </View>
    </DeskPage>
  )
}
