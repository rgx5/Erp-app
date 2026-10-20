import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { variantLabel } from '@/domain/codes'
import { useList, useVariantViews } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { perform, useCan } from '@/data/store'
import { deleteBreakRule, saveBreakRule } from '@/modules/pricing/ops'
import { describeBreaks } from '@/modules/pricing/prices'
import type { BreakTarget, QtyBreak, QtyBreakRule } from '@/modules/pricing/types'
import { Button, IconButton } from '@/ui/Button'
import { Field, MoneyField, NumberField, Segmented, Select, SwitchRow } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Badge, Card } from '@/ui/primitives'
import { EmptyState, ListRow } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Layers, Plus, Trash } from '@/ui/icons'
import { ask, toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

interface Step { minQty: string; kind: 'pct' | 'price'; value: string }
const TARGET_LABEL: Record<BreakTarget, string> = { variant: 'One item', product: 'A product (all sizes)', category: 'A category', all: 'Everything' }

/** Quantity breaks: the more a customer buys, the less each costs. */
export default function QuantityBreaks() {
  const { c } = useTheme()
  const can = useCan('pricing')
  const rules = useList('qtyBreakRules')
  const lists = useList('priceLists')
  const products = useList('products')
  const categories = useList('categories')
  const views = useVariantViews()
  const [editing, setEditing] = useState<{ id?: string } | null>(null)
  const [name, setName] = useState('')
  const [target, setTarget] = useState<BreakTarget>('product')
  const [targetId, setTargetId] = useState('')
  const [listId, setListId] = useState('')
  const [active, setActive] = useState(true)
  const [steps, setSteps] = useState<Step[]>([])

  const label = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of products) m.set(`product:${p.id}`, p.name)
    for (const k of categories) m.set(`category:${k.id}`, k.name)
    for (const v of views) m.set(`variant:${v.id}`, `${v.productName}${variantLabel(v.size, v.color) ? ` (${variantLabel(v.size, v.color)})` : ''}`)
    return m
  }, [products, categories, views])

  if (!can) return <Screen title="Quantity breaks" back><T tone="mute">Quantity breaks are for the owner and managers.</T></Screen>

  function start(r?: QtyBreakRule) {
    setEditing({ id: r?.id })
    setName(r?.name ?? ''); setTarget(r?.target ?? 'product'); setTargetId(r?.targetId ?? ''); setListId(r?.listId ?? ''); setActive(r?.active ?? true)
    setSteps(r ? r.breaks.map((b) => ({ minQty: String(b.minQty), kind: b.kind, value: String(b.value) })) : [{ minQty: '6', kind: 'pct', value: '5' }, { minQty: '12', kind: 'pct', value: '10' }])
  }
  function save() {
    const breaks: QtyBreak[] = steps.filter((s) => s.minQty.trim() || s.value.trim()).map((s) => ({ minQty: Number(s.minQty) || 0, kind: s.kind, value: Number(s.value) || 0 }))
    try {
      perform((s, ctx) => saveBreakRule(s, { name, target, targetId, listId, breaks, active }, editing?.id, ctx))
      toast('Rule saved', 'ok'); setEditing(null)
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not save the rule', 'err') }
  }
  async function remove(r: QtyBreakRule) {
    if (!(await ask({ title: `Delete “${r.name}”?`, confirm: 'Delete', danger: true }))) return
    try { perform((s, ctx) => deleteBreakRule(s, r.id, ctx)); setEditing(null) } catch (e) { toast(e instanceof OpError ? e.message : 'Could not delete', 'err') }
  }
  const options = target === 'variant' ? views.map((v) => ({ value: v.id, label: label.get(`variant:${v.id}`) ?? v.sku, sub: v.sku })) : target === 'product' ? products.map((p) => ({ value: p.id, label: p.name })) : categories.map((k) => ({ value: k.id, label: k.name }))

  return (
    <Screen title="Quantity breaks" subtitle={`${rules.length} rules`} back right={<IconButton label="New rule" tone="dark" onPress={() => start()}><Plus size={22} color={c.bg} /></IconButton>}>
      {!rules.length ? (
        <EmptyState icon={<Layers size={26} color={c.primary} />} title="No quantity breaks yet" hint="For example: 6 or more shirts at 5% off, 12 or more at 10% off. It applies by itself at the counter." action="New rule" onAction={() => start()} />
      ) : (
        <Card padded={false}>
          {rules.map((r, i) => (
            <View key={r.id} style={{ borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
              <ListRow title={r.name} subtitle={`${r.target === 'all' ? 'Everything' : label.get(`${r.target}:${r.targetId}`) ?? TARGET_LABEL[r.target]}${r.listId ? ` · ${lists.find((l) => l.id === r.listId)?.name ?? 'a list'} only` : ''}`}
                meta={describeBreaks(r.breaks)} icon={<Layers size={18} color={c.primary} />} badge={r.active ? undefined : <Badge tone="warning">Off</Badge>} onPress={() => start(r)} />
            </View>
          ))}
        </Card>
      )}
      <Sheet visible={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit rule' : 'New quantity break'} full
        footer={<View style={{ gap: 8 }}><Button label="Save rule" size="lg" block onPress={save} />{editing?.id ? <Button label="Delete rule" kind="danger" block onPress={() => { const r = rules.find((x) => x.id === editing.id); if (r) void remove(r) }} /> : null}</View>}>
        <View style={{ gap: 14 }}>
          <Field label="Name" value={name} onChangeText={setName} placeholder="Shirts in bulk" />
          <Select<BreakTarget> label="Applies to" value={target} options={(Object.keys(TARGET_LABEL) as BreakTarget[]).map((t) => ({ value: t, label: TARGET_LABEL[t] }))} onChange={(t) => { setTarget(t); setTargetId('') }} />
          {target !== 'all' ? <Select<string> label={target === 'variant' ? 'Item' : target === 'product' ? 'Product' : 'Category'} value={targetId} options={options} onChange={setTargetId} searchable placeholder="Choose" /> : null}
          <Select<string> label="For customers on" value={listId} options={[{ value: '', label: 'Everyone' }, ...lists.map((l) => ({ value: l.id, label: l.name }))]} onChange={setListId} />
          <T v="caption" tone="mute">The quantity counts everything the rule covers together: a product rule adds up all its sizes, a category rule every item in it. Items marked “no discount” are left out.</T>
          {steps.map((s, i) => (
            <Card key={i} style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-end' }}>
                <View style={{ flex: 1 }}><NumberField label="From quantity" value={s.minQty} onChange={(t) => setSteps(steps.map((x, n) => (n === i ? { ...x, minQty: t } : x)))} decimals /></View>
                <IconButton label="Remove step" tone="ghost" size={40} onPress={() => setSteps(steps.filter((_, n) => n !== i))}><Trash size={18} color={c.inkMute} /></IconButton>
              </View>
              <Segmented compact value={s.kind} options={[{ value: 'pct', label: '% off' }, { value: 'price', label: 'Price each' }]} onChange={(k) => setSteps(steps.map((x, n) => (n === i ? { ...x, kind: k } : x)))} />
              {s.kind === 'pct'
                ? <NumberField label="Percent off" value={s.value} onChange={(t) => setSteps(steps.map((x, n) => (n === i ? { ...x, value: t } : x)))} decimals suffix="%" />
                : <MoneyField label="Price each" value={s.value} onChange={(t) => setSteps(steps.map((x, n) => (n === i ? { ...x, value: t } : x)))} />}
            </Card>
          ))}
          <Button label="Add a step" kind="soft" block icon={<Plus size={18} color={c.primary} />} onPress={() => setSteps([...steps, { minQty: '', kind: 'pct', value: '' }])} />
          <Card padded={false}><SwitchRow title="In use" value={active} onChange={setActive} /></Card>
        </View>
      </Sheet>
    </Screen>
  )
}
