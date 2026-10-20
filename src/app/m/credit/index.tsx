import React, { useMemo, useState } from 'react'
import { FlatList, View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useApp, useCan } from '@/data/store'
import { agingReport, receivables } from '@/modules/credit/logic'
import { outstandingGiftCards } from '@/modules/credit/giftcards'
import { Button } from '@/ui/Button'
import { SearchBar } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Avatar, Badge, Tap } from '@/ui/primitives'
import { EmptyState, StatTile } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Bell, ChartColumn, ChevronRight, Gift, HandCoins, Plus } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

/** Credit & dues: what customers owe, who is late, and the way into each account. */
export default function CreditHome() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('collections')
  const data = useApp((s) => s.data)
  const [q, setQ] = useState('')
  const now = Date.now()

  const { rows, rep, total } = useMemo(() => {
    const rec = receivables(data)
    const rep = agingReport(data, now, rec)
    const late = new Map(rep.rows.map((r) => [r.customerId, r]))
    const rows = Object.values(rec.byCustomer).filter((d) => d.net !== 0).map((d) => {
      const r = late.get(d.customerId)
      return { ...d, name: data.customers[d.customerId]?.name ?? 'Customer', overdue: r ? Math.round((r.total - r.buckets.notDue) * 100) / 100 : 0, days: r?.oldestDaysOverdue ?? 0 }
    }).sort((a, b) => b.net - a.net)
    return { rows, rep, total: rec.total }
  }, [data, now])
  const shown = rows.filter((r) => !q.trim() || r.name.toLowerCase().includes(q.trim().toLowerCase()))
  const overdue = Math.round((rep.total - rep.totals.notDue) * 100) / 100
  const cards = outstandingGiftCards(data, now)

  if (!can) return <Screen title="Credit & dues" back><T tone="mute">Credit and collections are for the owner, managers and cashiers.</T></Screen>

  return (
    <Screen title="Credit & dues" subtitle={rows.length ? `${rows.length} accounts` : undefined} back scroll={false}
      right={<Button label="Collect" size="sm" icon={<Plus size={16} color={c.onPrimary} />} onPress={() => router.push('/m/credit/collect')} />}>
      <FlatList
        data={shown} keyExtractor={(r) => r.customerId} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 28 }}
        ListHeaderComponent={(
          <View style={{ gap: 14, paddingBottom: 12 }}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <StatTile label="Owed to you" value={inr(total, 0)} icon={<HandCoins size={18} color={c.primary} />} style={{ flex: 1 }} />
              <StatTile label="Overdue" value={inr(overdue, 0)} tone={overdue > 0 ? 'danger' : 'success'} icon={<Bell size={18} color={overdue > 0 ? c.danger : c.success} />} style={{ flex: 1 }} onPress={() => router.push('/m/credit/reminders')} />
            </View>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <Button label="Ageing" kind="soft" size="sm" icon={<ChartColumn size={16} color={c.primary} />} onPress={() => router.push('/m/credit/ageing')} />
              <Button label="Reminders" kind="soft" size="sm" icon={<Bell size={16} color={c.primary} />} onPress={() => router.push('/m/credit/reminders')} />
              <Button label={cards.cards ? `Gift cards · ${inr(cards.amount, 0)}` : 'Gift cards'} kind="soft" size="sm" icon={<Gift size={16} color={c.primary} />} onPress={() => router.push('/m/credit/giftcards')} />
            </View>
            {rows.length > 6 ? <SearchBar value={q} onChange={setQ} placeholder="Search customer" /> : null}
          </View>
        )}
        ListEmptyComponent={<EmptyState icon={<HandCoins size={26} color={c.primary} />} title={q ? 'No one matches' : 'No one owes you anything'}
          hint="When a customer buys on account at checkout (choose On account), they appear here with the amount and the date it is due." />}
        renderItem={({ item: r }) => (
          <Tap onPress={() => router.push({ pathname: '/m/credit/customer/[id]', params: { id: r.customerId } })} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginBottom: 8, borderRadius: 18, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
            <Avatar name={r.name} size={42} />
            <View style={{ flex: 1, gap: 2 }}>
              <T v="bodyStrong" numberOfLines={1}>{r.name}</T>
              <T v="caption" tone="mute" numberOfLines={1}>{r.net < 0 ? 'Paid in advance' : r.oldestDue ? `Oldest due ${fmtDayShort(r.oldestDue)}` : ''}</T>
              {r.overdue > 0 ? <View style={{ flexDirection: 'row', marginTop: 2 }}><Badge tone="danger">{r.days} {r.days === 1 ? 'day' : 'days'} late</Badge></View> : null}
            </View>
            <T v="num" tone={r.net < 0 ? 'success' : 'default'}>{inr(Math.abs(r.net), 0)}</T>
            <ChevronRight size={16} color={c.inkMute} />
          </Tap>
        )}
      />
    </Screen>
  )
}
