import React, { useMemo } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import { OpError } from '@/data/ops'
import { perform, useApp, useCan } from '@/data/store'
import { landedList } from '@/modules/purchasing/landed'
import { reverseLandedCost } from '@/modules/purchasing/ops-landed'
import { Button } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { Badge, Card } from '@/ui/primitives'
import { EmptyState, ListRow } from '@/ui/blocks'
import { PackagePlus } from '@/ui/icons'
import { T } from '@/ui/Text'
import { ask, toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

/** Freight, duty and handling already spread into item costs. A mistake is cancelled and entered again. */
export default function LandedCosts() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('purchases')
  const data = useApp((s) => s.data)
  const list = useMemo(() => landedList(data), [data])
  if (!can) return <Screen title="Landed cost" back><T tone="mute">Landed cost is for the owner and managers.</T></Screen>

  async function cancel(id: string, no: string) {
    if (!(await ask({ title: `Cancel ${no}?`, message: 'The charges come out of the items’ cost again.', confirm: 'Cancel', danger: true }))) return
    try { perform((s, ctx) => reverseLandedCost(s, id, 'Cancelled', ctx)); toast('Cancelled', 'ok') } catch (e) { toast(e instanceof OpError ? e.message : 'Could not cancel', 'err') }
  }

  return (
    <Screen title="Landed cost" subtitle="What it took to bring the goods in" back footer={<Button label="Add freight / duty" size="lg" block onPress={() => router.push('/m/purchasing/landed/new')} />}>
      <View style={{ gap: 12, paddingBottom: 16 }}>
        {list.length ? (
          <Card padded={false}>
            {list.map((l) => (
              <View key={l.id}>
                <ListRow title={`${l.no} · ${data.purchases[l.purchaseId]?.no ?? 'Receipt'}`} subtitle={`${fmtDayShort(l.date)} · ${data.suppliers[l.supplierId]?.name ?? 'Supplier'}`} value={inr(l.total, 0)} badge={l.reversed ? <Badge tone="danger">Cancelled</Badge> : undefined} />
                {!l.reversed ? <View style={{ paddingHorizontal: 14, paddingBottom: 10, alignItems: 'flex-start' }}><Button label="Cancel" kind="soft" size="sm" onPress={() => void cancel(l.id, l.no)} /></View> : null}
              </View>
            ))}
          </Card>
        ) : <EmptyState icon={<PackagePlus size={26} color={c.primary} />} title="No landed costs" hint="Add freight, duty or handling to a goods receipt so each item's cost shows what it really cost you." />}
      </View>
    </Screen>
  )
}
