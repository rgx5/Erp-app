import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { variantLabel } from '@/domain/codes'
import { inr, round2 } from '@/domain/money'
import { useList, useVariantViews } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { perform, useCan } from '@/data/store'
import { ItemPicker } from '@/features/ItemPicker'
import { assignPriceList, deletePriceList, savePriceList, setListPrices } from '@/modules/pricing/ops'
import { listPrice } from '@/modules/pricing/prices'
import { TIER_LABEL, type PriceBasis, type Tier } from '@/modules/pricing/types'
import { Button, IconButton } from '@/ui/Button'
import { Field, MoneyField, NumberField, Segmented, SwitchRow } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Badge, Card } from '@/ui/primitives'
import { Notice, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Plus, Trash } from '@/ui/icons'
import { ask, toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

/** One price list: how it prices items by default, the items that have their own price on it, and who is on it. */
export default function PriceListPage() {
  const { c } = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const can = useCan('pricing')
  const lists = useList('priceLists')
  const listItems = useList('priceListItems')
  const customers = useList('customers')
  const views = useVariantViews()
  const existing = id && id !== 'new' ? lists.find((l) => l.id === id) : undefined

  const [name, setName] = useState(existing?.name ?? '')
  const [tier, setTier] = useState<Tier>(existing?.tier ?? 'wholesale')
  const [basis, setBasis] = useState<PriceBasis>(existing?.basis ?? 'price')
  const [pct, setPct] = useState(existing ? String(existing.pct) : '-10')
  const [roundTo, setRoundTo] = useState(existing ? String(existing.roundTo) : '0')
  const [active, setActive] = useState(existing?.active ?? true)
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [picking, setPicking] = useState(false)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const byId = useMemo(() => new Map(views.map((v) => [v.id, v])), [views])
  const own = useMemo(() => listItems.filter((x) => x.listId === existing?.id), [listItems, existing?.id])
  const rows = useMemo(() => {
    const ids = [...new Set([...own.map((x) => x.variantId), ...Object.keys(edits)])]
    return ids.map((vid) => ({ vid, v: byId.get(vid), saved: own.find((x) => x.variantId === vid)?.price })).filter((r) => r.v)
  }, [own, edits, byId])
  const people = existing ? customers.filter((x) => x.priceListId === existing.id) : []

  if (!can) return <Screen title="Price list" back><T tone="mute">Price lists are for the owner and managers.</T></Screen>
  if (id && id !== 'new' && !existing) return <Screen title="Not found" back><T tone="mute">This price list is no longer here.</T></Screen>

  const num = (t: string) => (t.trim() === '' || t === '-' ? 0 : Number(t))
  const draft = { name, tier, basis, pct: num(pct), roundTo: num(roundTo), active, notes }
  const rule = { id: '', name, tier, basis, pct: num(pct), roundTo: num(roundTo), active }

  function fail(e: unknown, fallback: string) { toast(e instanceof OpError ? e.message : fallback, 'err'); setBusy(false) }
  function save() {
    setBusy(true)
    try {
      const r = perform((s, ctx) => savePriceList(s, draft, existing?.id, ctx))
      toast(`${r.list.name} saved`, 'ok')
      if (existing) setBusy(false); else router.replace({ pathname: '/m/pricing/lists/[id]', params: { id: r.list.id } })
    } catch (e) { fail(e, 'Could not save the list') }
  }
  function savePrices() {
    if (!existing) return
    try {
      const entries = Object.entries(edits).map(([variantId, t]) => ({ variantId, price: t.trim() === '' ? null : Number(t) }))
      const r = perform((s, ctx) => setListPrices(s, existing.id, entries, ctx))
      setEdits({})
      toast(`${r.set} saved${r.cleared ? `, ${r.cleared} cleared` : ''}`, 'ok')
    } catch (e) { fail(e, 'Could not save the prices') }
  }
  async function remove() {
    if (!existing) return
    if (!(await ask({ title: `Delete ${existing.name}?`, message: people.length ? `${people.length} customers on it go back to normal selling prices.` : 'Its item prices are deleted too.', confirm: 'Delete', danger: true }))) return
    try { perform((s, ctx) => deletePriceList(s, existing.id, ctx)); router.back() } catch (e) { fail(e, 'Could not delete') }
  }
  const dirty = Object.keys(edits).length > 0

  return (
    <Screen title={existing ? existing.name : 'New price list'} back footer={<Button label={existing ? 'Save list' : 'Create list'} size="lg" block loading={busy} onPress={save} disabled={!name.trim()} />}>
      <View style={{ gap: 6, paddingBottom: 14 }}>
        <Section title="The list">
          <View style={{ gap: 14 }}>
            <Field label="Name" value={name} onChangeText={setName} placeholder="Wholesale" />
            <View style={{ gap: 6 }}>
              <T v="label" tone="soft">Tier</T>
              <Segmented value={tier} options={(['retail', 'wholesale', 'dealer'] as Tier[]).map((t) => ({ value: t, label: TIER_LABEL[t] }))} onChange={setTier} />
              <T v="caption" tone="mute">Wholesale and dealer lists are left out of offers marked “retail only”.</T>
            </View>
            <View style={{ gap: 6 }}>
              <T v="label" tone="soft">Items without their own price are worked out from</T>
              <Segmented value={basis} options={[{ value: 'price', label: 'Selling price' }, { value: 'mrp', label: 'MRP' }, { value: 'cost', label: 'Cost' }]} onChange={setBasis} />
            </View>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}><Field label="Percent (− under, + over)" value={pct} onChangeText={(t) => setPct(t.replace(/[^0-9.-]/g, ''))} keyboardType="numbers-and-punctuation" suffix="%" /></View>
              <View style={{ flex: 1 }}><NumberField label="Round to nearest ₹" value={roundTo} onChange={setRoundTo} decimals hint="0 = to the paisa" /></View>
            </View>
            <Notice tone="primary" title={`An item selling at ₹1,000 costs ${inr(listPrice(rule, { price: 1000, mrp: 1200, cost: 600 }))}`} body="Prices are in the same terms as your selling prices (including GST if they include it)." />
            <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline />
            <Card padded={false}><SwitchRow title="In use" subtitle="Switch off to stop pricing on it without deleting it" value={active} onChange={setActive} /></Card>
          </View>
        </Section>

        {existing ? (
          <>
            <Section title={`Item prices · ${own.length}`} style={{ marginTop: 18 }}>
              <View style={{ gap: 10 }}>
                {rows.map(({ vid, v, saved }) => {
                  const typed = edits[vid]
                  const ruled = v ? listPrice(existing, { price: v.price, mrp: v.mrp, cost: v.cost }) : 0
                  return (
                    <Card key={vid} style={{ gap: 10 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                        <View style={{ flex: 1 }}>
                          <T v="bodyStrong" numberOfLines={1}>{v!.productName}</T>
                          <T v="caption" tone="mute" numberOfLines={1}>{[variantLabel(v!.size, v!.color), v!.sku].filter(Boolean).join(' · ')} · sells at {inr(v!.price)}</T>
                        </View>
                        {saved !== undefined && typed === undefined ? <Badge tone="primary">Own price</Badge> : null}
                        <IconButton label="Use the list’s rule" tone="ghost" size={36} onPress={() => setEdits({ ...edits, [vid]: '' })}><Trash size={18} color={c.inkMute} /></IconButton>
                      </View>
                      <MoneyField label={typed === '' ? `Cleared — the rule gives ${inr(ruled)}` : 'Price on this list'} value={typed ?? (saved !== undefined ? String(saved) : '')} onChange={(t) => setEdits({ ...edits, [vid]: t })} />
                    </Card>
                  )
                })}
                <Button label="Add an item price" kind="soft" block icon={<Plus size={18} color={c.primary} />} onPress={() => setPicking(true)} />
                {dirty ? <Button label="Save item prices" block onPress={savePrices} /> : null}
              </View>
            </Section>
            <Section title={`Customers on this list · ${people.length}`} style={{ marginTop: 18 }}>
              <Card padded={false}>
                {people.length ? people.map((p, i) => (
                  <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
                    <T v="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>{p.name}</T>
                    <Button label="Remove" kind="ghost" size="sm" onPress={() => { try { perform((s, ctx) => assignPriceList(s, p.id, '', ctx)) } catch (e) { fail(e, 'Could not change') } }} />
                  </View>
                )) : <T tone="mute" style={{ padding: 14 }}>Nobody yet. Open a customer and pick this list under Pricing.</T>}
              </Card>
            </Section>
            <View style={{ marginTop: 18 }}><Button label="Delete this list" kind="danger" block onPress={remove} /></View>
          </>
        ) : null}
      </View>
      <ItemPicker visible={picking} onClose={() => setPicking(false)} onPick={(v) => setEdits((cur) => (v.id in cur ? cur : { ...cur, [v.id]: String(round2(listPrice(existing ?? rule, { price: v.price, mrp: v.mrp, cost: v.cost }))) }))}
        picked={new Set(rows.map((r) => r.vid))} title="Add an item to this list" />
    </Screen>
  )
}
