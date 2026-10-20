import React, { useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { OpError } from '@/data/ops'
import { perform, useCan } from '@/data/store'
import { stockAt, variantName } from '@/modules/warehouse/logic'
import { dispatchTransfer } from '@/modules/warehouse/ops'
import { ItemField, LocationSelect, useData } from '@/modules/warehouse/ui/common'
import { Button, IconButton } from '@/ui/Button'
import { Field, NumberField } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Card } from '@/ui/primitives'
import { Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Plus, Trash } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

interface Line { variantId: string; qty: string }

/** Send stock: from where, to where, what. It leaves the sender now and is "in transit" until the other side receives it. */
export default function NewTransfer() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('warehouse')
  const data = useData()
  const [fromId, setFrom] = useState('main')
  const [toId, setTo] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [adding, setAdding] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  if (!can) return <Screen title="New transfer" back><T tone="mute">Transfers are for the owner and managers.</T></Screen>

  const patch = (variantId: string, qty: string) => setLines((ls) => ls.map((l) => (l.variantId === variantId ? { ...l, qty } : l)))
  function add(variantId: string) {
    if (variantId) setLines((ls) => (ls.some((l) => l.variantId === variantId) ? ls : [...ls, { variantId, qty: '1' }]))
    setAdding('')
  }
  function send() {
    setBusy(true)
    try {
      const r = perform((s, ctx) => dispatchTransfer(s, { fromId, toId, notes, lines: lines.map((l) => ({ variantId: l.variantId, qty: Number(l.qty) || 0 })) }, ctx))
      toast(`${r.transfer.no} sent`, 'ok')
      router.replace({ pathname: '/m/warehouse/transfers/[id]', params: { id: r.transfer.id } })
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not send', 'err'); setBusy(false) }
  }

  return (
    <Screen title="New transfer" back footer={<Button label="Send stock" size="lg" block loading={busy} onPress={send} />}>
      <View style={{ gap: 14, paddingBottom: 14 }}>
        <LocationSelect label="From" value={fromId} onChange={setFrom} />
        <LocationSelect label="To" value={toId} onChange={setTo} exclude={fromId} />
        <Section title="Items">
          <View style={{ gap: 10 }}>
            {lines.map((l) => (
              <Card key={l.variantId} style={{ gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <T v="bodyStrong" numberOfLines={1}>{variantName(data, l.variantId)}</T>
                    <T v="caption" tone="mute">{stockAt(data, l.variantId, fromId)} at the sender</T>
                  </View>
                  <IconButton label="Remove" tone="ghost" size={36} onPress={() => setLines(lines.filter((x) => x.variantId !== l.variantId))}><Trash size={17} color={c.inkMute} /></IconButton>
                </View>
                <NumberField label="Quantity" value={l.qty} onChange={(t) => patch(l.variantId, t)} decimals />
              </Card>
            ))}
            <ItemField value={adding} onChange={add} placeholder="Add an item…" />
            {!lines.length ? <T v="caption" tone="mute"><Plus size={12} color={c.inkMute} /> Add the items you are sending.</T> : null}
          </View>
        </Section>
        <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline />
      </View>
    </Screen>
  )
}
