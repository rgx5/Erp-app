import React, { useMemo } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { csvFileName } from '@/domain/csv'
import { toInputDate } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useApp, useCan } from '@/data/store'
import { shareFile } from '@/features/shareFile'
import { AGE_BUCKETS, agingReport } from '@/modules/purchasing/payables'
import { agingCsv } from '@/modules/purchasing/reports'
import { HBars } from '@/ui/charts'
import { T } from '@/ui/Text'
import { Download } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'
import { DataTable, DeskButton, DeskPage, dtext, KpiStrip, KpiTile, Pill, Toolbar, cellNum, cellText, type Column } from './kit'

type SupplierRow = { id: string; name: string; breakdown: string; total: number; late: boolean; oldest: number }

/**
 * The desktop payables-ageing report: a KPI strip for the total owed and each ageing bucket, a horizontal-bar
 * chart of the same buckets, and a dense grid of every supplier — instead of the phone's stacked cards. Every
 * figure comes from the same `agingReport` the phone `m/purchasing/payables/ageing.tsx` calls.
 */
export function DesktopPayablesAgeing() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('reports')
  const data = useApp((s) => s.data)
  const now = Date.now()
  const rep = useMemo(() => agingReport(data, now), [data, now])

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Payables ageing" />}>
        <View style={{ padding: 20 }}><T tone="mute">Reports are for the owner and managers.</T></View>
      </DeskPage>
    )
  }

  const rows: SupplierRow[] = rep.rows.map((r) => {
    const name = data.suppliers[r.supplierId]?.name ?? 'Supplier'
    const late = r.total - r.buckets.notDue > 0
    return { id: r.supplierId, name, breakdown: AGE_BUCKETS.filter((b) => r.buckets[b.key] > 0).map((b) => `${b.label} ${inr(r.buckets[b.key], 0)}`).join(' · '), total: r.total, late, oldest: r.oldestDaysOverdue }
  })

  const columns: Array<Column<SupplierRow>> = [
    { key: 'name', label: 'Supplier', sortValue: (r) => r.name, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.name}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.breakdown}</T>
      </View>
    ) },
    { key: 'late', label: '', width: 90, render: (r) => (r.late ? <Pill tone="danger" label={`${r.oldest}d`} /> : null) },
    { key: 'total', label: 'Total', width: 120, align: 'right', sortValue: (r) => r.total, render: (r) => cellNum(inr(r.total, 0), true) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title="Payables ageing"
          subtitle={`As on ${toInputDate(now)}`}
          right={rep.rows.length ? <DeskButton label="CSV" icon={<Download size={14} color={c.ink} />} onPress={() => void shareFile(csvFileName(`payables ageing ${toInputDate(now)}`), agingCsv(data, now)).catch(() => toast('Could not export', 'err'))} /> : undefined}
        />
      }
    >
      <KpiStrip>
        <KpiTile label="Total owed" value={inr(rep.total, 0)} tone="primary" delta={`${rep.rows.length} ${rep.rows.length === 1 ? 'supplier' : 'suppliers'}`} />
        {AGE_BUCKETS.map((b) => <KpiTile key={b.key} label={b.label} value={inr(rep.totals[b.key], 0)} tone={b.key !== 'notDue' && rep.totals[b.key] > 0 ? 'danger' : 'default'} />)}
      </KpiStrip>

      {rep.rows.length ? (
        <View style={{ flex: 1, paddingHorizontal: 14, paddingBottom: 14, gap: 14 }}>
          <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14, maxWidth: 560 }}>
            <T style={[dtext.label, { color: c.inkMute, marginBottom: 8 }]}>By lateness</T>
            <HBars items={AGE_BUCKETS.map((b) => ({ label: b.label, value: rep.totals[b.key] }))} format={(n) => inr(n, 0)} />
          </View>

          <View style={{ flex: 1, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
            <DataTable
              rows={rows}
              columns={columns}
              onRowPress={(r) => router.push({ pathname: '/m/purchasing/payables/supplier/[id]', params: { id: r.id } })}
              emptyLabel="You owe nothing"
            />
          </View>
        </View>
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><T tone="mute">You owe nothing.</T></View>
      )}
    </DeskPage>
  )
}
