import React, { useMemo } from 'react'
import { ScrollView, View } from 'react-native'
import { useRouter } from 'expo-router'
import { inr } from '@/domain/money'
import { useApp, useCan } from '@/data/store'
import { listOf } from '@/data/state'
import { agingReport, dueSummary, payables } from '@/modules/purchasing/payables'
import { T } from '@/ui/Text'
import { Banknote } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { DataTable, DeskButton, DeskPage, dtext, KpiStrip, KpiTile, Pill, SplitPane, Toolbar, cellNum, cellText, type Column } from './kit'

type SupplierRow = { id: string; name: string; net: number; late: boolean; openCount: number }

/**
 * The desktop payables home: a KPI strip (what you owe, overdue, due soon), a dense grid of every supplier you owe
 * money to, and a side panel of recent payments — instead of the phone's stacked cards. Every figure comes from
 * the same `payables`/`dueSummary`/`agingReport` the phone `m/purchasing/payables/index.tsx` calls.
 */
export function DesktopPayables() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('purchases')
  const data = useApp((s) => s.data)
  const now = Date.now()
  const pay = useMemo(() => payables(data), [data])
  const due = useMemo(() => dueSummary(data, now), [data, now])
  const aging = useMemo(() => agingReport(data, now, pay), [data, now, pay])
  const rows = useMemo(() => Object.values(pay.bySupplier).filter((s) => s.net !== 0).sort((a, b) => b.net - a.net), [pay])
  const recent = useMemo(() => listOf(data.supplierPayments).filter((p) => !p.reverses).sort((a, b) => b.date - a.date).slice(0, 8), [data.supplierPayments])

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Payables" />}>
        <View style={{ padding: 20 }}><T tone="mute">Payables are for the owner and managers.</T></View>
      </DeskPage>
    )
  }

  const late = aging.total - aging.totals.notDue
  const tableRows: SupplierRow[] = rows.map((s) => ({ id: s.supplierId, name: data.suppliers[s.supplierId]?.name ?? 'Supplier', net: s.net, late: !!(s.oldestDue && s.oldestDue < now && s.net > 0), openCount: s.docs.filter((d) => d.outstanding > 0).length }))

  const columns: Array<Column<SupplierRow>> = [
    { key: 'name', label: 'Supplier', sortValue: (r) => r.name, render: (r) => cellText(r.name, true) },
    { key: 'open', label: 'Open bills', width: 110, align: 'right', sortValue: (r) => r.openCount, render: (r) => cellNum(String(r.openCount)) },
    { key: 'status', label: '', width: 100, render: (r) => (r.late ? <Pill tone="danger" label="Late" /> : null) },
    { key: 'net', label: 'Amount', width: 130, align: 'right', sortValue: (r) => Math.abs(r.net), render: (r) => (r.net < 0 ? cellNum(`${inr(-r.net, 0)} adv.`) : cellNum(inr(Math.abs(r.net), 0), true)) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title="Payables"
          subtitle="What you owe suppliers"
          right={
            <>
              <DeskButton label="What to pay" onPress={() => router.push('/m/purchasing/payables/due')} />
              <DeskButton label="Ageing" onPress={() => router.push('/m/purchasing/payables/ageing')} />
              <DeskButton label="Pay a supplier" tone="primary" icon={<Banknote size={14} color={c.onPrimary} />} onPress={() => router.push('/m/purchasing/payables/pay')} />
            </>
          }
        />
      }
    >
      <KpiStrip>
        <KpiTile label="You owe" value={inr(pay.total, 0)} tone="warning" delta={`${aging.rows.length} ${aging.rows.length === 1 ? 'supplier' : 'suppliers'}`} />
        <KpiTile label="Overdue" value={inr(late, 0)} tone={late > 0 ? 'danger' : 'success'} delta={late > 0 ? `${due.overdue.docs} bills past due` : 'Nothing late'} />
        <KpiTile label="Due soon" value={inr(due.soon.amount, 0)} tone={due.soon.amount > 0 ? 'warning' : 'success'} delta="Within your reminder window" onPress={() => router.push('/m/purchasing/payables/due')} />
      </KpiStrip>

      <SplitPane widths={['flex', 320]}>
        <View style={{ flex: 1, margin: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
          <DataTable
            rows={tableRows}
            columns={columns}
            onRowPress={(r) => router.push({ pathname: '/m/purchasing/payables/supplier/[id]', params: { id: r.id } })}
            emptyLabel="You owe nothing"
          />
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 10 }}>
          <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
            <View style={{ padding: 14, paddingBottom: 6 }}><T style={[dtext.label, { color: c.inkMute }]}>Recent payments</T></View>
            {recent.length ? recent.map((p, i) => (
              <View key={p.id} style={{ flexDirection: 'row', gap: 8, padding: 14, paddingTop: i ? 10 : 0, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
                <View style={{ flex: 1 }}>
                  <T style={dtext.cellStrong} numberOfLines={1}>{data.suppliers[p.supplierId]?.name ?? 'Supplier'}</T>
                  <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{p.no} · {p.mode}</T>
                </View>
                <T style={dtext.num}>{inr(p.amount, 0)}</T>
              </View>
            )) : <View style={{ padding: 14 }}><T tone="mute">No payments yet.</T></View>}
          </View>
        </ScrollView>
      </SplitPane>
    </DeskPage>
  )
}
