import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { inr } from '@/domain/money'
import { OpError, type OpCtx } from '@/data/ops'
import type { Changes, DataState } from '@/data/state'
import { perform, useApp, useCan } from '@/data/store'
import { costRecipe, itemName, stockUnitOf } from '@/modules/manufacturing/bom'
import { deleteRecipe, saveRecipe, setRecipeActive } from '@/modules/manufacturing/ops'
import { unitChoices } from '@/modules/manufacturing/units'
import type { Recipe, RecipeLine } from '@/modules/manufacturing/types'
import { ItemPicker } from '@/features/ItemPicker'
import { Button, IconButton } from '@/ui/Button'
import { Field, MoneyField, NumberField, SwitchRow } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Card, Chip } from '@/ui/primitives'
import { KV, Notice, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Plus, Trash } from '@/ui/icons'
import { ask, toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

interface L { variantId: string; qty: string; unit: string; wastage: string; customerSupplied: boolean; buy: boolean }
interface Chk { label: string; critical: boolean }

/** Create or edit a recipe; the cost underneath is worked out live from today's item costs, all the way down. */
export default function EditRecipe() {
  const { c } = useTheme()
  const router = useRouter()
  const { id: editId } = useLocalSearchParams<{ id?: string }>()
  const can = useCan('manufacturing')
  const data = useApp((s) => s.data)
  const existing = editId ? data.recipes[editId] : undefined
  const [name, setName] = useState(existing?.name ?? '')
  const [out, setOut] = useState(existing?.outputVariantId ?? '')
  const [outQty, setOutQty] = useState(existing ? String(existing.outputQty) : '1')
  const [yieldPct, setYieldPct] = useState(existing ? String(existing.yieldPct) : '100')
  const [lines, setLines] = useState<L[]>(existing?.lines.map((l) => ({ variantId: l.variantId, qty: String(l.qty), unit: l.unit ?? stockUnitOf(data, l.variantId), wastage: String(l.wastagePct), customerSupplied: !!l.customerSupplied, buy: !!l.buy })) ?? [])
  const [labour, setLabour] = useState(existing ? String(existing.labourPerBatch) : '')
  const [overhead, setOverhead] = useState(existing ? String(existing.overheadPerBatch) : '')
  const [checks, setChecks] = useState<Chk[]>(existing?.checklist.map((x) => ({ label: x.label, critical: !!x.critical })) ?? [])
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [picking, setPicking] = useState<'out' | 'line' | null>(null)
  const [busy, setBusy] = useState(false)

  const draft = useMemo(() => ({
    name, outputVariantId: out, outputQty: Number(outQty) || 0, yieldPct: Number(yieldPct) || 0,
    lines: lines.map((l): RecipeLine => ({ variantId: l.variantId, qty: Number(l.qty) || 0, unit: l.unit, wastagePct: Number(l.wastage) || 0, ...(l.customerSupplied ? { customerSupplied: true } : {}), ...(l.buy ? { buy: true } : {}) })),
    labourPerBatch: Number(labour) || 0, overheadPerBatch: Number(overhead) || 0, checklist: checks.map((x) => ({ label: x.label, critical: x.critical })), notes,
  }), [name, out, outQty, yieldPct, lines, labour, overhead, checks, notes])
  const cost = useMemo(() => {
    if (!out || !draft.lines.length || !(draft.outputQty > 0) || !(draft.yieldPct > 0)) return null
    const r: Recipe = { id: existing?.id ?? 'draft', code: existing?.code ?? 'R-NEW', active: true, createdAt: 0, updatedAt: Date.now(), ...draft, lines: draft.lines.filter((l) => l.qty > 0), checklist: [] }
    return costRecipe(data, r)
  }, [data, draft, out, existing])
  const price = out ? data.variants[out]?.price ?? 0 : 0

  if (!can) return <Screen title="Recipe" back><T tone="mute">Recipes and costs are for the owner and managers.</T></Screen>

  const patch = (variantId: string, p: Partial<L>) => setLines(lines.map((x) => (x.variantId === variantId ? { ...x, ...p } : x)))
  function save() {
    setBusy(true)
    try {
      const r = perform((s, ctx) => saveRecipe(s, { ...draft, active: existing?.active }, existing?.id, ctx))
      toast(`${r.recipe.code} saved`, 'ok')
      router.back()
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not save the recipe', 'err'); setBusy(false) }
  }
  const run = (fn: (s: DataState, ctx: OpCtx) => { changes: Changes }, done: string) => { try { perform(fn); toast(done, 'ok'); router.back() } catch (e) { toast(e instanceof OpError ? e.message : 'Could not do that', 'err') } }

  return (
    <Screen title={existing ? existing.code : 'New recipe'} back footer={<Button label="Save recipe" size="lg" block loading={busy} onPress={save} />}>
      <View style={{ gap: 14, paddingBottom: 14 }}>
        <Field label="Recipe name" value={name} onChangeText={setName} placeholder="e.g. Chocolate cake" />
        <View style={{ gap: 6 }}>
          <T v="label" tone="mute">Makes</T>
          <Button label={out ? itemName(data, out) : 'Choose the item'} kind="soft" block onPress={() => setPicking('out')} />
        </View>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}><NumberField label="One batch makes" value={outQty} onChange={setOutQty} decimals suffix={out ? stockUnitOf(data, out) : undefined} /></View>
          <View style={{ flex: 1 }}><NumberField label="Yield %" value={yieldPct} onChange={setYieldPct} decimals hint="Good units ÷ units made" /></View>
        </View>

        <Section title="Ingredients & parts">
          <View style={{ gap: 10 }}>
            {lines.map((l) => (
              <Card key={l.variantId} style={{ gap: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <T v="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>{itemName(data, l.variantId)}</T>
                  <IconButton label="Remove" tone="ghost" size={36} onPress={() => setLines(lines.filter((x) => x.variantId !== l.variantId))}><Trash size={18} color={c.inkMute} /></IconButton>
                </View>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <View style={{ flex: 1 }}><NumberField label="Per batch" value={l.qty} onChange={(t) => patch(l.variantId, { qty: t })} decimals /></View>
                  <View style={{ flex: 1 }}><NumberField label="Wastage %" value={l.wastage} onChange={(t) => patch(l.variantId, { wastage: t })} decimals /></View>
                </View>
                {unitChoices(stockUnitOf(data, l.variantId)).length > 1 ? (
                  <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                    {unitChoices(stockUnitOf(data, l.variantId)).map((u) => <Chip key={u} label={u} selected={l.unit === u} onPress={() => patch(l.variantId, { unit: u })} />)}
                  </View>
                ) : <T v="caption" tone="mute">Counted in {l.unit}</T>}
                <SwitchRow title="Customer brings this" subtitle="Job work: not our stock, not in our cost" value={l.customerSupplied} onChange={(v) => patch(l.variantId, { customerSupplied: v })} />
                <SwitchRow title="Buy it, do not make it" subtitle="Cost at stock cost even if it has a recipe" value={l.buy} onChange={(v) => patch(l.variantId, { buy: v })} />
              </Card>
            ))}
            <Button label="Add ingredient or part" kind="soft" block icon={<Plus size={18} color={c.primary} />} onPress={() => setPicking('line')} />
          </View>
        </Section>

        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}><MoneyField label="Labour per batch" value={labour} onChange={setLabour} /></View>
          <View style={{ flex: 1 }}><MoneyField label="Overhead per batch" value={overhead} onChange={setOverhead} /></View>
        </View>

        <Section title="Quality checklist">
          <View style={{ gap: 10 }}>
            {checks.map((x, i) => (
              <Card key={i} style={{ gap: 8 }}>
                <Field label={`Point ${i + 1}`} value={x.label} onChangeText={(t) => setChecks(checks.map((y, j) => (j === i ? { ...y, label: t } : y)))} />
                <SwitchRow title="Critical" subtitle="Failing it rejects the whole lot" value={x.critical} onChange={(v) => setChecks(checks.map((y, j) => (j === i ? { ...y, critical: v } : y)))} />
                <Button label="Remove" kind="ghost" onPress={() => setChecks(checks.filter((_, j) => j !== i))} />
              </Card>
            ))}
            <Button label="Add a check point" kind="soft" block icon={<Plus size={18} color={c.primary} />} onPress={() => setChecks([...checks, { label: '', critical: false }])} />
          </View>
        </Section>
        <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline />

        {cost ? (
          <Section title="Cost now">
            <Card style={{ gap: 4 }}>
              <KV k="Materials" v={inr(cost.materials)} />
              <KV k="Labour" v={inr(cost.labour)} />
              <KV k="Overhead" v={inr(cost.overhead)} />
              <KV k="One batch" v={inr(cost.total)} strong />
              <KV k="Per unit" v={inr(cost.perUnit)} strong sub={price > 0 ? `Sells at ${inr(price)} · margin ${Math.round(((price - cost.perUnit) / price) * 100)}%` : undefined} />
            </Card>
            {cost.warnings.map((w) => <Notice key={w} title={w} />)}
          </Section>
        ) : null}

        {existing ? (
          <Section title="Manage">
            <View style={{ gap: 10 }}>
              <Button label={existing.active ? 'Switch off' : 'Switch on'} kind="outline" block onPress={() => run((s, ctx) => setRecipeActive(s, existing.id, !existing.active, ctx), 'Done')} />
              <Button label="Delete recipe" kind="danger" block onPress={async () => { if (await ask({ title: 'Delete this recipe?', confirm: 'Delete', cancel: 'Keep' })) run((s, ctx) => deleteRecipe(s, existing.id, ctx), 'Deleted') }} />
            </View>
          </Section>
        ) : null}
      </View>
      <ItemPicker visible={!!picking} onClose={() => setPicking(null)} title={picking === 'out' ? 'What does it make?' : 'Add an ingredient or part'}
        onPick={(v) => {
          if (picking === 'out') setOut(v.id)
          else setLines((cur) => (cur.some((x) => x.variantId === v.id) ? cur : [...cur, { variantId: v.id, qty: '1', unit: stockUnitOf(data, v.id), wastage: '0', customerSupplied: false, buy: false }]))
        }} picked={new Set(lines.map((l) => l.variantId))} />
    </Screen>
  )
}
