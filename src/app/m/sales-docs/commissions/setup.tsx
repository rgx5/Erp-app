import React, { useState } from 'react'
import { View } from 'react-native'
import { fmtMonth, fromInputDate } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useList } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { perform, useCan } from '@/data/store'
import { deleteCommissionRule, deleteSalesTarget, saveCommissionRule, saveSalesTarget, type RuleDraft } from '@/modules/sales-docs/ops'
import type { CommissionRule } from '@/modules/sales-docs/types'
import { Button } from '@/ui/Button'
import { Field, MoneyField, NumberField, Segmented, Select, SwitchRow } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Badge, Card } from '@/ui/primitives'
import { ListRow, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Plus, Target } from '@/ui/icons'
import { ask, toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

const describe = (r: CommissionRule) => `${r.basis === 'pct' ? `${r.rate}% of sales` : `${inr(r.rate)} per piece`}${r.slabs?.length ? ` · ${r.slabs.length} slab${r.slabs.length === 1 ? '' : 's'}` : ''}`
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }

/** Commission rules (who earns what, on what) and the monthly sales targets. */
export default function CommissionSetup() {
  const { c } = useTheme()
  const can = useCan('salesDocs')
  const rules = useList('commissionRules')
  const targets = useList('salesTargets')
  const users = useList('users').filter((u) => u.active)
  const categories = useList('categories')
  const products = useList('products')

  const [rule, setRule] = useState<(RuleDraft & { id?: string }) | null>(null)
  const [rate, setRate] = useState('')
  const [slab, setSlab] = useState('')
  const [slabRate, setSlabRate] = useState('')
  const [tgt, setTgt] = useState(false)
  const [tStaff, setTStaff] = useState('')
  const [tMonth, setTMonth] = useState(thisMonth())
  const [tAmount, setTAmount] = useState('')

  if (!can) return <Screen title="Commission rules" back><T tone="mute">Commissions and targets are for the owner and managers.</T></Screen>
  const userName = (id: string) => users.find((u) => u.id === id)?.name ?? 'Former staff'

  function edit(r?: CommissionRule) {
    setRule(r ? { ...r } : { name: '', staffId: '', scope: 'all', basis: 'pct', rate: 0, active: true })
    setRate(r ? String(r.rate) : ''); setSlab(r?.slabs?.[0] ? String(r.slabs[0].minAchievementPct) : ''); setSlabRate(r?.slabs?.[0] ? String(r.slabs[0].rate) : '')
  }
  function saveRule() {
    if (!rule) return
    try {
      const { id, ...draft } = rule
      const slabs = rule.basis === 'pct' && Number(slab) > 0 && Number(slabRate) > 0 ? [{ minAchievementPct: Number(slab), rate: Number(slabRate) }] : undefined
      perform((s, ctx) => saveCommissionRule(s, { ...draft, rate: Number(rate) || 0, slabs }, id, ctx))
      setRule(null); toast('Rule saved', 'ok')
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not save the rule', 'err') }
  }
  async function removeRule() {
    if (!rule?.id || !(await ask({ title: 'Delete this rule?', confirm: 'Delete', danger: true }))) return
    try { perform((s, ctx) => deleteCommissionRule(s, rule.id!, ctx)); setRule(null) } catch (e) { toast(e instanceof OpError ? e.message : 'Could not delete', 'err') }
  }
  function saveTarget() {
    try {
      perform((s, ctx) => saveSalesTarget(s, { staffId: tStaff, month: tMonth, amount: Number(tAmount) || 0 }, ctx))
      setTgt(false); toast('Target saved', 'ok')
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not save the target', 'err') }
  }
  async function removeTarget(id: string) {
    if (!(await ask({ title: 'Remove this target?', confirm: 'Remove', danger: true }))) return
    try { perform((s, ctx) => deleteSalesTarget(s, id, ctx)) } catch (e) { toast(e instanceof OpError ? e.message : 'Could not remove', 'err') }
  }

  return (
    <Screen title="Commission rules" subtitle="Rules and monthly targets" back>
      <View style={{ gap: 18, paddingBottom: 20 }}>
        <Section title="Rules" action="Add" onAction={() => edit()}>
          <Card padded={false}>
            {rules.length === 0 ? <T tone="mute" style={{ padding: 16 }}>No rules yet. A rule says who earns what: a percentage of sales, or a rupee amount per piece, for everything, a category or one item.</T> : null}
            {rules.map((r) => (
              <ListRow key={r.id} title={r.name} subtitle={`${r.staffId ? userName(r.staffId) : 'Everyone'} · ${r.scope === 'all' ? 'all items' : r.scope === 'category' ? categories.find((x) => x.id === r.categoryId)?.name ?? 'category' : products.find((x) => x.id === r.productId)?.name ?? 'item'}`}
                value={describe(r).split(' · ')[0]} badge={r.active ? undefined : <Badge>Off</Badge>} onPress={() => edit(r)} />
            ))}
          </Card>
        </Section>
        <Section title="Monthly targets" action="Set a target" onAction={() => { setTStaff(users[0]?.id ?? ''); setTMonth(thisMonth()); setTAmount(''); setTgt(true) }}>
          <Card padded={false}>
            {targets.length === 0 ? <T tone="mute" style={{ padding: 16 }}>No targets yet. A target lets slab rates pay more once it is beaten.</T> : null}
            {[...targets].sort((a, b) => b.month.localeCompare(a.month)).map((t) => (
              <ListRow key={t.id} icon={<Target size={18} color={c.primary} />} title={userName(t.staffId)} subtitle={fmtMonth(fromInputDate(`${t.month}-15`))} value={inr(t.amount, 0)} onPress={() => removeTarget(t.id)} chevron={false} />
            ))}
          </Card>
        </Section>
      </View>

      <Sheet visible={!!rule} onClose={() => setRule(null)} title={rule?.id ? 'Edit rule' : 'New rule'} full
        footer={<View style={{ gap: 10 }}><Button label="Save rule" size="lg" block icon={<Plus size={18} color={c.onPrimary} />} onPress={saveRule} />{rule?.id ? <Button label="Delete rule" kind="danger" block onPress={removeRule} /> : null}</View>}>
        {rule ? (
          <View style={{ gap: 14 }}>
            <Field label="Name" value={rule.name} onChangeText={(t) => setRule({ ...rule, name: t })} placeholder="e.g. Shirts 3%" />
            <Select<string> label="Who earns it" value={rule.staffId || 'all'} options={[{ value: 'all', label: 'Everyone' }, ...users.map((u) => ({ value: u.id, label: u.name }))]} onChange={(v) => setRule({ ...rule, staffId: v === 'all' ? '' : v })} />
            <Segmented<CommissionRule['scope']> value={rule.scope} options={[{ value: 'all', label: 'Everything' }, { value: 'category', label: 'Category' }, { value: 'item', label: 'One item' }]} onChange={(v) => setRule({ ...rule, scope: v })} />
            {rule.scope === 'category' ? <Select<string> label="Category" value={rule.categoryId ?? ''} searchable options={categories.map((x) => ({ value: x.id, label: x.name }))} onChange={(v) => setRule({ ...rule, categoryId: v })} /> : null}
            {rule.scope === 'item' ? <Select<string> label="Item" value={rule.productId ?? ''} searchable options={products.map((x) => ({ value: x.id, label: x.name }))} onChange={(v) => setRule({ ...rule, productId: v })} /> : null}
            <Segmented<CommissionRule['basis']> value={rule.basis} options={[{ value: 'pct', label: '% of sales' }, { value: 'per_piece', label: '₹ per piece' }]} onChange={(v) => setRule({ ...rule, basis: v })} />
            <MoneyField label={rule.basis === 'pct' ? 'Rate (%)' : 'Amount per piece'} value={rate} onChange={setRate} />
            {rule.basis === 'pct' ? (
              <View style={{ gap: 8 }}>
                <T v="label" tone="soft">HIGHER RATE FOR BEATING THE TARGET (OPTIONAL)</T>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <View style={{ flex: 1 }}><NumberField label="From % of target" value={slab} onChange={setSlab} decimals /></View>
                  <View style={{ flex: 1 }}><MoneyField label="New rate (%)" value={slabRate} onChange={setSlabRate} /></View>
                </View>
              </View>
            ) : null}
            <Card padded={false}><SwitchRow title="Active" value={rule.active} onChange={(v) => setRule({ ...rule, active: v })} /></Card>
          </View>
        ) : null}
      </Sheet>

      <Sheet visible={tgt} onClose={() => setTgt(false)} title="Monthly target" footer={<Button label="Save target" size="lg" block onPress={saveTarget} />}>
        <View style={{ gap: 14 }}>
          <Select<string> label="Salesperson" value={tStaff} options={users.map((u) => ({ value: u.id, label: u.name }))} onChange={setTStaff} />
          <Field label="Month" value={tMonth} onChangeText={setTMonth} placeholder="YYYY-MM" autoCapitalize="none" />
          <MoneyField label="Sales target (excl. GST)" value={tAmount} onChange={setTAmount} />
        </View>
      </Sheet>
    </Screen>
  )
}
