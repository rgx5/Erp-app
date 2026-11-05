import React, { useMemo } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import { OpError } from '@/data/ops'
import { perform, useApp, useCan } from '@/data/store'
import { reversePurchaseReturn } from '@/modules/purchasing/ops-returns'
import { REASON_LABEL, returnsList } from '@/modules/purchasing/returns'
import { T } from '@/ui/Text'
import { Plus } from '@/ui/icons'
import { ask, toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'
import { DataTable, DeskButton, DeskPage, KpiStrip, KpiTile, Pill, Toolbar, cellNum, cellText, type Column } from './kit'

type ReturnRow = { id: string; no: string; supplierName: string; date: number; reason: string; items: number; total: number; reversed: boolean }

/**
 * The desktop purchase-returns screen: a KPI strip for debit notes raised, and a dense grid of every return —
 * instead of the phone's stacked list with inline cancel buttons. Every row comes from the same `returnsList` the
 * phone `m/purchasing/returns/index.tsx` calls.
 */
export function DesktopPurchaseReturns() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('purchases')
  const data = useApp((s) => s.data)
  const list = useMemo(() => returnsList(data), [data])

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Purchase returns" />}>
        <View style={{ padding: 20 }}><T tone="mute">Purchase returns are for the owner and managers.</T></View>
      </DeskPage>
    )
  }

  async function cancel(id: string, no: string) {
    if (!(await ask({ title: `Cancel ${no}?`, message: 'The goods come back into stock and the amount is owed to the supplier again.', confirm: 'Cancel debit note', danger: true }))) return
    try { perform((s, ctx) => reversePurchaseReturn(s, id, 'Cancelled', ctx)); toast('Debit note cancelled', 'ok') } catch (e) { toast(e instanceof OpError ? e.message : 'Could not cancel', 'err') }
  }

  const active = list.filter((r) => !r.reversed)
  const total = active.reduce((s, r) => s + r.total, 0)
  const rows: ReturnRow[] = list.map((r) => ({
    id: r.id, no: r.no, supplierName: data.suppliers[r.supplierId]?.name ?? 'Supplier', date: r.date, reason: REASON_LABEL[r.reason], items: r.items.length, total: r.total, reversed: r.reversed,
  }))

  const columns: Array<Column<ReturnRow>> = [
    { key: 'no', label: 'Debit note', width: 150, sortValue: (r) => r.no, render: (r) => cellText(r.no, true) },
    { key: 'supplier', label: 'Supplier', sortValue: (r) => r.supplierName, render: (r) => cellText(r.supplierName) },
    { key: 'date', label: 'Date', width: 110, sortValue: (r) => r.date, render: (r) => cellText(fmtDayShort(r.date)) },
    { key: 'reason', label: 'Reason', width: 120, sortValue: (r) => r.reason, render: (r) => cellText(r.reason) },
    { key: 'items', label: 'Items', width: 70, align: 'right', sortValue: (r) => r.items, render: (r) => cellNum(String(r.items)) },
    { key: 'total', label: 'Total', width: 110, align: 'right', sortValue: (r) => r.total, render: (r) => cellNum(inr(r.total, 0), true) },
    { key: 'status', label: '', width: 110, render: (r) => (r.reversed ? <Pill tone="danger" label="Cancelled" /> : <DeskButton label="Cancel" onPress={() => void cancel(r.id, r.no)} />) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar title="Purchase returns" subtitle="Debit notes"
          right={<DeskButton label="Return goods" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={() => router.push('/m/purchasing/returns/new')} />} />
      }
    >
      <KpiStrip>
        <KpiTile label="Debit notes" value={inr(total, 0)} tone="primary" delta={`${active.length} ${active.length === 1 ? 'note' : 'notes'}`} />
      </KpiStrip>

      <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, marginTop: 4, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable rows={rows} columns={columns} emptyLabel="No goods sent back" />
      </View>
    </DeskPage>
  )
}
