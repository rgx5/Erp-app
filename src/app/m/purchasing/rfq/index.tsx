import React, { useMemo } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDayShort } from '@/domain/dates'
import { useApp, useCan } from '@/data/store'
import { listOf } from '@/data/state'
import { Button } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { Badge, Card } from '@/ui/primitives'
import { EmptyState, ListRow } from '@/ui/blocks'
import { PackageSearch } from '@/ui/icons'
import { T } from '@/ui/Text'
import { useTheme } from '@/ui/theme'

/** Requests for quotation: ask several suppliers the same question and compare their answers. */
export default function Rfqs() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('purchases')
  const data = useApp((s) => s.data)
  const list = useMemo(() => listOf(data.rfqs).sort((a, b) => b.date - a.date), [data.rfqs])
  if (!can) return <Screen title="Quotations" back><T tone="mute">Quotations are for the owner and managers.</T></Screen>
  return (
    <Screen title="Quotations" subtitle="Requests and comparison" back footer={<Button label="New request" size="lg" block onPress={() => router.push('/m/purchasing/rfq/new')} />}>
      <View style={{ gap: 12, paddingBottom: 16 }}>
        {list.length ? (
          <Card padded={false}>
            {list.map((r) => {
              const got = listOf(data.rfqQuotes).filter((q) => q.rfqId === r.id).length
              return <ListRow key={r.id} title={`${r.no} · ${r.title}`} subtitle={`${fmtDayShort(r.date)} · ${got} of ${r.supplierIds.length} replied`} badge={<Badge tone={r.status === 'awarded' ? 'success' : r.status === 'closed' ? 'default' : 'primary'}>{r.status === 'awarded' ? 'Awarded' : r.status === 'closed' ? 'Closed' : 'Open'}</Badge>}
                onPress={() => router.push({ pathname: '/m/purchasing/rfq/[id]', params: { id: r.id } })} />
            })}
          </Card>
        ) : <EmptyState icon={<PackageSearch size={26} color={c.primary} />} title="No requests yet" hint="Ask a few suppliers for prices on the same items, then pick the best." />}
      </View>
    </Screen>
  )
}
