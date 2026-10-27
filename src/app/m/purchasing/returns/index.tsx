import React, { useMemo } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import { OpError } from '@/data/ops'
import { perform, useApp, useCan } from '@/data/store'
import { reversePurchaseReturn } from '@/modules/purchasing/ops-returns'
import { REASON_LABEL, returnsList } from '@/modules/purchasing/returns'
import { Button } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { Badge, Card } from '@/ui/primitives'
import { EmptyState, ListRow } from '@/ui/blocks'
import { Undo } from '@/ui/icons'
import { T } from '@/ui/Text'
import { ask, toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

/** Debit notes: goods sent back to suppliers and the credit they gave. A mistake is cancelled, never edited. */
export default function Returns() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('purchases')
  const data = useApp((s) => s.data)
  const list = useMemo(() => returnsList(data), [data])
  if (!can) return <Screen title="Purchase returns" back><T tone="mute">Purchase returns are for the owner and managers.</T></Screen>

  async function cancel(id: string, no: string) {
    if (!(await ask({ title: `Cancel ${no}?`, message: 'The goods come back into stock and the amount is owed to the supplier again.', confirm: 'Cancel debit note', danger: true }))) return
    try { perform((s, ctx) => reversePurchaseReturn(s, id, 'Cancelled', ctx)); toast('Debit note cancelled', 'ok') } catch (e) { toast(e instanceof OpError ? e.message : 'Could not cancel', 'err') }
  }

  return (
    <Screen title="Purchase returns" subtitle="Debit notes" back footer={<Button label="Return goods" size="lg" block onPress={() => router.push('/m/purchasing/returns/new')} />}>
      <View style={{ gap: 12, paddingBottom: 16 }}>
        {list.length ? (
          <Card padded={false}>
            {list.map((r) => (
              <View key={r.id}>
                <ListRow title={`${r.no} · ${data.suppliers[r.supplierId]?.name ?? 'Supplier'}`} subtitle={`${fmtDayShort(r.date)} · ${REASON_LABEL[r.reason]} · ${r.items.length} ${r.items.length === 1 ? 'item' : 'items'}`}
                  value={inr(r.total, 0)} badge={r.reversed ? <Badge tone="danger">Cancelled</Badge> : undefined} />
                {!r.reversed ? <View style={{ paddingHorizontal: 14, paddingBottom: 10, alignItems: 'flex-start' }}><Button label="Cancel" kind="soft" size="sm" onPress={() => void cancel(r.id, r.no)} /></View> : null}
              </View>
            ))}
          </Card>
        ) : <EmptyState icon={<Undo size={26} color={c.primary} />} title="No goods sent back" hint="When you return damaged or wrong goods, a debit note cuts what you owe the supplier." />}
      </View>
    </Screen>
  )
}
