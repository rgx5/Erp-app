import React, { useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { rulesFromConfig } from '@/domain/catalog'
import { nextStyleCode, sortCategories } from '@/domain/codes'
import { inr } from '@/domain/money'
import { UNIT_PRESETS, unitPreset } from '@/domain/qty'
import { useIndustry, useLabels, useList, useStore } from '@/data/hooks'
import { createItem, OpError } from '@/data/ops'
import { perform } from '@/data/store'
import { Button } from '@/ui/Button'
import { Field, MoneyField, NumberField, Select, SwitchRow } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Card } from '@/ui/primitives'
import { Section, Notice } from '@/ui/blocks'
import { TagInput } from '@/ui/TagInput'
import { T } from '@/ui/Text'
import { toast } from '@/ui/overlays'

/** Add an item: pick its category (which sets how it is sold), name it, price it, and list its sizes/colours or options. */
export default function NewItem() {
  const router = useRouter()
  const { category: presetCat } = useLocalSearchParams<{ category?: string }>()
  const pack = useIndustry()
  const labels = useLabels()
  const store = useStore()
  const categories = useList('categories')
  const products = useList('products')
  const cats = useMemo(() => sortCategories(categories, pack.groupOrder), [categories, pack.groupOrder])

  const [categoryId, setCategoryId] = useState(presetCat ?? '')
  const cat = cats.find((x) => x.id === categoryId)
  const rules = rulesFromConfig(cat?.config, { hsn: pack.tax.defaultHsn, reorder: store.lowStockDefault })

  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [codeTouched, setCodeTouched] = useState(false)
  const [brand, setBrand] = useState('')
  const [attr1, setAttr1] = useState('')
  const [attr2, setAttr2] = useState('')
  const [hsn, setHsn] = useState('')
  const [gst, setGst] = useState('')
  const [unit, setUnit] = useState('pc')
  const [fractional, setFractional] = useState(false)
  const [track, setTrack] = useState(true)
  const [noDisc, setNoDisc] = useState(false)
  const [cost, setCost] = useState('')
  const [mrp, setMrp] = useState('')
  const [price, setPrice] = useState('')
  const [opts1, setOpts1] = useState<string[]>([])
  const [opts2, setOpts2] = useState<string[]>([])
  const [opening, setOpening] = useState('')
  const [reorder, setReorder] = useState('')
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)

  // A category decides how its items are sold; picking one fills the form, and everything stays editable.
  useEffect(() => {
    if (!cat) return
    const r = rulesFromConfig(cat.config, { hsn: pack.tax.defaultHsn, reorder: store.lowStockDefault })
    setHsn(r.hsn); setGst(r.gstRate !== undefined ? String(r.gstRate) : ''); setUnit(r.unit); setFractional(!!(r.fractional ?? unitPreset(r.unit)?.fractional))
    setTrack(r.trackStock); setNoDisc(r.noDiscount); setReorder(String(r.reorderLevel))
    if (!codeTouched) setCode(nextStyleCode(cat, products))
  }, [categoryId]) // eslint-disable-line react-hooks/exhaustive-deps

  const sizesMode = (cat?.config?.variantMode ?? 'sizes') === 'sizes'
  const variantCount = Math.max(1, opts1.length) * Math.max(1, sizesMode ? opts2.length : 1)
  const priced = Number(price) > 0

  const errors = {
    category: !cat ? 'Choose a category' : null,
    name: !name.trim() ? `Give the ${labels.item.toLowerCase()} a name` : null,
    code: !code.trim() ? 'An item code is needed' : products.some((p) => p.styleCode.toUpperCase() === code.trim().toUpperCase()) ? 'That code is already used' : null,
  }
  const ok = !Object.values(errors).some(Boolean)

  function save() {
    setTried(true)
    if (!ok) { toast('Fill the highlighted fields to continue', 'err'); return }
    setBusy(true)
    try {
      const r = perform((s, ctx) => createItem(s, {
        name, styleCode: code, categoryId, brand, fabric: attr1, season: attr2, hsn, sizes: opts1.length ? opts1 : [''], colors: sizesMode && opts2.length ? opts2 : [''],
        cost: Number(cost) || 0, mrp: Number(mrp) || Number(price) || 0, price: Number(price) || 0, unit, fractional: fractional || undefined,
        ...(fractional && rules.step ? { step: rules.step } : {}), ...(rules.minQty ? { minQty: rules.minQty } : {}), trackStock: track ? undefined : false, noDiscount: noDisc || undefined,
        gstRate: gst.trim() === '' ? undefined : Number(gst), reorderLevel: Number(reorder) || undefined, openingStock: Number(opening) || undefined,
      }, ctx))
      toast(`${r.product.name} added — ${r.variants.length} ${r.variants.length === 1 ? 'variant' : 'variants'}`, 'ok')
      router.replace({ pathname: '/items/[id]', params: { id: r.product.id } })
    } catch (e) {
      toast(e instanceof OpError ? e.message : 'Could not add', 'err')
      setBusy(false)
    }
  }

  const sizeHint = sizesMode ? labels.option1 : (cat?.config?.optionLabel ?? 'Options')

  return (
    <Screen title={`New ${labels.item.toLowerCase()}`} back footer={<Button label={`Create ${labels.item.toLowerCase()}${variantCount > 1 ? ` · ${variantCount} variants` : ''}`} size="lg" block loading={busy} onPress={save} />}>
      <View style={{ gap: 6, paddingBottom: 12 }}>
        <Select<string> label="Category" value={categoryId} placeholder="Choose a category" searchable error={tried ? errors.category : null}
          options={cats.map((x) => ({ value: x.id, label: x.name, sub: x.group }))} onChange={setCategoryId} />

        <Section title="Basics" style={{ marginTop: 14 }}>
          <View style={{ gap: 14 }}>
            <Field label={`${labels.item} name`} value={name} onChangeText={setName} placeholder="e.g. Oxford Formal Shirt" autoCapitalize="words" error={tried ? errors.name : null} />
            <Field label="Item code" value={code} onChangeText={(t) => { setCodeTouched(true); setCode(t.toUpperCase()) }} placeholder="Made from the category" autoCapitalize="characters" mono error={tried ? errors.code : null} hint={codeTouched ? 'Becomes the SKU prefix' : 'Made automatically — change it if you like'} />
            <Field label="Brand (optional)" value={brand} onChangeText={setBrand} autoCapitalize="words" />
            {labels.attr1 ? <Field label={`${labels.attr1} (optional)`} value={attr1} onChangeText={setAttr1} placeholder={labels.attr1Hint} /> : null}
            {labels.attr2 ? <Field label={`${labels.attr2} (optional)`} value={attr2} onChangeText={setAttr2} placeholder={labels.attr2Hint} /> : null}
          </View>
        </Section>

        <Section title="Pricing" style={{ marginTop: 14 }}>
          <View style={{ gap: 14 }}>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}><MoneyField label={`Cost${unit !== 'pc' ? ` / ${unitPreset(unit)?.short ?? unit}` : ''}`} value={cost} onChange={setCost} /></View>
              <View style={{ flex: 1 }}><MoneyField label="MRP" value={mrp} onChange={setMrp} /></View>
            </View>
            <MoneyField label={`Selling price${unit !== 'pc' ? ` / ${unitPreset(unit)?.short ?? unit}` : ''}`} value={price} onChange={setPrice} large hint={store.priceIncludesTax ? 'What the customer pays, GST included' : 'Before GST — tax is added at billing'} />
            {!priced ? <Notice tone="warning" title="No price yet" body="That’s fine — it can be received first and priced later, but it can’t be sold until it has a price." /> : null}
          </View>
        </Section>

        <Section title={sizesMode ? `${labels.option1}s & ${labels.option2.toLowerCase()}s` : sizeHint} style={{ marginTop: 14 }}>
          <View style={{ gap: 14 }}>
            <TagInput label={sizesMode ? labels.option1 : sizeHint} value={opts1} onChange={setOpts1} placeholder={sizesMode ? 'S, M, L…' : 'Type and press return'} hint="Each one becomes its own barcoded variant with its own stock. Leave empty for a single item." />
            {sizesMode ? <TagInput label={labels.option2} value={opts2} onChange={setOpts2} placeholder="White, Navy…" /> : null}
            {variantCount > 1 ? <T v="caption" tone="soft">This creates <T v="caption" tone="primary" style={{ fontFamily: 'Inter_600SemiBold' }}>{variantCount}</T> barcoded variants.</T> : null}
          </View>
        </Section>

        <Section title="How it’s sold" style={{ marginTop: 14 }}>
          <Card padded={false}>
            <View style={{ padding: 16, gap: 14 }}>
              <Select<string> label="Sold by" value={unit} options={UNIT_PRESETS.map((u) => ({ value: u.code, label: u.label }))} onChange={(u) => { setUnit(u); setFractional(!!unitPreset(u)?.fractional) }} />
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ flex: 1 }}><NumberField label="HSN code" value={hsn} onChange={setHsn} hint={pack.tax.hsnHint} /></View>
                <View style={{ width: 110 }}><NumberField label="GST %" value={gst} onChange={setGst} decimals placeholder="slabs" /></View>
              </View>
            </View>
            <SwitchRow title="Allow fractions" subtitle="e.g. 2.5 m of fabric, 0.75 kg of rice" value={fractional} onChange={setFractional} />
            <SwitchRow title="Count in stock" subtitle="Turn off for services and made-to-order items" value={track} onChange={setTrack} />
            <SwitchRow title="No discounts" subtitle="Item and bill discounts skip this item" value={noDisc} onChange={setNoDisc} />
          </Card>
        </Section>

        {track ? (
          <Section title="Stock" style={{ marginTop: 14 }}>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}><NumberField label="Opening stock (each)" value={opening} onChange={setOpening} decimals={fractional} placeholder="0" hint="Optional" /></View>
              <View style={{ flex: 1 }}><NumberField label="Reorder at" value={reorder} onChange={setReorder} decimals={fractional} hint="Low-stock alert" /></View>
            </View>
          </Section>
        ) : null}
        {cat ? <T v="caption" tone="mute" style={{ marginTop: 12 }}>Rules from <T v="caption" tone="soft">{cat.name}</T>. {priced ? `Selling at ${inr(Number(price))}.` : ''}</T> : null}
      </View>
    </Screen>
  )
}
