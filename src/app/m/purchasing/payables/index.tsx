import React, { useMemo } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { inr } from '@/domain/money'
import { useApp, useCan } from '@/data/store'
import { listOf } from '@/data/state'
import { agingReport, dueSummary, payables } from '@/modules/purchasing/payables'
import { Button } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { Badge, Card } from '@/ui/primitives'
import { EmptyState, KV, ListRow, Section, StatTile } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Banknote, Clock, HandCoins } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

/** What the business owes its suppliers, who is owed most, and what to pay next. */
export default function PayablesHome() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('purchases')
  const data = useApp((s) => s.data)
  const now = Date.now()
  const pay = useMemo(() => payables(data), [data])
  const due = useMemo(() => dueSummary(data, now), [data, now])
  const aging = useMemo(() => agingReport(data, now, pay), [data, now, pay])
  const rows = useMemo(() => Object.values(pay.bySupplier).filter((s) => s.net !== 0).sort((a, b) => b.net - a.net), [pay])
  const recent = useMemo(() => listOf(data.supplierPayments).filter((p) => !p.reverses).sort((a, b) => b.date - a.date).slice(0, 5), [data.supplierPayments])

  if (!can) return <Screen title="Payables" back><T tone="mute">Payables are for the owner and managers.</T></Screen>
  const late = aging.total - aging.totals.notDue

  return (
    <Screen title="Payables" subtitle="What you owe suppliers" back footer={<Button label="Pay a supplier" size="lg" block icon={<Banknote size={18} color={c.onPrimary} />} onPress={() => router.push('/m/purchasing/payables/pay')} />}>
      <View style={{ gap: 14, paddingBottom: 16 }}>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <StatTile label="You owe" value={inr(pay.total, 0)} tone="warning" icon={<HandCoins size={16} color={c.warning} />} foot={`${aging.rows.length} ${aging.rows.length === 1 ? 'supplier' : 'suppliers'}`} />
          <StatTile label="Overdue" value={inr(late, 0)} tone={late > 0 ? 'danger' : 'success'} icon={<Clock size={16} color={late > 0 ? c.danger : c.success} />} foot={late > 0 ? `${due.overdue.docs} bills past due` : 'Nothing late'} />
        </View>
        <Card>
          <KV k="Due in the next days" sub="Within your reminder window" v={inr(due.soon.amount, 0)} tone={due.soon.amount > 0 ? 'warning' : undefined} />
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <Button label="What to pay" kind="soft" size="sm" onPress={() => router.push('/m/purchasing/payables/due')} />
            <Button label="Ageing" kind="soft" size="sm" onPress={() => router.push('/m/purchasing/payables/ageing')} />
          </View>
        </Card>

        <Section title={`By supplier · ${rows.length}`}>
          {rows.length ? (
            <Card padded={false}>
              {rows.map((s) => (
                <ListRow key={s.supplierId} avatar={data.suppliers[s.supplierId]?.name ?? 'Supplier'} title={data.suppliers[s.supplierId]?.name ?? 'Supplier'}
                  subtitle={s.net < 0 ? 'Paid in advance' : s.oldestDue && s.oldestDue < now ? 'Has overdue bills' : `${s.docs.filter((d) => d.outstanding > 0).length} open bills`}
                  value={inr(Math.abs(s.net), 0)} valueTone={s.net < 0 ? 'success' : undefined} badge={s.oldestDue && s.oldestDue < now && s.net > 0 ? <Badge tone="danger">Late</Badge> : undefined}
                  onPress={() => router.push({ pathname: '/m/purchasing/payables/supplier/[id]', params: { id: s.supplierId } })} />
              ))}
            </Card>
          ) : <EmptyState icon={<HandCoins size={26} color={c.primary} />} title="You owe nothing" hint="Goods received on credit and supplier invoices show up here until you pay them." />}
        </Section>

        {recent.length ? (
          <Section title="Recent payments">
            <Card padded={false}>
              {recent.map((p) => <ListRow key={p.id} dense title={data.suppliers[p.supplierId]?.name ?? 'Supplier'} subtitle={`${p.no} · ${p.mode}`} value={inr(p.amount, 0)}
                onPress={() => router.push({ pathname: '/m/purchasing/payables/supplier/[id]', params: { id: p.supplierId } })} />)}
            </Card>
          </Section>
        ) : null}
      </View>
    </Screen>
  )
}
