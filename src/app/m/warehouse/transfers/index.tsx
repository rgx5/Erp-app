import React, { useMemo, useState } from 'react'
import { FlatList, View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDayShort } from '@/domain/dates'
import { useList } from '@/data/hooks'
import { useCan } from '@/data/store'
import { linesTotalQty, locationName, STATUS_LABEL, transferIsOpen, transferProgress, type TransferStatus } from '@/modules/warehouse/logic'
import { useData } from '@/modules/warehouse/ui/common'
import { IconButton } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { Badge, Chip, Tap } from '@/ui/primitives'
import { EmptyState } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { ArrowLeftRight, ChevronRight, Plus } from '@/ui/icons'
import { useTheme, type Tone } from '@/ui/theme'

const TONE: Record<TransferStatus, Tone> = { in_transit: 'accent', partial: 'warning', received: 'success', closed_short: 'danger' }

/** Transfers: stock sent between places and whether it has arrived. */
export default function Transfers() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('warehouse')
  const data = useData()
  const transfers = useList('transfers')
  const receipts = useList('transferReceipts')
  const [open, setOpen] = useState(true)
  const rows = useMemo(
    () => transfers.map((t) => ({ t, p: transferProgress(t, receipts) })).filter((x) => !open || transferIsOpen(x.p)).sort((a, b) => b.t.date - a.t.date),
    [transfers, receipts, open],
  )
  if (!can) return <Screen title="Transfers" back><T tone="mute">Transfers are for the owner and managers.</T></Screen>
  return (
    <Screen title="Stock transfers" subtitle={`${transfers.length} sent`} back scroll={false}
      right={<IconButton label="New transfer" tone="dark" onPress={() => router.push('/m/warehouse/transfers/new')}><Plus size={22} color={c.bg} /></IconButton>}>
      <View style={{ flexDirection: 'row', gap: 8, paddingBottom: 10 }}>
        <Chip label="On the way" selected={open} onPress={() => setOpen(true)} />
        <Chip label="All" selected={!open} onPress={() => setOpen(false)} />
      </View>
      <FlatList data={rows} keyExtractor={(x) => x.t.id} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 28 }}
        ListEmptyComponent={<EmptyState icon={<ArrowLeftRight size={26} color={c.primary} />} title={open ? 'Nothing on the way' : 'No transfers yet'} hint="Send stock from one place to another; it counts as in transit until it is received." action="New transfer" onAction={() => router.push('/m/warehouse/transfers/new')} />}
        renderItem={({ item: { t, p } }) => (
          <Tap onPress={() => router.push({ pathname: '/m/warehouse/transfers/[id]', params: { id: t.id } })} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginBottom: 8, borderRadius: 18, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
            <View style={{ flex: 1, gap: 2 }}>
              <T v="bodyStrong" numberOfLines={1}>{locationName(data, t.fromId)} → {locationName(data, t.toId)}</T>
              <T v="caption" tone="mute">{t.no} · {fmtDayShort(t.date)} · {linesTotalQty(t.lines)} units</T>
              <View style={{ flexDirection: 'row', marginTop: 2 }}><Badge tone={TONE[p.status]}>{STATUS_LABEL[p.status]}</Badge></View>
            </View>
            <ChevronRight size={16} color={c.inkMute} />
          </Tap>
        )} />
    </Screen>
  )
}
