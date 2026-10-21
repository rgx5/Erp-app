import React, { useMemo, useState } from 'react'
import { FlatList, View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useCan } from '@/data/store'
import { advanceStandings } from '@/modules/hr/logic/advances'
import { Denied, useHr } from '@/modules/hr/ui/common'
import { Button } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { Badge, Chip, Tap } from '@/ui/primitives'
import { EmptyState, StatTile } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { ChevronRight, HandCoins, Plus } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

/** Advances and loans given to staff, and how much is still to come back. */
export default function Advances() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('payroll')
  const { data } = useHr()
  const [open, setOpen] = useState(true)
  const list = useMemo(() => advanceStandings(data), [data])
  const shown = list.filter((s) => (open ? s.balance > 0 : s.balance === 0))
  const owed = list.reduce((t, s) => t + s.balance, 0)

  if (!can) return <Denied title="Advances & loans" who="Advances are for the owner and managers with payroll access." />
  return (
    <Screen title="Advances & loans" back scroll={false} right={<Button label="Give" size="sm" icon={<Plus size={16} color={c.onPrimary} />} onPress={() => router.push('/m/hr/advances/new')} />}>
      <FlatList
        data={shown} keyExtractor={(s) => s.advance.id} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 28 }}
        ListHeaderComponent={(
          <View style={{ gap: 12, paddingBottom: 12 }}>
            <View style={{ flexDirection: 'row' }}><StatTile label="Staff owe the business" value={inr(owed, 0)} icon={<HandCoins size={18} color={c.warning} />} tone="warning" foot="Taken back from salary each month" /></View>
            <View style={{ flexDirection: 'row', gap: 8 }}><Chip label="Open" selected={open} onPress={() => setOpen(true)} /><Chip label="Settled" selected={!open} onPress={() => setOpen(false)} /></View>
          </View>
        )}
        ListEmptyComponent={<EmptyState icon={<HandCoins size={26} color={c.primary} />} title={open ? 'No open advances' : 'Nothing settled yet'} hint="Give an advance or a loan, choose how many months to recover it over, and payroll takes the instalment from each salary." action={open ? 'Give an advance' : undefined} onAction={() => router.push('/m/hr/advances/new')} />}
        renderItem={({ item: s }) => (
          <Tap onPress={() => router.push({ pathname: '/m/hr/advances/[id]', params: { id: s.advance.id } } as never)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginBottom: 8, borderRadius: 18, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
            <View style={{ flex: 1, gap: 2 }}>
              <T v="bodyStrong" numberOfLines={1}>{data.employees?.[s.advance.employeeId]?.name ?? 'Former staff'}</T>
              <T v="caption" tone="mute">{s.advance.no} · {fmtDayShort(s.advance.date)} · {inr(s.advance.amount, 0)}{s.advance.installments > 1 ? ` in ${s.advance.installments} months` : ''}</T>
              {s.advance.kind === 'loan' ? <View style={{ flexDirection: 'row' }}><Badge tone="accent">Loan</Badge></View> : null}
            </View>
            <T v="num" tone={s.balance ? 'warning' : 'success'}>{inr(s.balance, 0)}</T>
            <ChevronRight size={16} color={c.inkMute} />
          </Tap>
        )}
      />
    </Screen>
  )
}
