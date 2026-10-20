import React, { useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { fmtDateTime } from '@/domain/dates'
import { fmtQty } from '@/domain/qty'
import { useList, useStore } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { perform, useCan } from '@/data/store'
import { printHtml, sharePdf, whatsApp } from '@/features/share'
import { challanHtml, challanText } from '@/modules/sales-docs/html'
import { CHALLAN_LABEL, CHALLAN_STEPS, nextChallanStatus } from '@/modules/sales-docs/logic/challans'
import { advanceChallan, deleteChallan } from '@/modules/sales-docs/ops'
import { CHALLAN_TONE } from '@/modules/sales-docs/ui/tones'
import { Button } from '@/ui/Button'
import { Field } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Badge, Card } from '@/ui/primitives'
import { KV, Notice, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { CheckCircle, Pencil, Printer, Send, Share, Trash, Truck } from '@/ui/icons'
import { ask, toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

/** One delivery challan: the steps it has been through, the transport details, and the next step. */
export default function ChallanPage() {
  const { c } = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const can = useCan('pos')
  const store = useStore()
  const ch = useList('challans').find((x) => x.id === id)
  const orders = useList('salesOrders')
  const bills = useList('bills')
  const [sheet, setSheet] = useState(false)
  const [vehicle, setVehicle] = useState('')
  const [driver, setDriver] = useState('')
  const [tracking, setTracking] = useState('')
  const [proof, setProof] = useState('')

  if (!can) return <Screen title="Challan" back><T tone="mute">Challans are for people who use the billing counter.</T></Screen>
  if (!ch) return <Screen title="Not found" back><T tone="mute">This challan is no longer here.</T></Screen>
  const next = nextChallanStatus(ch.status)
  const order = ch.orderId ? orders.find((o) => o.id === ch.orderId) : undefined
  const bill = ch.billId ? bills.find((b) => b.id === ch.billId) : undefined

  function openStep() { setVehicle(ch!.vehicle); setDriver(ch!.driver); setTracking(ch!.trackingNo); setProof(''); setSheet(true) }
  function step() {
    if (!next) return
    try {
      perform((s, ctx) => advanceChallan(s, ch!.id, next, next === 'dispatched' ? { vehicle, driver, trackingNo: tracking } : { proof }, ctx))
      setSheet(false); toast(next === 'dispatched' ? 'Marked as on the way' : 'Marked as delivered', 'ok')
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not update the challan', 'err') }
  }
  async function remove() {
    if (!(await ask({ title: `Delete ${ch!.no}?`, confirm: 'Delete', danger: true }))) return
    try { perform((s, ctx) => deleteChallan(s, ch!.id, ctx)); router.back() } catch (e) { toast(e instanceof OpError ? e.message : 'Could not delete', 'err') }
  }

  return (
    <Screen title={ch.no} subtitle={ch.partyName} back
      footer={next ? <Button label={next === 'dispatched' ? 'Send it out' : 'Mark delivered'} size="lg" block icon={next === 'dispatched' ? <Truck size={18} color={c.onPrimary} /> : <CheckCircle size={18} color={c.onPrimary} />} onPress={openStep} /> : undefined}>
      <View style={{ gap: 14, paddingBottom: 14 }}>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><Badge tone={CHALLAN_TONE[ch.status]}>{CHALLAN_LABEL[ch.status]}</Badge></View>
        {bill ? <Notice tone="success" title={`Billed on ${bill.no}`} action="Open" onAction={() => router.push({ pathname: '/bills/[id]', params: { id: bill.id } })} /> : null}

        <Card>
          {CHALLAN_STEPS.map((st, i) => {
            const done = CHALLAN_STEPS.indexOf(ch.status) >= i
            const at = st === 'packed' ? ch.date : st === 'dispatched' ? ch.dispatchedAt : ch.deliveredAt
            return (
              <View key={st} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}>
                <CheckCircle size={20} color={done ? c.success : c.lineStrong} />
                <T v="bodyStrong" tone={done ? 'default' : 'mute'} style={{ flex: 1 }}>{CHALLAN_LABEL[st]}</T>
                {at ? <T v="caption" tone="mute">{fmtDateTime(at)}</T> : null}
              </View>
            )
          })}
        </Card>

        <Card>
          <KV k="To" v={ch.partyName} />
          {ch.partyPhone ? <KV k="Phone" v={ch.partyPhone} /> : null}
          {ch.address ? <KV k="Address" v={ch.address} /> : null}
          {order ? <KV k="Order" v={order.no} /> : null}
          {ch.vehicle ? <KV k="Vehicle" v={ch.vehicle} /> : null}
          {ch.driver ? <KV k="Driver" v={ch.driver} /> : null}
          {ch.trackingNo ? <KV k="Tracking" v={ch.trackingNo} /> : null}
          {ch.proof ? <KV k="Received by" v={ch.proof} /> : null}
        </Card>

        <Section title="Items" style={{ marginTop: 6 }}>
          <Card padded={false}>
            {ch.items.map((l, i) => (
              <View key={`${l.variantId}${i}`} style={{ padding: 14, flexDirection: 'row', gap: 8, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
                <View style={{ flex: 1 }}>
                  <T v="bodyStrong" numberOfLines={1}>{l.name}</T>
                  <T v="caption" tone="mute">{l.sku}</T>
                </View>
                <T v="num">{fmtQty(l.qty)}{l.unit && l.unit !== 'pc' ? ` ${l.unit}` : ''}</T>
              </View>
            ))}
          </Card>
        </Section>
        {ch.notes ? <Card><T v="label" tone="soft">NOTES</T><T>{ch.notes}</T></Card> : null}

        <View style={{ gap: 10, marginTop: 4 }}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button label="WhatsApp" kind="soft" icon={<Send size={18} color={c.primary} />} style={{ flex: 1 }} onPress={() => whatsApp(challanText(ch, store), ch.partyPhone)} />
            <Button label="PDF" kind="outline" icon={<Share size={18} color={c.ink} />} style={{ flex: 1 }} onPress={() => sharePdf(challanHtml(ch, store), `${ch.no}.pdf`)} />
            <Button label="Print" kind="outline" icon={<Printer size={18} color={c.ink} />} style={{ flex: 1 }} onPress={() => printHtml(challanHtml(ch, store))} />
          </View>
          {ch.status === 'packed' ? <Button label="Edit challan" kind="outline" block icon={<Pencil size={18} color={c.ink} />} onPress={() => router.push({ pathname: '/m/sales-docs/challans/new', params: { id: ch.id } })} /> : null}
          {ch.status === 'packed' ? <Button label="Delete challan" kind="danger" block icon={<Trash size={18} color={c.danger} />} onPress={remove} /> : null}
        </View>
      </View>
      <Sheet visible={sheet} onClose={() => setSheet(false)} title={next === 'dispatched' ? 'Send it out' : 'Mark delivered'} footer={<Button label="Save" size="lg" block onPress={step} />}>
        <View style={{ gap: 14 }}>
          {next === 'dispatched' ? (
            <>
              <Field label="Vehicle" value={vehicle} onChangeText={setVehicle} autoCapitalize="characters" />
              <Field label="Driver" value={driver} onChangeText={setDriver} />
              <Field label="Tracking / LR number" value={tracking} onChangeText={setTracking} autoCapitalize="characters" />
            </>
          ) : (
            <Field label="Received by" value={proof} onChangeText={setProof} placeholder="Name of the person who received it" />
          )}
        </View>
      </Sheet>
    </Screen>
  )
}
