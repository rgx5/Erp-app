import React from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDayShort } from '@/domain/dates'
import { useList } from '@/data/hooks'
import { useApp, useCan } from '@/data/store'
import { itemName } from '@/modules/manufacturing/bom'
import { checksOf, entriesOf, isOpen, qualityPosition } from '@/modules/manufacturing/production'
import { Screen } from '@/ui/Screen'
import { Card, Tap } from '@/ui/primitives'
import { EmptyState, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { ClipboardCheck } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

/** Quality: orders waiting for inspection or rework, and the latest inspections. Inspecting happens on the work order. */
export default function Quality() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('inventory')
  const orders = useList('workOrders')
  const checks = useList('qualityChecks')
  const data = useApp((s) => s.data)
  if (!can) return <Screen title="Quality checks" back><T tone="mute">Quality checks are for the owner, managers and stock keepers.</T></Screen>

  const waiting = orders.filter((o) => isOpen(o) && o.checklist.length).map((o) => ({ o, pos: qualityPosition(checksOf(data, o.id), entriesOf(data, o.id)) }))
  const recent = [...checks].sort((a, b) => b.date - a.date).slice(0, 30)
  const go = (id: string) => router.push({ pathname: '/m/manufacturing/orders/[id]', params: { id } } as never)
  return (
    <Screen title="Quality checks" back>
      <View style={{ gap: 14, paddingBottom: 28 }}>
        <Section title="To inspect">
          {waiting.length ? waiting.map(({ o, pos }) => (
            <Tap key={o.id} onPress={() => go(o.id)}>
              <Card><T v="bodyStrong">{o.no} · {itemName(data, o.outputVariantId)} × {o.qty}</T>
                <T v="caption" tone="mute">{pos.passed} passed{pos.rework ? ` · ${pos.rework} to re-check after rework` : ''}{pos.pendingScrap ? ` · ${pos.pendingScrap} to scrap` : ''}</T></Card>
            </Tap>
          )) : <EmptyState compact icon={<ClipboardCheck size={24} color={c.primary} />} title="Nothing to inspect" hint="Orders whose recipe has a checklist show here while they are open." />}
        </Section>
        {recent.length ? (
          <Section title="Recent inspections">
            {recent.map((q) => (
              <Tap key={q.id} onPress={() => go(q.workOrderId)}>
                <Card><T v="bodyStrong">{q.no} · {data.workOrders[q.workOrderId]?.no ?? ''}</T>
                  <T v="caption" tone={q.qtyRejected ? 'danger' : 'mute'}>{fmtDayShort(q.date)} · {q.qtyPassed} of {q.qtyChecked} passed{q.qtyRejected ? ` · ${q.qtyRejected} ${q.rejectAction === 'rework' ? 'to rework' : 'scrapped'}` : ''}</T></Card>
              </Tap>
            ))}
          </Section>
        ) : null}
      </View>
    </Screen>
  )
}
