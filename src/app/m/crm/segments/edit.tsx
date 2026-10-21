import React, { useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { perform, useApp, useCan } from '@/data/store'
import { Button } from '@/ui/Button'
import { Field, NumberField, Segmented, Select } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Card, Tap } from '@/ui/primitives'
import { Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Close, Plus } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'
import { saveSegment } from '@/modules/crm/ops'
import { describeRule, segmentProblem } from '@/modules/crm/segments'
import { settingsOf } from '@/modules/crm/settings'
import type { DatePeriod, SegmentRule } from '@/modules/crm/types'
import { failWith } from '@/modules/crm/ui/forms'

type Kind = SegmentRule['kind']
const KINDS: Array<{ value: Kind; label: string; sub: string }> = [
  { value: 'spend', label: 'Spent', sub: 'Total spent, optionally in the last N days' },
  { value: 'orders', label: 'Number of purchases', sub: 'How often they bought' },
  { value: 'recency', label: 'Last bought', sub: 'Days since the last purchase' },
  { value: 'never', label: 'Never bought', sub: 'In the book, no purchase yet' },
  { value: 'birthday', label: 'Birthday', sub: 'Today, this week or this month' },
  { value: 'anniversary', label: 'Anniversary', sub: 'Today, this week or this month' },
  { value: 'tag', label: 'Group', sub: 'In (or not in) a group like VIP' },
  { value: 'tier', label: 'Membership tier', sub: 'Silver, Gold…' },
  { value: 'points', label: 'Loyalty points', sub: 'At least this many' },
  { value: 'dues', label: 'Owes money', sub: 'Outstanding on account' },
  { value: 'joined', label: 'New customer', sub: 'Joined in the last N days' },
]
const WHEN: Array<{ value: DatePeriod; label: string }> = [{ value: 'today', label: 'Today' }, { value: 'week', label: '7 days' }, { value: 'month', label: 'This month' }, { value: 'next-month', label: 'Next month' }]
const num = (s: string) => (s.trim() === '' || !Number.isFinite(Number(s)) ? undefined : Number(s))

/** Make or change a saved segment: a name, all/any, and a list of rules. */
export default function SegmentEdit() {
  const { c } = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id?: string }>()
  const can = useCan('crm')
  const existing = useApp((s) => (id ? s.data.crmSegments?.[id] : undefined))
  const tiers = useApp((s) => settingsOf(s.data).tiers)
  const [name, setName] = useState(existing?.name ?? '')
  const [match, setMatch] = useState<'all' | 'any'>(existing?.match ?? 'all')
  const [rules, setRules] = useState<SegmentRule[]>(existing?.rules ?? [])
  const [note, setNote] = useState(existing?.note ?? '')
  const [adding, setAdding] = useState(false)
  // the rule being built
  const [kind, setKind] = useState<Kind>('spend')
  const [min, setMin] = useState('')
  const [max, setMax] = useState('')
  const [days, setDays] = useState('')
  const [when, setWhen] = useState<DatePeriod>('month')
  const [text, setText] = useState('')
  const [negate, setNegate] = useState(false)

  if (!can) return <Screen title="Segment" back><T tone="mute">Segments are for the owner and managers.</T></Screen>

  function build(): SegmentRule {
    const d = num(days)
    switch (kind) {
      case 'spend': return { kind, ...(num(min) !== undefined ? { min: num(min) } : {}), ...(num(max) !== undefined ? { max: num(max) } : {}), ...(d ? { days: d } : {}) }
      case 'orders': return { kind, ...(num(min) !== undefined ? { min: num(min) } : {}), ...(num(max) !== undefined ? { max: num(max) } : {}), ...(d ? { days: d } : {}) }
      case 'recency': return { kind, ...(num(min) !== undefined ? { minDays: num(min) } : {}), ...(num(max) !== undefined ? { maxDays: num(max) } : {}) }
      case 'birthday': case 'anniversary': return { kind, when }
      case 'tag': return { kind, tag: text.trim(), ...(negate ? { not: true } : {}) }
      case 'tier': return { kind, tier: text.trim() }
      case 'points': return { kind, min: num(min) ?? 0 }
      case 'dues': return { kind, min: num(min) ?? 1 }
      case 'joined': return { kind, withinDays: d ?? 0 }
      default: return { kind: 'never' }
    }
  }
  function addRule() {
    const r = build()
    const p = segmentProblem('x', [r])
    if (p) { toast(p, 'err'); return }
    setRules([...rules, r]); setAdding(false); setMin(''); setMax(''); setDays(''); setText(''); setNegate(false)
  }
  function save() {
    try {
      perform((s, ctx) => saveSegment(s, { name, match, rules, note }, id, ctx))
      toast('Segment saved', 'ok'); router.back()
    } catch (e) { failWith(e) }
  }

  const minMax = kind === 'spend' || kind === 'orders' || kind === 'recency'
  return (
    <Screen title={existing ? 'Edit segment' : 'New segment'} back footer={<Button label="Save segment" size="lg" block onPress={save} />}>
      <View style={{ gap: 14, paddingBottom: 12 }}>
        <Field label="Name" value={name} onChangeText={setName} autoCapitalize="words" placeholder="Wholesale regulars" />
        <Segmented value={match} onChange={setMatch} options={[{ value: 'all', label: 'Match all rules' }, { value: 'any', label: 'Match any rule' }]} />
        <Section title="Rules" action="Add rule" onAction={() => setAdding(true)} style={{ marginTop: 0 }}>
          {rules.length ? rules.map((r, i) => (
            <Card key={i} style={{ marginBottom: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <T style={{ flex: 1 }}>{describeRule(r)}</T>
                <Tap onPress={() => setRules(rules.filter((_, j) => j !== i))} hitSlop={8} accessibilityLabel="Remove rule"><Close size={18} color={c.inkMute} /></Tap>
              </View>
            </Card>
          )) : <Button label="Add the first rule" kind="soft" icon={<Plus size={16} color={c.primary} />} onPress={() => setAdding(true)} />}
        </Section>
        <Field label="Note (optional)" value={note} onChangeText={setNote} autoCapitalize="sentences" />
      </View>
      <Sheet visible={adding} onClose={() => setAdding(false)} title="Add a rule" full footer={<Button label="Add rule" size="lg" block onPress={addRule} />}>
        <View style={{ gap: 14, paddingBottom: 8 }}>
          <Select label="Customers who…" value={kind} options={KINDS} onChange={setKind} />
          {minMax ? (
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}><NumberField label={kind === 'recency' ? 'At least (days)' : 'At least'} value={min} onChange={setMin} decimals={kind === 'spend'} /></View>
              <View style={{ flex: 1 }}><NumberField label={kind === 'recency' ? 'At most (days)' : 'At most'} value={max} onChange={setMax} decimals={kind === 'spend'} /></View>
            </View>
          ) : null}
          {kind === 'spend' || kind === 'orders' ? <NumberField label="In the last … days (empty = ever)" value={days} onChange={setDays} /> : null}
          {kind === 'joined' ? <NumberField label="Joined in the last … days" value={days} onChange={setDays} /> : null}
          {kind === 'points' || kind === 'dues' ? <NumberField label={kind === 'points' ? 'At least … points' : 'Owes at least ₹'} value={min} onChange={setMin} /> : null}
          {kind === 'birthday' || kind === 'anniversary' ? <Segmented value={when} onChange={setWhen} options={WHEN} /> : null}
          {kind === 'tag' ? (
            <View style={{ gap: 12 }}>
              <Field label="Group name" value={text} onChangeText={setText} autoCapitalize="words" placeholder="VIP" />
              <Segmented value={negate ? 'not' : 'in'} onChange={(v) => setNegate(v === 'not')} options={[{ value: 'in', label: 'Is in the group' }, { value: 'not', label: 'Is not in it' }]} />
            </View>
          ) : null}
          {kind === 'tier' ? <Select label="Tier" value={text} options={tiers.map((t) => ({ value: t.name, label: t.name }))} onChange={setText} /> : null}
        </View>
      </Sheet>
    </Screen>
  )
}
