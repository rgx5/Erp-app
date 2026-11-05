import React from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useApp, useCan, useUser } from '@/data/store'
import { approvableBy, awaitingApproval, settingsOf } from '@/modules/purchasing/approvals'
import { Notice } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { useTheme } from '@/ui/theme'
import { DataTable, DeskPage, KpiStrip, KpiTile, Pill, Toolbar, cellNum, cellText, type Column } from './kit'

type ApprovalRow = { id: string; no: string; supplierName: string; date: number; total: number; mine: boolean }

/**
 * The desktop approvals screen: a KPI strip for what is waiting and the approval threshold, and one dense grid of
 * every purchase order awaiting a decision — instead of the phone's single stacked list. The waiting orders and
 * who may decide on them come straight from `awaitingApproval`/`approvableBy`, exactly as the phone
 * `m/purchasing/approvals/index.tsx` computes them.
 */
export function DesktopPurchaseApprovals() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('purchases')
  const data = useApp((s) => s.data)
  const user = useUser()

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Approvals" />}>
        <View style={{ padding: 20 }}><T tone="mute">Approvals are for the owner and managers.</T></View>
      </DeskPage>
    )
  }

  const settings = settingsOf(data)
  const waiting = awaitingApproval(data)
  const mine = new Set(approvableBy(data, user?.role).map((o) => o.id))
  const decidable = waiting.filter((o) => mine.has(o.id)).length

  const rows: ApprovalRow[] = waiting.map((o) => ({
    id: o.id, no: o.no, supplierName: data.suppliers[o.supplierId]?.name ?? 'Supplier', date: o.date, total: o.total, mine: mine.has(o.id),
  }))

  const columns: Array<Column<ApprovalRow>> = [
    { key: 'no', label: 'Order', width: 150, sortValue: (r) => r.no, render: (r) => cellText(r.no, true) },
    { key: 'supplier', label: 'Supplier', sortValue: (r) => r.supplierName, render: (r) => cellText(r.supplierName) },
    { key: 'date', label: 'Made', width: 110, sortValue: (r) => r.date, render: (r) => cellText(fmtDayShort(r.date)) },
    { key: 'total', label: 'Total', width: 120, align: 'right', sortValue: (r) => r.total, render: (r) => cellNum(inr(r.total, 0), true) },
    { key: 'decision', label: 'Decision', width: 180, sortValue: (r) => (r.mine ? 0 : 1), render: (r) => (r.mine ? <Pill tone="primary" label="You can decide" /> : <Pill tone="warning" label="Needs a higher role" />) },
  ]

  return (
    <DeskPage toolbar={<Toolbar title="Approvals" subtitle="Purchase orders waiting for a decision" />}>
      {!settings.approvalsOn ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 14 }}>
          <Notice tone="primary" title="Approvals are off" body="Switch them on in Purchasing settings to ask for a yes on big orders." />
        </View>
      ) : (
        <KpiStrip>
          <KpiTile label="Waiting" value={String(waiting.length)} tone={waiting.length ? 'warning' : 'success'} delta={waiting.length ? `${decidable} you can decide` : 'Nothing waiting'} />
          <KpiTile label="Threshold" value={inr(settings.approvalAbove, 0)} tone="primary" delta="Orders above this need a yes" />
        </KpiStrip>
      )}

      <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, marginTop: settings.approvalsOn ? 0 : 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable
          rows={rows}
          columns={columns}
          onRowPress={(r) => router.push({ pathname: '/m/purchasing/orders/[id]', params: { id: r.id } })}
          emptyLabel={settings.approvalsOn ? `Nothing is waiting · orders above ${inr(settings.approvalAbove, 0)} appear here` : 'Nothing is waiting'}
        />
      </View>
    </DeskPage>
  )
}
