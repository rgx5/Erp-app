import React, { useMemo } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { csvFileName } from '@/domain/csv'
import { toInputDate } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useApp, useCan } from '@/data/store'
import { shareFile } from '@/features/shareFile'
import { AGE_BUCKETS, agingReport } from '@/modules/credit/logic'
import { agingCsv } from '@/modules/credit/reports'
import { Button } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { Badge, Card } from '@/ui/primitives'
import { EmptyState, KV, ListRow, Section } from '@/ui/blocks'
import { HBars } from '@/ui/charts'
import { T } from '@/ui/Text'
import { ChartColumn, Download } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

/** Receivables ageing: what customers owe, grouped by how late it is. */
export default function Ageing() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('reports')
  const data = useApp((s) => s.data)
  const now = Date.now()
  const rep = useMemo(() => agingReport(data, now), [data, now])

  if (!can) return <Screen title="Receivables ageing" back><T tone="mute">Reports are for the owner and managers.</T></Screen>

  return (
    <Screen title="Receivables ageing" subtitle={`As on ${toInputDate(now)}`} back
      right={rep.rows.length ? <Button label="CSV" kind="soft" size="sm" icon={<Download size={15} color={c.primary} />} onPress={() => void shareFile(csvFileName(`receivables ageing ${toInputDate(now)}`), agingCsv(data, now)).catch(() => toast('Could not export', 'err'))} /> : undefined}>
      {!rep.rows.length ? (
        <EmptyState icon={<ChartColumn size={26} color={c.primary} />} title="Nothing is owed" hint="Sales put on account show up here by how late they are." />
      ) : (
        <View style={{ gap: 4, paddingBottom: 20 }}>
          <Card>
            <KV k="Total owed" v={inr(rep.total, 0)} strong big />
            {AGE_BUCKETS.map((b) => <KV key={b.key} k={b.label} v={inr(rep.totals[b.key], 0)} tone={b.key === 'notDue' ? undefined : rep.totals[b.key] > 0 ? 'danger' : undefined} />)}
          </Card>
          <Section title="By lateness">
            <Card><HBars items={AGE_BUCKETS.map((b) => ({ label: b.label, value: rep.totals[b.key] }))} format={(n) => inr(n, 0)} /></Card>
          </Section>
          <Section title={`By customer · ${rep.rows.length}`}>
            <Card padded={false}>
              {rep.rows.map((r) => {
                const late = r.total - r.buckets.notDue
                return (
                  <ListRow key={r.customerId} avatar={data.customers[r.customerId]?.name ?? 'Customer'} title={data.customers[r.customerId]?.name ?? 'Customer'}
                    subtitle={AGE_BUCKETS.filter((b) => r.buckets[b.key] > 0).map((b) => `${b.label} ${inr(r.buckets[b.key], 0)}`).join(' · ')}
                    value={inr(r.total, 0)} badge={late > 0 ? <Badge tone="danger">{r.oldestDaysOverdue}d</Badge> : undefined}
                    onPress={() => router.push({ pathname: '/m/credit/customer/[id]', params: { id: r.customerId } })} />
                )
              })}
            </Card>
          </Section>
        </View>
      )}
    </Screen>
  )
}
