import React, { useMemo, useState } from 'react'
import { FlatList, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useList } from '@/data/hooks'
import { useApp, useCan } from '@/data/store'
import { fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import { isReversed, voucherDebit, VOUCHER_LABEL } from '@/modules/accounting/logic'
import type { VoucherType } from '@/modules/accounting/types'
import { IconButton } from '@/ui/Button'
import { SearchBar } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Badge, Chip, Tap } from '@/ui/primitives'
import { EmptyState } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { ChevronRight, Plus, ReceiptText } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

/** Receipts, payments, journals and contras entered by hand. */
export default function Vouchers() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('accounting')
  const vouchers = useList('vouchers')
  const data = useApp((s) => s.data)
  const [q, setQ] = useState('')
  const [type, setType] = useState<'' | VoucherType>('')
  const rows = useMemo(() => {
    const n = q.trim().toLowerCase()
    return vouchers.filter((v) => (!type || v.type === type) && (!n || v.no.toLowerCase().includes(n) || v.narration.toLowerCase().includes(n))).sort((a, b) => b.date - a.date || b.createdAt - a.createdAt)
  }, [vouchers, q, type])
  if (!can) return <Screen title="Vouchers" back><T tone="mute">Vouchers are for the owner and managers.</T></Screen>
  return (
    <Screen title="Vouchers" subtitle={`${vouchers.length} entries`} back scroll={false}
      right={<IconButton label="New voucher" tone="dark" onPress={() => router.push('/m/accounting/vouchers/new')}><Plus size={22} color={c.bg} /></IconButton>}>
      <View style={{ gap: 12, paddingBottom: 10 }}>
        <SearchBar value={q} onChange={setQ} placeholder="Search number or narration" />
        <FlatList horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} keyExtractor={(x) => x[0]}
          data={[['', 'All'], ['receipt', 'Receipts'], ['payment', 'Payments'], ['journal', 'Journals'], ['contra', 'Contra'], ['closing', 'Year-end']] as Array<[typeof type, string]>}
          renderItem={({ item }) => <Chip label={item[1]} selected={type === item[0]} onPress={() => setType(item[0])} />} />
      </View>
      <FlatList data={rows} keyExtractor={(v) => v.id} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 28 }}
        ListEmptyComponent={<EmptyState icon={<ReceiptText size={26} color={c.primary} />} title={q || type ? 'No vouchers match' : 'No vouchers yet'} hint="Record money received or paid, a transfer between cash and bank, or a journal entry. Sales, purchases and expenses post themselves." action={!q && !type ? 'New voucher' : undefined} onAction={() => router.push('/m/accounting/vouchers/new')} />}
        renderItem={({ item: v }) => (
          <Tap onPress={() => router.push({ pathname: '/m/accounting/vouchers/[id]', params: { id: v.id } })} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginBottom: 8, borderRadius: 18, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
            <View style={{ flex: 1, gap: 2 }}>
              <T v="bodyStrong" numberOfLines={1}>{v.no} · {VOUCHER_LABEL[v.type]}</T>
              <T v="caption" tone="mute" numberOfLines={1}>{fmtDayShort(v.date)}{v.narration ? ` · ${v.narration}` : ''}</T>
              {isReversed(data, v) ? <View style={{ flexDirection: 'row' }}><Badge tone="warning">Reversed</Badge></View> : v.reversesId ? <View style={{ flexDirection: 'row' }}><Badge>Reversal</Badge></View> : null}
            </View>
            <T v="num">{inr(voucherDebit(v.lines), 2)}</T>
            <ChevronRight size={16} color={c.inkMute} />
          </Tap>
        )} />
    </Screen>
  )
}
