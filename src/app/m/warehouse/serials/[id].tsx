import React from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { fmtDate, fmtDateTime } from '@/domain/dates'
import { OpError } from '@/data/ops'
import { perform, useCan } from '@/data/store'
import { serialView } from '@/modules/warehouse/logic'
import { setSerialStatus } from '@/modules/warehouse/ops'
import { useData } from '@/modules/warehouse/ui/common'
import { Button } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { Badge, Card } from '@/ui/primitives'
import { KV, Notice, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { ask, toast } from '@/ui/overlays'

/** One unit: where it came from, who bought it, how long its warranty runs, and its history. */
export default function SerialPage() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const can = useCan('pos')
  const canEdit = useCan('warehouse')
  const data = useData()
  const s = data.serials[id]
  if (!can) return <Screen title="Serial number" back><T tone="mute">Serial numbers are for people at the counter.</T></Screen>
  if (!s) return <Screen title="Not found" back><T tone="mute">This serial number is no longer here.</T></Screen>
  const v = serialView(data, s, Date.now())

  async function takeBack() {
    if (!(await ask({ title: `Take ${s!.serial} back?`, message: 'Use this when the customer returned this unit. The item’s stock comes back through the return on the bill; this puts the unit back on the shelf.', confirm: 'Back on the shelf' }))) return
    try { perform((st, ctx) => setSerialStatus(st, s!.id, 'in_stock', 'TAKEN BACK', ctx)); toast('Back in stock', 'ok') } catch (e) { toast(e instanceof OpError ? e.message : 'Could not save', 'err') }
  }

  return (
    <Screen title={s.serial} subtitle={v.name} back>
      <View style={{ gap: 14, paddingBottom: 20 }}>
        {v.warranty.kind === 'active' ? <Notice tone="success" title={`In warranty — ${v.warranty.days} days left`} body={`Until ${fmtDate(s.warrantyUntil!)}`} /> : null}
        {v.warranty.kind === 'expired' ? <Notice tone="warning" title="Warranty has ended" body={`Ended ${fmtDate(s.warrantyUntil!)} (${v.warranty.days} days ago)`} /> : null}
        <Card>
          <KV k="Status" v={s.status.replace('_', ' ')} />
          {s.receivedAt ? <KV k="Received" v={fmtDate(s.receivedAt)} sub={v.supplier} /> : null}
          {s.billNo ? <KV k="Sold on" v={s.billNo} sub={s.soldAt ? fmtDate(s.soldAt) : undefined} /> : null}
          {v.customer ? <KV k="Customer" v={v.customer} /> : null}
          {s.warrantyMonths ? <KV k="Warranty" v={`${s.warrantyMonths} months`} /> : null}
        </Card>
        {s.billId && data.bills[s.billId] ? <Button label={`Open bill ${s.billNo}`} kind="soft" block onPress={() => router.push({ pathname: '/bills/[id]', params: { id: s.billId! } })} /> : null}
        {canEdit && s.status === 'sold' ? <Button label="Customer returned this unit" kind="soft" block onPress={takeBack} /> : null}
        <Section title="History">
          <Card>{[...s.history].reverse().map((h, i) => <View key={i} style={{ flexDirection: 'row', gap: 8, paddingVertical: 4 }}><Badge>{h.status.replace('_', ' ')}</Badge><T v="caption" tone="mute" style={{ flex: 1 }}>{h.ref} · {fmtDateTime(h.at)}</T></View>)}</Card>
        </Section>
      </View>
    </Screen>
  )
}
