import React from 'react'
import { View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { fmtDateTime } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useCan } from '@/data/store'
import { locationName, REASON_LABEL, variantName } from '@/modules/warehouse/logic'
import { useData } from '@/modules/warehouse/ui/common'
import { Screen } from '@/ui/Screen'
import { Card, Group } from '@/ui/primitives'
import { KV, ListRow } from '@/ui/blocks'
import { T } from '@/ui/Text'

/** A posted write-off: it is final; a mistake is corrected by receiving the stock back. */
export default function WriteOffPage() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const can = useCan('warehouse')
  const data = useData()
  const w = data.writeOffs[id]
  if (!can) return <Screen title="Write-off" back><T tone="mute">Write-offs are for the owner and managers.</T></Screen>
  if (!w) return <Screen title="Not found" back><T tone="mute">This write-off is no longer here.</T></Screen>
  return (
    <Screen title={w.no} subtitle={`${REASON_LABEL[w.reason]} · ${fmtDateTime(w.date)}`} back>
      <View style={{ gap: 14, paddingBottom: 20 }}>
        <Card><KV k="Value lost at cost" v={inr(w.total)} strong tone="danger" /></Card>
        <Group>
          {w.lines.map((l, i) => (
            <ListRow key={i} title={variantName(data, l.variantId)} subtitle={[l.batchId ? `Batch ${data.batches[l.batchId]?.batchNo ?? ''}` : '', l.serial ? `S/N ${l.serial}` : '', l.locationId ? locationName(data, l.locationId) : ''].filter(Boolean).join(' · ') || undefined}
              value={`${l.qty} × ${inr(l.cost)}`} sub={inr(l.qty * l.cost)} />
          ))}
        </Group>
        {w.notes ? <T v="caption" tone="mute">{w.notes}</T> : null}
      </View>
    </Screen>
  )
}
