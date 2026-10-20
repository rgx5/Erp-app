import React, { useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { variantLabel } from '@/domain/codes'
import { useList } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { perform, useApp, useCan } from '@/data/store'
import { ItemPicker } from '@/features/ItemPicker'
import { undispatched } from '@/modules/sales-docs/logic/challans'
import { saveChallan } from '@/modules/sales-docs/ops'
import { CustomerRow } from '@/modules/sales-docs/ui/forms'
import type { ChallanLine } from '@/modules/sales-docs/types'
import { Button, IconButton } from '@/ui/Button'
import { Field, NumberField } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Card } from '@/ui/primitives'
import { Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Plus, Trash } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

interface Row { line: ChallanLine; qty: string }

/** A delivery challan: what is going out, to whom, and how. From an order (`?orderId=`) it starts with what is still to send. */
export default function NewChallan() {
  const { c } = useTheme()
  const router = useRouter()
  const { id: editId, orderId } = useLocalSearchParams<{ id?: string; orderId?: string }>()
  const can = useCan('pos')
  const challans = useList('challans')
  const existing = challans.find((x) => x.id === editId)
  const order = useApp((s) => (existing?.orderId ?? orderId ? s.data.salesOrders[(existing?.orderId ?? orderId)!] : undefined))

  const [customerId, setCustomerId] = useState<string | null>(existing?.customerId ?? order?.customerId ?? null)
  const [name, setName] = useState(existing && !existing.customerId ? existing.partyName : '')
  const [phone, setPhone] = useState(existing && !existing.customerId ? existing.partyPhone : '')
  const [address, setAddress] = useState(existing?.address ?? '')
  const [rows, setRows] = useState<Row[]>(() => {
    if (existing) return existing.items.map((line) => ({ line, qty: String(line.qty) }))
    if (order) return undispatched(order, challans).map((line) => ({ line, qty: String(line.qty) }))
    return []
  })
  const [vehicle, setVehicle] = useState(existing?.vehicle ?? '')
  const [driver, setDriver] = useState(existing?.driver ?? '')
  const [tracking, setTracking] = useState(existing?.trackingNo ?? '')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)

  if (!can) return <Screen title="Challan" back><T tone="mute">Challans are for people who use the billing counter.</T></Screen>
  const linked = existing?.orderId ?? orderId

  function save() {
    setBusy(true)
    try {
      const items = rows.map((r) => ({ ...r.line, qty: Number(r.qty) || 0 })).filter((l) => l.qty > 0)
      const r = perform((s, ctx) => saveChallan(s, { orderId: linked, customerId, partyName: name, partyPhone: phone, address, items, vehicle, driver, trackingNo: tracking, notes }, existing?.id, ctx))
      toast(`${r.challan.no} saved`, 'ok')
      router.replace({ pathname: '/m/sales-docs/challans/[id]', params: { id: r.challan.id } })
    } catch (e) {
      toast(e instanceof OpError ? e.message : 'Could not save the challan', 'err')
      setBusy(false)
    }
  }

  return (
    <Screen title={existing ? `Edit ${existing.no}` : 'New challan'} subtitle={order ? `Against ${order.no}` : undefined} back footer={<Button label="Save challan" size="lg" block loading={busy} onPress={save} />}>
      <View style={{ gap: 6, paddingBottom: 14 }}>
        <CustomerRow customerId={customerId} onChange={setCustomerId} label="Deliver to" optional={!linked} />
        {!customerId ? (
          <View style={{ gap: 12, marginTop: 10 }}>
            <Field label="Name" value={name} onChangeText={setName} />
            <Field label="Phone (optional)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
          </View>
        ) : null}
        <View style={{ marginTop: 12 }}><Field label="Delivery address" value={address} onChangeText={setAddress} multiline placeholder="Leave blank to use the customer’s address" /></View>

        <Section title="Items" style={{ marginTop: 18 }}>
          <View style={{ gap: 10 }}>
            {rows.map(({ line: l, qty }) => (
              <Card key={l.variantId ?? l.sku} style={{ gap: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <T v="bodyStrong" numberOfLines={1}>{l.name}</T>
                    <T v="caption" tone="mute" numberOfLines={1}>{l.sku}</T>
                  </View>
                  <IconButton label="Remove" tone="ghost" size={36} onPress={() => setRows(rows.filter((r) => r.line !== l))}><Trash size={18} color={c.inkMute} /></IconButton>
                </View>
                <NumberField label={`Quantity${l.unit && l.unit !== 'pc' ? ` (${l.unit})` : ''}`} value={qty} decimals={!!l.unit && l.unit !== 'pc'} onChange={(t) => setRows(rows.map((r) => (r.line === l ? { ...r, qty: t } : r)))} />
              </Card>
            ))}
            {rows.length === 0 ? <T tone="mute">{order ? 'Everything on this order has already been sent.' : 'Add the items going out.'}</T> : null}
            {!linked ? <Button label="Add item" kind="soft" block icon={<Plus size={18} color={c.primary} />} onPress={() => setPicking(true)} /> : null}
            {order && rows.length === 0 ? null : order ? <T v="caption" tone="mute">Quantities are capped at what is still to send on {order.no}.</T> : null}
          </View>
        </Section>

        <Section title="Transport" style={{ marginTop: 18 }}>
          <View style={{ gap: 14 }}>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}><Field label="Vehicle" value={vehicle} onChangeText={setVehicle} autoCapitalize="characters" /></View>
              <View style={{ flex: 1 }}><Field label="Driver" value={driver} onChangeText={setDriver} /></View>
            </View>
            <Field label="Tracking / LR number" value={tracking} onChangeText={setTracking} autoCapitalize="characters" />
            <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline />
          </View>
        </Section>
      </View>
      <ItemPicker visible={picking} onClose={() => setPicking(false)} picked={new Set(rows.map((r) => r.line.variantId ?? ''))} title="Add item to the challan"
        onPick={(v) => setRows((cur) => (cur.some((r) => r.line.variantId === v.id) ? cur : [...cur, { line: { variantId: v.id, name: `${v.productName}${variantLabel(v.size, v.color) ? ` (${variantLabel(v.size, v.color)})` : ''}`, sku: v.sku, qty: 1, ...(v.unit && v.unit !== 'pc' ? { unit: v.unit } : {}) }, qty: '1' }]))} />
    </Screen>
  )
}

