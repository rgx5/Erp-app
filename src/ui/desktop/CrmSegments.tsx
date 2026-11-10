import React, { useMemo, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useApp, useCan } from '@/data/store'
import { listOf } from '@/data/state'
import { defOf, describeRule, describeSegment, matchCtx, matchesSegment, PRESET_SEGMENTS, segmentProblem } from '@/modules/crm/segments'
import type { CustomerSegment, DatePeriod, SegmentRule } from '@/modules/crm/types'
import { Button } from '@/ui/Button'
import { Field, NumberField, Segmented, Select } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { T } from '@/ui/Text'
import { toast } from '@/ui/overlays'
import { Close, Download, Megaphone, Pencil, Plus, Trash, Users } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { DeskButton, DeskPage, dtext, KpiStrip, KpiTile, Pill, Toolbar } from './kit'
import { DesktopSettingsPage } from './SettingsPage'

type Row = { id: string; name: string; sub: string; n: number }

/**
 * The desktop Segments & groups screen: a KPI strip for the customer total, then "Your segments" and "Ready-made"
 * as two dense sortable grids instead of two scrolling `ListRow` sections. Reads its own data directly, exactly
 * like `DesktopPurchases`: every count comes from the same `matchesSegment`/`PRESET_SEGMENTS` the phone
 * `m/crm/segments/index.tsx` calls.
 */
export function DesktopSegments() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('customers')
  const manage = useCan('crm')
  const data = useApp((s) => s.data)
  const now = Date.now()
  const rows = useMemo(() => {
    const m = matchCtx(data, now)
    const customers = listOf(data.customers)
    const count = (def: ReturnType<typeof defOf> | { match: 'all' | 'any'; rules: never[] }) => customers.filter((x) => matchesSegment(x, def, m)).length
    return {
      presets: PRESET_SEGMENTS.map((p) => ({ id: p.id, name: p.name, sub: p.note, n: count(p) })),
      mine: listOf(data.crmSegments ?? {}).sort((a, b) => a.name.localeCompare(b.name)).map((s) => ({ id: s.id, name: s.name, sub: describeSegment(s), n: count(defOf(s)) })),
      all: customers.length,
    }
  }, [data, now])

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Segments & groups" />}>
        <View style={{ padding: 20 }}><T tone="mute">Segments are for people who use the billing counter.</T></View>
      </DeskPage>
    )
  }
  const open = (id: string) => router.push({ pathname: '/m/crm/segments/[id]', params: { id } })

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title="Segments & groups"
          subtitle={`${rows.all} customers`}
          right={manage ? <DeskButton label="New segment" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={() => router.push('/m/crm/segments/edit')} /> : undefined}
        />
      }
    >
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 16 }}>
        <SegmentTable title="Your segments" rows={rows.mine} onOpen={open} empty={manage ? 'Make your own with “New segment”: for example “spent over ₹5,000 and in group Wholesale”.' : 'Your manager can make segments of their own here.'} />
        <SegmentTable title="Ready-made" rows={rows.presets} onOpen={open} empty="None" />
      </ScrollView>
    </DeskPage>
  )
}

function SegmentTable({ title, rows, onOpen, empty }: { title: string; rows: Row[]; onOpen: (id: string) => void; empty: string }) {
  const { c } = useTheme()
  return (
    <View style={{ gap: 8 }}>
      <T style={[dtext.label, { color: c.inkMute }]}>{title}</T>
      <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        {rows.length ? rows.map((r, i) => (
          <SegmentRow key={r.id} row={r} zebra={i % 2 === 1} onPress={() => onOpen(r.id)} />
        )) : <View style={{ padding: 16 }}><T style={[dtext.cell, { color: c.inkMute }]}>{empty}</T></View>}
      </View>
    </View>
  )
}

function SegmentRow({ row, zebra, onPress }: { row: Row; zebra: boolean; onPress: () => void }) {
  const { c } = useTheme()
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', height: 44, paddingHorizontal: 12, gap: 10, backgroundColor: zebra ? c.surfaceAlt : 'transparent', borderBottomWidth: 1, borderBottomColor: c.line }}>
      <View style={{ flex: 1, gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{row.name}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{row.sub}</T>
      </View>
      <Pill label={`${row.n} customers`} />
    </Pressable>
  )
}

// ───────────────────────────── segments/[id].tsx ─────────────────────────────

export interface SegmentMember { id: string; name: string; phone: string; optOutMarketing?: boolean }
export interface DesktopSegmentViewProps {
  id: string
  name: string
  description: string
  custom: boolean
  manage: boolean
  count: number
  reachable: number
  spend: number
  members: Array<SegmentMember & { spend: number; lastAt: number | null }>
  onExport: () => void
  onDelete: () => void
}

/** The desktop segment-detail screen: a KPI strip, the member list as a dense grid, and the same actions (message, export, edit, delete) as the phone screen's button row. */
export function DesktopSegmentView(p: DesktopSegmentViewProps) {
  const { c } = useTheme()
  const router = useRouter()

  return (
    <DeskPage toolbar={<Toolbar title={p.name} subtitle={p.description} />}>
      <KpiStrip>
        <KpiTile label="Customers" value={String(p.count)} tone="primary" />
        <KpiTile label="Can be messaged" value={String(p.reachable)} delta="Valid mobile number, not opted out" />
        <KpiTile label="Spent so far" value={inr(p.spend, 0)} />
      </KpiStrip>

      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10, flexWrap: 'wrap' }}>
        {p.manage ? <DeskButton label="Send a message" tone="primary" icon={<Megaphone size={14} color={c.onPrimary} />} onPress={() => router.push({ pathname: '/m/crm/campaigns/new', params: { audience: p.id } })} /> : null}
        <DeskButton label="Export" icon={<Download size={14} color={c.ink} />} onPress={p.onExport} />
        {p.manage && p.custom ? <DeskButton label="Edit" icon={<Pencil size={14} color={c.ink} />} onPress={() => router.push({ pathname: '/m/crm/segments/edit', params: { id: p.id } })} /> : null}
        {p.manage && p.custom ? <DeskButton label="Delete" tone="danger" icon={<Trash size={14} color={c.danger} />} onPress={p.onDelete} /> : null}
      </View>

      <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        {p.members.length ? (
          <ScrollView style={{ flex: 1 }}>
            {p.members.slice(0, 200).map((m, i) => (
              <Pressable key={m.id} onPress={() => router.push({ pathname: '/m/crm/customer/[id]', params: { id: m.id } })} style={{ flexDirection: 'row', alignItems: 'center', height: 40, paddingHorizontal: 12, gap: 10, backgroundColor: i % 2 ? c.surfaceAlt : 'transparent', borderBottomWidth: 1, borderBottomColor: c.line }}>
                <View style={{ flex: 1, gap: 1 }}>
                  <T style={dtext.cellStrong} numberOfLines={1}>{m.name}</T>
                  <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{m.phone || 'No phone'}{m.lastAt !== null ? ` · last ${fmtDayShort(m.lastAt)}` : ' · never bought'}</T>
                </View>
                {m.optOutMarketing ? <Pill tone="warning" label="No promos" /> : null}
                <T style={dtext.num}>{inr(m.spend, 0)}</T>
              </Pressable>
            ))}
            {p.members.length > 200 ? <View style={{ padding: 10 }}><T style={[dtext.tiny, { color: c.inkMute }]}>Showing the first 200. Export for the full list.</T></View> : null}
          </ScrollView>
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Users size={24} color={c.inkMute} />
            <T style={[dtext.cell, { color: c.inkMute }]}>No one matches right now.</T>
          </View>
        )}
      </View>
    </DeskPage>
  )
}

// ───────────────────────────── segments/edit.tsx ─────────────────────────────

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

export interface DesktopSegmentEditProps {
  existing?: CustomerSegment
  name: string; setName: (v: string) => void
  match: 'all' | 'any'; setMatch: (v: 'all' | 'any') => void
  rules: SegmentRule[]; setRules: (v: SegmentRule[]) => void
  note: string; setNote: (v: string) => void
  tiers: Array<{ name: string }>
  onSave: () => void
}

/** The desktop add/edit-segment form: the same centred-column shell, the rules list and the "add a rule" sheet. */
export function DesktopSegmentEdit(p: DesktopSegmentEditProps) {
  const { c } = useTheme()
  const [adding, setAdding] = useState(false)
  const [kind, setKind] = useState<Kind>('spend')
  const [min, setMin] = useState('')
  const [max, setMax] = useState('')
  const [days, setDays] = useState('')
  const [when, setWhen] = useState<DatePeriod>('month')
  const [text, setText] = useState('')
  const [negate, setNegate] = useState(false)

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
    const problem = segmentProblem('x', [r])
    if (problem) { toast(problem, 'err'); return }
    p.setRules([...p.rules, r])
    setAdding(false); setMin(''); setMax(''); setDays(''); setText(''); setNegate(false)
  }
  const minMax = kind === 'spend' || kind === 'orders' || kind === 'recency'

  return (
    <DesktopSettingsPage title={p.existing ? 'Edit segment' : 'New segment'} right={<DeskButton label="Save segment" tone="primary" onPress={p.onSave} />}>
      <View style={{ gap: 14 }}>
        <Field label="Name" value={p.name} onChangeText={p.setName} autoCapitalize="words" placeholder="Wholesale regulars" />
        <Segmented value={p.match} onChange={p.setMatch} options={[{ value: 'all', label: 'Match all rules' }, { value: 'any', label: 'Match any rule' }]} />
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <T style={[dtext.label, { color: c.inkMute }]}>Rules</T>
            <DeskButton label="Add rule" icon={<Plus size={13} color={c.ink} />} onPress={() => setAdding(true)} />
          </View>
          {p.rules.length ? p.rules.map((r, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 12 }}>
              <T style={{ flex: 1 }}>{describeRule(r)}</T>
              <Pressable onPress={() => p.setRules(p.rules.filter((_, j) => j !== i))} hitSlop={8}><Close size={16} color={c.inkMute} /></Pressable>
            </View>
          )) : <DeskButton label="Add the first rule" icon={<Plus size={13} color={c.ink} />} onPress={() => setAdding(true)} />}
        </View>
        <Field label="Note (optional)" value={p.note} onChangeText={p.setNote} autoCapitalize="sentences" />
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
          {kind === 'tier' ? <Select label="Tier" value={text} options={p.tiers.map((t) => ({ value: t.name, label: t.name }))} onChange={setText} /> : null}
        </View>
      </Sheet>
    </DesktopSettingsPage>
  )
}
