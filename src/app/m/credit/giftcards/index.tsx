import React, { useMemo, useState } from 'react'
import { FlatList, View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useApp, useCan } from '@/data/store'
import { giftCardBalance, outstandingGiftCards } from '@/modules/credit/giftcards'
import { Button } from '@/ui/Button'
import { SearchBar } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Badge, Tap } from '@/ui/primitives'
import { EmptyState, StatTile } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { ChevronRight, Gift, Plus, Wallet } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

/** Gift cards and vouchers: sell one, see what is left on each and what the shop still owes card holders. */
export default function GiftCards() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('collections')
  const data = useApp((s) => s.data)
  const [q, setQ] = useState('')
  const now = Date.now()
  const out = useMemo(() => outstandingGiftCards(data, now), [data, now])
  const rows = useMemo(() => Object.values(data.giftCards ?? {}).map((g) => ({ g, balance: giftCardBalance(data, g.id) })).sort((a, b) => b.g.issuedAt - a.g.issuedAt), [data])
  const shown = rows.filter(({ g }) => !q.trim() || g.code.includes(q.trim().toUpperCase().replace(/\s+/g, '')) || (data.customers[g.customerId ?? '']?.name ?? '').toLowerCase().includes(q.trim().toLowerCase()))

  if (!can) return <Screen title="Gift cards" back><T tone="mute">Gift cards are for the owner, managers and cashiers.</T></Screen>

  return (
    <Screen title="Gift cards" subtitle={rows.length ? `${rows.length} cards` : undefined} back scroll={false}
      right={<Button label="Sell card" size="sm" icon={<Plus size={16} color={c.onPrimary} />} onPress={() => router.push('/m/credit/giftcards/new')} />}>
      <FlatList
        data={shown} keyExtractor={(r) => r.g.id} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 28 }}
        ListHeaderComponent={(
          <View style={{ gap: 12, paddingBottom: 12 }}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <StatTile label="Owed on cards" value={inr(out.amount, 0)} foot={`${out.cards} active ${out.cards === 1 ? 'card' : 'cards'}`} icon={<Gift size={18} color={c.primary} />} tone="accent" />
            </View>
            <Button label="Store-credit top-up" kind="soft" icon={<Wallet size={16} color={c.primary} />} onPress={() => router.push('/m/credit/topup')} />
            {rows.length > 6 ? <SearchBar value={q} onChange={setQ} placeholder="Search code or customer" /> : null}
          </View>
        )}
        ListEmptyComponent={<EmptyState icon={<Gift size={26} color={c.primary} />} title="No gift cards yet" hint="Sell a card for any amount. The customer spends it at checkout by choosing Gift card and typing the code." action="Sell a gift card" onAction={() => router.push('/m/credit/giftcards/new')} />}
        renderItem={({ item: { g, balance } }) => (
          <Tap onPress={() => router.push({ pathname: '/m/credit/giftcards/[id]', params: { id: g.id } })} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginBottom: 8, borderRadius: 18, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
            <View style={{ flex: 1, gap: 2 }}>
              <T v="bodyStrong">{g.code}</T>
              <T v="caption" tone="mute" numberOfLines={1}>{data.customers[g.customerId ?? '']?.name ?? 'Sold ' + fmtDayShort(g.issuedAt)}{g.expiresAt ? ` · till ${fmtDayShort(g.expiresAt)}` : ''}</T>
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 2 }}>
                {!g.active ? <Badge tone="danger">Cancelled</Badge> : g.expiresAt && g.expiresAt < now ? <Badge tone="warning">Expired</Badge> : balance <= 0 ? <Badge>Used up</Badge> : <Badge tone="success">Active</Badge>}
              </View>
            </View>
            <T v="num">{inr(balance, 0)}</T>
            <ChevronRight size={16} color={c.inkMute} />
          </Tap>
        )}
      />
    </Screen>
  )
}
