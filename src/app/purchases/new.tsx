import React, { useEffect, useMemo, useRef, useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { variantLabel } from '@/domain/codes'
import { fromInputDate, toInputDate } from '@/domain/dates'
import { inr, inr0, round2 } from '@/domain/money'
import { needsPricing } from '@/domain/pricing'
import { buildGrn, invoiceCheck, type GrnDraftLine } from '@/domain/purchasing'
import { fmtQty, isFrac, unitName } from '@/domain/qty'
import type { VariantView } from '@/domain/views'
import { useLabels, useList, useVariantViews } from '@/data/hooks'
import { OpError, receivePurchase } from '@/data/ops'
import { perform, useCan } from '@/data/store'
import { ItemPicker, scanVariants } from '@/features/ItemPicker'
import { PriceSheet } from '@/features/PriceEntry'
import { usePurchaseDraft } from '@/features/purchaseDraft'
import { SupplierSheet } from '@/features/SupplierSheet'
import { Button, IconButton } from '@/ui/Button'
import { Field, MoneyField, NumberField, Segmented, Select } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Badge, Card } from '@/ui/primitives'
import { KV, Notice, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Plus, ScanBarcode, Trash, UserPlus } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'
import { PanelSlot } from '@/modules/PanelSlot'

type PayMode = 'full' | 'later' | 'part'

/** Goods receipt: who sent it, what arrived at what cost, what was paid. Stock goes up and each item's cost is updated. */
export default function NewPurchase() {
  const { c } = useTheme()
  const router = useRouter()
  const params = useLocalSearchParams<{ productId?: string; supplierId?: string; draft?: string }>()
  const labels = useLabels()
  const canBuy = useCan('purchases')
  const views = useVariantViews()
  const suppliers = useList('suppliers')

  const [supplierId, setSupplierId] = useState(params.supplierId ?? '')
  const [lines, setLines] = useState<GrnDraftLine[]>([])
  const [invoiceRef, setInvoiceRef] = useState('')
  const [invoiceTotal, setInvoiceTotal] = useState('')
  const [date, setDate] = useState(toInputDate(Date.now()))
  const [notes, setNotes] = useState('')
  // What modules capture on the receipt (batches, serial numbers, the location) — saved as `purchase.ext`.
  const [ext, setExtAll] = useState<Record<string, unknown>>({})
  const [payMode, setPayMode] = useState<PayMode>('full')
  const [part, setPart] = useState('')
  const [picking, setPicking] = useState(false)
  const [newSupplier, setNewSupplier] = useState(false)
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [toPrice, setToPrice] = useState<{ purchaseId: string; variants: VariantView[] } | null>(null)
  const seeded = useRef(false)
  const poRef = useRef<string | undefined>(undefined)

  const byId = useMemo(() => new Map(views.map((v) => [v.id, v])), [views])

  // Arrive pre-filled: from the reorder list (a draft), or from an item ("Receive stock" lists all its variants).
  useEffect(() => {
    if (seeded.current) return
    seeded.current = true
    if (params.draft) {
      const d = usePurchaseDraft.getState().take()
      if (d) {
        if (d.supplierId) setSupplierId(d.supplierId)
        if (d.poId) poRef.current = d.poId
        setLines(d.lines.filter((l) => byId.has(l.variantId)).map((l) => ({ variantId: l.variantId, qty: String(l.qty), cost: l.cost ? String(l.cost) : byId.get(l.variantId)!.cost > 0 ? String(byId.get(l.variantId)!.cost) : '' })))
      }
    } else if (params.productId) {
      setLines(views.filter((v) => v.productId === params.productId && v.active).map((v) => ({ variantId: v.id, qty: '', cost: v.cost > 0 ? String(v.cost) : '' })))
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const built = useMemo(() => buildGrn(lines), [lines])
  const total = built.total
  const paid = payMode === 'full' ? total : payMode === 'later' ? 0 : round2(Number(part) || 0)
  const check = invoiceCheck(total, Number(invoiceTotal) || undefined)
  const zeroCost = built.items.filter((i) => i.cost <= 0).length
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(date) && fromInputDate(date) <= Date.now() + 86_400_000 && !Number.isNaN(fromInputDate(date))
  const errors = {
    supplier: !supplierId ? 'Choose who the goods came from' : null,
    lines: !built.items.length ? 'Add at least one item with a quantity' : null,
    paid: paid > total + 0.001 ? 'Paid can’t be more than the total' : null,
    date: dateOk ? null : 'Use a date like 2026-10-19, not in the future',
  }
  const picked = useMemo(() => new Set(lines.map((l) => l.variantId)), [lines])

  if (!canBuy) return <Screen title="Receive stock" back><T tone="mute">Receiving stock is for the owner and managers.</T></Screen>

  function addVariant(v: VariantView) {
    setLines((ls) => {
      const i = ls.findIndex((l) => l.variantId === v.id)
      if (i < 0) return [...ls, { variantId: v.id, qty: '1', cost: v.cost > 0 ? String(v.cost) : '' }]
      return ls.map((l, j) => (j === i ? { ...l, qty: String((Number(l.qty) || 0) + 1) } : l))
    })
    return `${v.productName}${variantLabel(v.size, v.color) ? ` · ${variantLabel(v.size, v.color)}` : ''} added`
  }
  const patch = (variantId: string, p: Partial<GrnDraftLine>) => setLines((ls) => ls.map((l) => (l.variantId === variantId ? { ...l, ...p } : l)))
  const scan = () => scanVariants(addVariant, { title: 'Receive stock', hint: 'Each scan adds one — set quantities after', noun: labels.item })

  function save() {
    setTried(true)
    if (Object.values(errors).some(Boolean)) { toast(errors.supplier ?? errors.lines ?? errors.paid ?? errors.date ?? 'Check the receipt', 'err'); return }
    setBusy(true)
    try {
      const dayStart = toInputDate(Date.now()) === date ? Date.now() : fromInputDate(date)
      const r = perform((s, ctx) => receivePurchase(s, {
        supplierId, date: dayStart, invoiceRef: invoiceRef.trim(), invoiceTotal: Number(invoiceTotal) > 0 ? round2(Number(invoiceTotal)) : undefined,
        items: built.items, total, paid, notes: notes.trim(), ...(poRef.current ? { poId: poRef.current } : {}), ...(Object.keys(ext).length ? { ext } : {}),
      }, ctx))
      toast(`${r.purchase.no} received — ${built.items.length} ${built.items.length === 1 ? 'line' : 'lines'}`, 'ok')
      const unpriced = built.items.map((i) => byId.get(i.variantId)).filter((v): v is VariantView => !!v && needsPricing(v)).map((v) => ({ ...v, cost: built.items.find((i) => i.variantId === v.id)?.cost || v.cost }))
      if (unpriced.length) { setBusy(false); setToPrice({ purchaseId: r.purchase.id, variants: unpriced }) }
      else router.replace({ pathname: '/purchases/[id]', params: { id: r.purchase.id } })
    } catch (e) {
      toast(e instanceof OpError ? e.message : 'Could not save the receipt', 'err')
      setBusy(false)
    }
  }

  const done = () => { const id = toPrice?.purchaseId; setToPrice(null); if (id) router.replace({ pathname: '/purchases/[id]', params: { id } }) }

  return (
    <Screen title="Receive stock" subtitle={built.items.length ? `${built.items.length} ${built.items.length === 1 ? 'line' : 'lines'} · ${inr(total)}` : 'Goods from a supplier'} back
      footer={<Button label={total > 0 ? `Receive stock · ${inr(total)}` : 'Receive stock'} size="lg" block loading={busy} onPress={save} />}>
      <View style={{ gap: 6, paddingBottom: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Select<string> label="Supplier" value={supplierId} placeholder="Who sent it?" searchable error={tried ? errors.supplier : null}
              options={suppliers.map((s) => ({ value: s.id, label: s.name, sub: s.phone || undefined })).sort((a, b) => a.label.localeCompare(b.label))} onChange={setSupplierId} />
          </View>
          <IconButton label="New supplier" tone="primary" size={50} onPress={() => setNewSupplier(true)}><UserPlus size={20} color={c.primary} /></IconButton>
        </View>

        <Section title="Items received" style={{ marginTop: 18 }}>
          <View style={{ gap: 10 }}>
            {lines.map((l) => {
              const v = byId.get(l.variantId)
              if (!v) return null
              const frac = isFrac(v)
              const qty = Number(l.qty) || 0
              const cost = Number(l.cost) || 0
              const label = variantLabel(v.size, v.color)
              return (
                <Card key={l.variantId} padded={false}>
                  <View style={{ padding: 14, gap: 12 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <View style={{ flex: 1, gap: 1 }}>
                        <T v="bodyStrong" numberOfLines={1}>{v.productName}</T>
                        <T v="caption" tone="mute" numberOfLines={1}>{[label, v.sku, v.trackStock ? `${fmtQty(v.stock)} in stock` : null].filter(Boolean).join(' · ')}</T>
                      </View>
                      <IconButton label="Remove" tone="ghost" size={36} onPress={() => setLines((ls) => ls.filter((x) => x.variantId !== l.variantId))}><Trash size={17} color={c.inkMute} /></IconButton>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                      <View style={{ flex: 1 }}><NumberField label={`Quantity (${unitName(v).toLowerCase()})`} value={l.qty} onChange={(t) => patch(l.variantId, { qty: t })} decimals={frac} placeholder="0" /></View>
                      <View style={{ flex: 1 }}><MoneyField label="Cost each" value={l.cost} onChange={(t) => patch(l.variantId, { cost: t })} /></View>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      {v.cost > 0 && cost > 0 && cost !== v.cost ? <Badge tone={cost > v.cost ? 'warning' : 'success'}>{cost > v.cost ? '▲' : '▼'} from {inr0(v.cost)}</Badge> : null}
                      {needsPricing(v) ? <Badge tone="accent">No selling price yet</Badge> : null}
                      <T v="num" style={{ marginLeft: 'auto' }}>{qty > 0 && cost > 0 ? inr(round2(qty * cost)) : ''}</T>
                    </View>
                  </View>
                </Card>
              )
            })}
            {tried && errors.lines ? <T v="caption" tone="danger">{errors.lines}</T> : null}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}><Button label={`Add ${labels.item.toLowerCase()}`} kind="soft" block icon={<Plus size={19} color={c.primary} />} onPress={() => setPicking(true)} /></View>
              <View style={{ flex: 1 }}><Button label="Scan" kind="soft" block icon={<ScanBarcode size={19} color={c.primary} />} onPress={scan} /></View>
            </View>
            {built.skipped > 0 ? <T v="caption" tone="mute">{built.skipped} {built.skipped === 1 ? 'line has' : 'lines have'} no quantity and will be left out.</T> : null}
          </View>
        </Section>

        <PanelSlot slot="receipt" items={built.items.map((i) => ({ variantId: i.variantId, qty: i.qty, cost: i.cost }))} ext={ext}
          setExt={(moduleId, value) => setExtAll((cur) => ({ ...cur, [moduleId]: value }))} setQty={(variantId, qty) => patch(variantId, { qty: String(qty) })} />

        <Section title="The supplier’s bill" style={{ marginTop: 18 }}>
          <View style={{ gap: 14 }}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}><Field label="Bill number" value={invoiceRef} onChangeText={setInvoiceRef} autoCapitalize="characters" placeholder="Optional" /></View>
              <View style={{ flex: 1 }}><Field label="Date" value={date} onChangeText={setDate} keyboardType="numbers-and-punctuation" mono maxLength={10} error={tried ? errors.date : null} /></View>
            </View>
            <MoneyField label="Total on their bill" value={invoiceTotal} onChange={setInvoiceTotal} hint="Optional — we’ll check your receipt against it" />
            {check ? (
              check.ok
                ? <Notice tone="success" title="Matches the supplier’s bill" body={`Your receipt totals ${inr(total)}.`} />
                : <Notice tone="warning" title={`${inr(Math.abs(check.diff))} ${check.diff > 0 ? 'more' : 'less'} than their bill`} body={`You’ve entered ${inr(total)}; they billed ${inr(Number(invoiceTotal))}. Check quantities, costs and any missing lines — or carry on if the difference is expected.`} />
            ) : null}
          </View>
        </Section>

        <Section title="Payment" style={{ marginTop: 18 }}>
          <View style={{ gap: 14 }}>
            <Segmented<PayMode> value={payMode} onChange={setPayMode} options={[{ value: 'full', label: 'Paid in full' }, { value: 'part', label: 'Part paid' }, { value: 'later', label: 'Pay later' }]} />
            {payMode === 'part' ? <MoneyField label="Paid now" value={part} onChange={setPart} error={tried ? errors.paid : null} /> : null}
            <Card flat>
              <KV k="Total" v={inr(total)} strong />
              <KV k="Paid" v={inr(paid)} tone={paid ? 'success' : undefined} />
              <KV k="Still owed to supplier" v={inr(Math.max(0, round2(total - paid)))} tone={total - paid > 0 ? 'warning' : undefined} />
            </Card>
            <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline />
            {zeroCost ? <Notice tone="accent" title={`${zeroCost} ${zeroCost === 1 ? 'line has' : 'lines have'} no cost`} body="Profit reports will treat them as free. Add the cost if you know it." /> : null}
          </View>
        </Section>
      </View>

      <ItemPicker visible={picking} onClose={() => setPicking(false)} picked={picked} onPick={(v) => { addVariant(v); toast(`${v.productName}${variantLabel(v.size, v.color) ? ` · ${variantLabel(v.size, v.color)}` : ''} added`, 'ok') }}
        title={`Add ${labels.item.toLowerCase()}`} subtitle="Tap to add — tap again for one more" />
      <SupplierSheet visible={newSupplier} onClose={() => setNewSupplier(false)} onSaved={(s) => setSupplierId(s.id)} />
      <PriceSheet variants={toPrice?.variants ?? []} onClose={done} />
    </Screen>
  )
}
