import React, { useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'
import { sortCategories } from '@/domain/codes'
import { UNIT_PRESETS, unitPreset } from '@/domain/qty'
import type { Category, CategoryConfig } from '@/domain/types'
import { useIndustry, useLabels, useList } from '@/data/hooks'
import { deleteCategory, OpError, saveCategory } from '@/data/ops'
import { perform } from '@/data/store'
import { SettingsLocked, useCanSettings } from '@/features/settingsKit'
import { Button, IconButton } from '@/ui/Button'
import { Field, NumberField, Segmented, Select, SwitchRow } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Card, Chip, Group } from '@/ui/primitives'
import { EmptyState, ListRow, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Plus, Tags, Trash } from '@/ui/icons'
import { ask, toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

const summary = (cat: Category, count: number, itemWord: string) => {
  const cfg = cat.config ?? {}
  const unit = unitPreset(cfg.unit)
  return [
    unit && unit.code !== 'pc' ? `Sold by ${unit.label.toLowerCase()}` : null,
    cfg.trackStock === false ? 'No stock count' : null,
    cfg.gstRate !== undefined ? `GST ${cfg.gstRate}%` : null,
    `${count} ${count === 1 ? itemWord.toLowerCase() : itemWord.toLowerCase() + 's'}`,
  ].filter(Boolean).join(' · ')
}

/** Categories decide how their items are sold — unit, fractions, GST, stock counting — so a new item only needs a name and a price. */
export default function Categories() {
  const { c } = useTheme()
  const allowed = useCanSettings()
  const pack = useIndustry()
  const labels = useLabels()
  const categories = useList('categories')
  const products = useList('products')
  const [editing, setEditing] = useState<Category | 'new' | null>(null)

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of products) m.set(p.categoryId, (m.get(p.categoryId) ?? 0) + 1)
    return m
  }, [products])
  const groups = useMemo(() => {
    const out: Array<{ name: string; cats: Category[] }> = []
    for (const cat of sortCategories(categories, pack.groupOrder)) {
      const g = out.find((x) => x.name === cat.group)
      if (g) g.cats.push(cat); else out.push({ name: cat.group, cats: [cat] })
    }
    return out
  }, [categories, pack.groupOrder])

  if (!allowed) return <SettingsLocked title="Categories" />

  return (
    <Screen title="Categories" subtitle={`${categories.length} ${categories.length === 1 ? 'category' : 'categories'}`} back
      right={<IconButton label="New category" tone="dark" onPress={() => setEditing('new')}><Plus size={22} color={c.bg} /></IconButton>}>
      {groups.length ? (
        <View style={{ paddingBottom: 12 }}>
          {groups.map((g, i) => (
            <Section key={g.name || 'other'} title={g.name || 'Other'} style={{ marginTop: i === 0 ? 6 : 22 }}>
              <Group>
                {g.cats.map((cat) => <ListRow key={cat.id} icon={<Tags size={19} color={c.primary} />} title={cat.name} subtitle={summary(cat, counts.get(cat.id) ?? 0, labels.item)} onPress={() => setEditing(cat)} />)}
              </Group>
            </Section>
          ))}
        </View>
      ) : (
        <EmptyState icon={<Tags size={26} color={c.primary} />} title="No categories yet" hint={`Categories keep ${labels.items.toLowerCase()} organised and decide how each one is sold.`} action="Add a category" onAction={() => setEditing('new')} />
      )}
      <CategorySheet category={editing} groupsList={groups.map((g) => g.name).filter(Boolean)} itemCount={editing && editing !== 'new' ? counts.get(editing.id) ?? 0 : 0} onClose={() => setEditing(null)} />
    </Screen>
  )
}

function CategorySheet({ category, groupsList, itemCount, onClose }: { category: Category | 'new' | null; groupsList: string[]; itemCount: number; onClose: () => void }) {
  const { c } = useTheme()
  const labels = useLabels()
  const categories = useList('categories')
  const existing = category && category !== 'new' ? category : undefined

  const [name, setName] = useState('')
  const [group, setGroup] = useState('')
  const [unit, setUnit] = useState('pc')
  const [fractional, setFractional] = useState(false)
  const [step, setStep] = useState('')
  const [minQty, setMinQty] = useState('')
  const [mode, setMode] = useState<'sizes' | 'plain'>('plain')
  const [optionLabel, setOptionLabel] = useState('')
  const [prefix, setPrefix] = useState('')
  const [hsn, setHsn] = useState('')
  const [gst, setGst] = useState('')
  const [track, setTrack] = useState(true)
  const [noDisc, setNoDisc] = useState(false)
  const [reorder, setReorder] = useState('')
  const [tried, setTried] = useState(false)

  useEffect(() => {
    if (!category) return
    const cfg: CategoryConfig = existing?.config ?? {}
    setTried(false)
    setName(existing?.name ?? ''); setGroup(existing?.group ?? groupsList[0] ?? '')
    setUnit(cfg.unit ?? 'pc'); setFractional(cfg.fractional ?? !!unitPreset(cfg.unit ?? 'pc')?.fractional)
    setStep(cfg.step !== undefined ? String(cfg.step) : ''); setMinQty(cfg.minQty !== undefined ? String(cfg.minQty) : '')
    setMode(cfg.variantMode ?? (existing ? 'plain' : categories[0]?.config?.variantMode ?? 'plain')); setOptionLabel(cfg.optionLabel ?? '')
    setPrefix(cfg.prefix ?? ''); setHsn(cfg.hsn ?? ''); setGst(cfg.gstRate !== undefined ? String(cfg.gstRate) : '')
    setTrack(cfg.trackStock !== false); setNoDisc(!!cfg.noDiscount); setReorder(cfg.reorderLevel !== undefined ? String(cfg.reorderLevel) : '')
  }, [category]) // eslint-disable-line react-hooks/exhaustive-deps

  const nameError = !name.trim() ? 'Give the category a name' : null
  const gstBad = gst.trim() !== '' && (Number(gst) < 0 || Number(gst) > 100)

  function save() {
    setTried(true)
    if (nameError || gstBad) return
    const config: CategoryConfig = {
      unit, fractional: fractional !== !!unitPreset(unit)?.fractional ? fractional : undefined,
      step: fractional && Number(step) > 0 ? Number(step) : undefined, minQty: fractional && Number(minQty) > 0 ? Number(minQty) : undefined,
      variantMode: mode, optionLabel: mode === 'plain' && optionLabel.trim() ? optionLabel.trim() : undefined,
      prefix: prefix.trim() || undefined, hsn: hsn.trim() || undefined, gstRate: gst.trim() === '' ? undefined : Number(gst),
      trackStock: track ? undefined : false, noDiscount: noDisc || undefined, reorderLevel: track && reorder !== '' ? Number(reorder) : undefined,
    }
    const clean = Object.fromEntries(Object.entries(config).filter(([, v]) => v !== undefined)) as CategoryConfig
    try {
      perform((s, ctx) => saveCategory(s, { id: existing?.id, name, group: group.trim(), config: clean }, ctx))
      toast(existing ? 'Category saved' : 'Category added', 'ok')
      onClose()
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not save the category', 'err') }
  }

  async function remove() {
    if (!existing) return
    if (itemCount > 0) { toast(`Move or delete its ${itemCount} ${labels.items.toLowerCase()} first`, 'err'); return }
    if (!(await ask({ title: `Delete ${existing.name}?`, message: 'The category is removed. This cannot be undone.', confirm: 'Delete', danger: true }))) return
    try {
      perform((s) => deleteCategory(s, existing.id))
      toast('Category deleted', 'ok')
      onClose()
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not delete the category', 'err') }
  }

  return (
    <Sheet visible={!!category} onClose={onClose} full title={existing ? existing.name : 'New category'} subtitle={existing ? `${itemCount} ${itemCount === 1 ? labels.item.toLowerCase() : labels.items.toLowerCase()}` : undefined}
      footer={<Button label={existing ? 'Save category' : 'Add category'} size="lg" block onPress={save} />}>
      <View style={{ gap: 14, paddingBottom: 8 }}>
        <Field label="Name" value={name} onChangeText={setName} autoCapitalize="words" placeholder="e.g. Kurtas" error={tried ? nameError : null} />
        <View>
          <Field label="Group" value={group} onChangeText={setGroup} autoCapitalize="words" placeholder="e.g. Women" hint="Categories are listed under their group" />
          {groupsList.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
              {groupsList.map((g) => <Chip key={g} label={g} selected={group === g} onPress={() => setGroup(g)} />)}
            </View>
          ) : null}
        </View>

        <T v="label" tone="soft" style={{ marginTop: 6 }}>HOW IT IS SOLD</T>
        <Select<string> label="Sold by" value={unit} options={UNIT_PRESETS.map((u) => ({ value: u.code, label: u.label }))} onChange={(u) => { setUnit(u); setFractional(!!unitPreset(u)?.fractional) }} />
        <Card padded={false}>
          <SwitchRow title="Allow fractions" subtitle="e.g. 2.5 m of fabric, 0.75 kg of rice" value={fractional} onChange={setFractional} />
          <SwitchRow title="Count in stock" subtitle="Off for services and made-to-order items" value={track} onChange={setTrack} />
          <SwitchRow title="No discounts" subtitle="Item and bill discounts skip these" value={noDisc} onChange={setNoDisc} />
        </Card>
        {fractional ? (
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}><NumberField label="− / + step" value={step} onChange={setStep} decimals placeholder={String(unitPreset(unit)?.step ?? 0.5)} /></View>
            <View style={{ flex: 1 }}><NumberField label="Smallest sale" value={minQty} onChange={setMinQty} decimals placeholder="0.1" /></View>
          </View>
        ) : null}

        <T v="label" tone="soft" style={{ marginTop: 6 }}>OPTIONS</T>
        <Segmented<'sizes' | 'plain'> value={mode} onChange={setMode} options={[{ value: 'sizes', label: `${labels.option1} × ${labels.option2}` }, { value: 'plain', label: 'Single list' }]} />
        {mode === 'plain' ? <Field label="Name for the options (optional)" value={optionLabel} onChangeText={setOptionLabel} placeholder="Types, Designs, Widths…" /> : null}

        <T v="label" tone="soft" style={{ marginTop: 6 }}>CODES & TAX</T>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}><Field label="Code prefix" value={prefix} onChangeText={(t) => setPrefix(t.toUpperCase())} autoCapitalize="characters" maxLength={5} mono placeholder="KU" /></View>
          <View style={{ flex: 1 }}><NumberField label="HSN code" value={hsn} onChange={setHsn} /></View>
        </View>
        <NumberField label="Fixed GST % (optional)" value={gst} onChange={setGst} decimals suffix="%" hint="Leave empty to use the price slabs from Tax & GST" error={tried && gstBad ? 'Between 0 and 100' : null} />
        {track ? <NumberField label="Low-stock level for new items" value={reorder} onChange={setReorder} decimals={fractional} /> : null}

        {existing ? (
          <View style={{ marginTop: 8 }}>
            <Button label="Delete category" kind="danger" block icon={<Trash size={18} color={c.danger} />} onPress={remove} />
            {itemCount > 0 ? <T v="caption" tone="mute" style={{ marginTop: 8 }}>A category with {labels.items.toLowerCase()} in it cannot be deleted.</T> : null}
          </View>
        ) : null}
        <T v="caption" tone="mute">These rules are copied onto each new {labels.item.toLowerCase()}. Changing them later never alters existing ones.</T>
      </View>
    </Sheet>
  )
}
