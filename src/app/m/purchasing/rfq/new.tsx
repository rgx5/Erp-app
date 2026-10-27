import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { fromInputDate } from '@/domain/dates'
import { useList, useVariantViews } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { perform, useCan } from '@/data/store'
import { ItemPicker } from '@/features/ItemPicker'
import { createRfq } from '@/modules/purchasing/ops-sourcing'
import { dateOk } from '@/modules/purchasing/ui/helpers'
import { Button, IconButton } from '@/ui/Button'
import { Field, NumberField } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Card, Chip } from '@/ui/primitives'
import { Section } from '@/ui/blocks'
import { Plus, Trash } from '@/ui/icons'
import { T } from '@/ui/Text'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

/** A request for quotation: the items and quantities wanted, and the suppliers to ask. */
export default function NewRfq() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('purchases')
  const suppliers = useList('suppliers')
  const views = useVariantViews()
  const byId = useMemo(() => new Map(views.map((v) => [v.id, v])), [views])
  const [title, setTitle] = useState('')
  const [lines, setLines] = useState<Array<{ variantId: string; qty: string }>>([])
  const [ids, setIds] = useState<string[]>([])
  const [closes, setCloses] = useState('')
  const [notes, setNotes] = useState('')
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!can) return <Screen title="New request" back><T tone="mute">Quotations are for the owner and managers.</T></Screen>

  function save() {
    if (!dateOk(closes)) { toast('Write the date as YYYY-MM-DD', 'err'); return }
    setBusy(true)
    try {
      const r = perform((s, ctx) => createRfq(s, { title, items: lines.map((l) => ({ variantId: l.variantId, qty: Number(l.qty) || 0 })), supplierIds: ids, closesOn: closes ? fromInputDate(closes) : undefined, notes }, ctx))
      toast(`${r.rfq.no} created`, 'ok')
      router.replace({ pathname: '/m/purchasing/rfq/[id]', params: { id: r.rfq.id } })
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not create the request', 'err'); setBusy(false) }
  }

  return (
    <Screen title="New request" back footer={<Button label="Create request" size="lg" block loading={busy} onPress={save} />}>
      <View style={{ gap: 16, paddingBottom: 14 }}>
        <Field label="Name" value={title} onChangeText={setTitle} placeholder="Festival stock, monsoon restock…" />
        <Section title="Items wanted" style={{ marginTop: 0 }}>
          <View style={{ gap: 10 }}>
            {lines.map((l) => (
              <Card key={l.variantId} style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
                <View style={{ flex: 1 }}><T v="bodyStrong" numberOfLines={1}>{byId.get(l.variantId)?.productName ?? 'Item'}</T></View>
                <View style={{ width: 90 }}><NumberField label="Qty" value={l.qty} onChange={(t) => setLines(lines.map((x) => (x.variantId === l.variantId ? { ...x, qty: t } : x)))} decimals /></View>
                <IconButton label="Remove" tone="ghost" size={36} onPress={() => setLines(lines.filter((x) => x.variantId !== l.variantId))}><Trash size={18} color={c.inkMute} /></IconButton>
              </Card>
            ))}
            <Button label="Add item" kind="soft" block icon={<Plus size={18} color={c.primary} />} onPress={() => setPicking(true)} />
          </View>
        </Section>
        <Section title="Ask these suppliers" style={{ marginTop: 0 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {suppliers.map((s) => <Chip key={s.id} label={s.name} selected={ids.includes(s.id)} onPress={() => setIds(ids.includes(s.id) ? ids.filter((x) => x !== s.id) : [...ids, s.id])} />)}
          </View>
        </Section>
        <Field label="Reply by (optional)" value={closes} onChangeText={setCloses} placeholder="YYYY-MM-DD" error={dateOk(closes) ? null : 'YYYY-MM-DD'} />
        <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline />
      </View>
      <ItemPicker visible={picking} onClose={() => setPicking(false)} onPick={(v) => setLines((cur) => (cur.some((l) => l.variantId === v.id) ? cur : [...cur, { variantId: v.id, qty: '1' }]))} picked={new Set(lines.map((l) => l.variantId))} title="Add item to the request" />
    </Screen>
  )
}
