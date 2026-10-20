import React, { useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { fmtDateTime } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useList } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { perform, useCan } from '@/data/store'
import { locationName, STATUS_LABEL, transferProgress, variantName } from '@/modules/warehouse/logic'
import { receiveTransfer } from '@/modules/warehouse/ops'
import { useData } from '@/modules/warehouse/ui/common'
import { Button } from '@/ui/Button'
import { NumberField } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Badge, Card, ProgressBar } from '@/ui/primitives'
import { KV, Notice, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Truck } from '@/ui/icons'
import { ask, toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

/** One transfer: what was sent, what has arrived, and the way to receive the rest (or close it short). */
export default function TransferPage() {
  const { c } = useTheme()
  const { id } = useLocalSearchParams<{ id: string }>()
  const can = useCan('warehouse')
  const data = useData()
  const receipts = useList('transferReceipts')
  const [receiving, setReceiving] = useState(false)
  const [got, setGot] = useState<Record<string, string>>({})
  const t = data.transfers[id]
  if (!can) return <Screen title="Transfer" back><T tone="mute">Transfers are for the owner and managers.</T></Screen>
  if (!t) return <Screen title="Not found" back><T tone="mute">This transfer is no longer here.</T></Screen>
  const p = transferProgress(t, receipts)
  const open = p.status === 'in_transit' || p.status === 'partial'
  const mine = receipts.filter((r) => r.transferId === t.id).sort((a, b) => a.date - b.date)

  function run(lines: Array<{ variantId: string; qty: number }>, closed: boolean) {
    try {
      perform((s, ctx) => receiveTransfer(s, t!.id, lines, { closed }, ctx))
      toast(closed ? 'Transfer closed' : 'Receipt saved', 'ok'); setReceiving(false)
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not save', 'err') }
  }
  const all = () => run(p.lines.filter((l) => l.outstanding > 0).map((l) => ({ variantId: l.variantId, qty: l.outstanding })), false)
  const partial = () => run(p.lines.map((l) => ({ variantId: l.variantId, qty: Number(got[l.variantId]) || 0 })).filter((l) => l.qty > 0), false)
  async function closeShort() {
    if (await ask({ title: `Close ${t!.no} short?`, message: `${p.outstandingTotal} units that have not arrived will be written off as lost in transit.`, confirm: 'Close transfer', danger: true })) run([], true)
  }

  return (
    <Screen title={t.no} subtitle={`${locationName(data, t.fromId)} → ${locationName(data, t.toId)}`} back
      footer={open ? <View style={{ gap: 8 }}>
        <Button label="Receive everything" size="lg" block icon={<Truck size={18} color={c.onPrimary} />} onPress={all} />
        <Button label="Receive part…" kind="soft" block onPress={() => { setGot({}); setReceiving(true) }} />
      </View> : undefined}>
      <View style={{ gap: 14, paddingBottom: 14 }}>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Badge tone={p.status === 'received' ? 'success' : p.status === 'closed_short' ? 'danger' : 'accent'}>{STATUS_LABEL[p.status]}</Badge>
          <T v="caption" tone="mute">Sent {fmtDateTime(t.date)}</T>
        </View>
        {p.status === 'closed_short' ? <Notice tone="danger" title="Closed with stock missing" body={`The cost of what never arrived${mine.find((r) => r.lossValue) ? ` (${inr(mine.find((r) => r.lossValue)!.lossValue!)})` : ''} is written off in the books.`} /> : null}
        <Section title="Items">
          <View style={{ gap: 10 }}>
            {p.lines.map((l) => (
              <Card key={l.variantId} style={{ gap: 8 }}>
                <T v="bodyStrong" numberOfLines={1}>{variantName(data, l.variantId)}</T>
                <ProgressBar value={l.sent ? l.received / l.sent : 0} tone={l.lost ? 'danger' : 'success'} />
                <T v="caption" tone="mute">Sent {l.sent} · received {l.received}{l.outstanding ? ` · ${l.outstanding} on the way` : ''}{l.lost ? ` · ${l.lost} lost` : ''}</T>
              </Card>
            ))}
          </View>
        </Section>
        {mine.length ? <Section title="Receipts"><Card>{mine.map((r) => <KV key={r.id} k={fmtDateTime(r.date)} v={r.closed ? 'Closed' : `${r.lines.reduce((s, x) => s + x.qty, 0)} units`} />)}</Card></Section> : null}
        {t.notes ? <T v="caption" tone="mute">{t.notes}</T> : null}
        {open ? <Button label="Close short — the rest is not coming" kind="ghost" onPress={closeShort} /> : null}
      </View>
      <Sheet visible={receiving} onClose={() => setReceiving(false)} title="What arrived?" footer={<Button label="Save receipt" size="lg" block onPress={partial} />}>
        <View style={{ gap: 12, paddingBottom: 8 }}>
          {p.lines.filter((l) => l.outstanding > 0).map((l) => (
            <NumberField key={l.variantId} label={`${variantName(data, l.variantId)} (${l.outstanding} on the way)`} value={got[l.variantId] ?? ''} onChange={(v) => setGot({ ...got, [l.variantId]: v })} decimals />
          ))}
        </View>
      </Sheet>
    </Screen>
  )
}
