import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { inr } from '@/domain/money'
import { listOf } from '@/data/state'
import { useApp, useCan } from '@/data/store'
import { Button } from '@/ui/Button'
import { Field, MoneyField, NumberField, Segmented, SwitchRow } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Badge, Chip, Group } from '@/ui/primitives'
import { EmptyState, ListRow, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Gift } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'
import { packagePlanLabel, packageStatus, planLine, STATUS_LABEL } from '@/modules/services/logic/packages'
import { sellPackage, savePlan } from '@/modules/services/ops'
import type { PackageMode, PackagePlan, PackageStatus } from '@/modules/services/types'
import { act, CustomerField, Denied, PACKAGE_TONE, useVariantChoices } from '@/modules/services/ui/common'

type Filter = PackageStatus | 'all'
const MODES: PackageMode[] = ['cash', 'upi', 'card', 'bank']

/** The packages a customer has bought, the plans on offer, and the way to sell one. */
export default function Packages() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('services')
  const manager = useCan('servicesManage')
  const data = useApp((s) => s.data)
  const services = useVariantChoices('service')
  const now = Date.now()

  const [selling, setSelling] = useState(false)
  const [sellCustomer, setSellCustomer] = useState<string | null>(null)
  const [planId, setPlanId] = useState('')
  const [mode, setMode] = useState<PackageMode>('cash')
  const [ref, setRef] = useState('')
  const [price, setPrice] = useState('')

  const [editPlan, setEditPlan] = useState<{ id?: string } | null>(null)
  const [name, setName] = useState('')
  const [planPrice, setPlanPrice] = useState('')
  const [sessions, setSessions] = useState('')
  const [validity, setValidity] = useState('')
  const [gst, setGst] = useState('18')
  const [only, setOnly] = useState<string[]>([])
  const [notes, setNotes] = useState('')
  const [active, setActive] = useState(true)

  const [filterCustomer, setFilterCustomer] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')

  const plans = listOf(data.packagePlans ?? {}).sort((a, b) => b.createdAt - a.createdAt)
  const sold = useMemo(() => listOf(data.customerPackages ?? {})
    .filter((p) => (!filterCustomer || p.customerId === filterCustomer) && (filter === 'all' || packageStatus(p, now) === filter))
    .sort((a, b) => b.soldAt - a.soldAt), [data.customerPackages, filterCustomer, filter, now])

  if (!can) return <Denied title="Packages" who="Packages & memberships are for people who work at the counter." />

  function startPlan(p?: PackagePlan) {
    setName(p?.name ?? ''); setPlanPrice(p ? String(p.price) : ''); setSessions(p ? String(p.sessions) : ''); setValidity(p ? String(p.validityDays) : '0')
    setGst(p ? String(p.gstRate) : '18'); setOnly(p?.variantIds ?? []); setNotes(p?.notes ?? ''); setActive(p?.active ?? true)
    setEditPlan({ id: p?.id })
  }
  function savePlan_() {
    const r = act((s, ctx) => savePlan(s, { name, price: Number(planPrice) || 0, sessions: Number(sessions) || 0, validityDays: Number(validity) || 0, variantIds: only, gstRate: Number(gst) || 0, notes, active }, editPlan?.id, ctx), 'Saved')
    if (r) setEditPlan(null)
  }
  function sell() {
    if (!sellCustomer) { toast('Choose a customer', 'err'); return }
    if (!planId) { toast('Choose a package', 'err'); return }
    const r = act((s, ctx) => sellPackage(s, { customerId: sellCustomer, planId, mode, ref, ...(price ? { price: Number(price) } : {}) }, ctx), 'Package sold')
    if (r) { setSelling(false); router.push({ pathname: '/m/services/packages/[id]', params: { id: r.package.id } }) }
  }

  return (
    <Screen title="Packages & memberships" subtitle="Prepaid sessions" back
      right={<Button label="Sell" size="sm" kind="dark" icon={<Gift size={15} color={c.bg} />} onPress={() => { setSellCustomer(null); setPlanId(''); setMode('cash'); setRef(''); setPrice(''); setSelling(true) }} />}>
      <View style={{ gap: 14, paddingBottom: 28 }}>
        <Section title="Plans" action={manager ? 'Add' : undefined} onAction={() => startPlan()}>
          {plans.length ? (
            <Group>{plans.map((p) => (
              <ListRow key={p.id} icon={<Gift size={18} color={c.accent} />} iconTone="accent" title={p.name} subtitle={planLine(p)} meta={p.active ? undefined : 'Off sale'}
                value={inr(p.price, 0)} onPress={manager ? () => startPlan(p) : undefined} />
            ))}</Group>
          ) : <EmptyState compact icon={<Gift size={24} color={c.accent} />} title="No packages yet" hint={manager ? 'Add a plan — "5 hair spas for ₹4,000, valid 90 days".' : 'Ask a manager to set up a package plan.'} action={manager ? 'Add a plan' : undefined} onAction={manager ? () => startPlan() : undefined} />}
        </Section>

        <Section title="Sold to customers">
          <View style={{ gap: 10 }}>
            <CustomerField label="Filter by customer" value={filterCustomer} optional onChange={(cu) => setFilterCustomer(cu?.id ?? null)} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {(['all', 'active', 'frozen', 'expired'] as Filter[]).map((f) => <Chip key={f} label={f === 'all' ? 'All' : STATUS_LABEL[f]} selected={filter === f} onPress={() => setFilter(f)} />)}
            </View>
            {sold.length ? (
              <Group>{sold.slice(0, 60).map((p) => (
                <ListRow key={p.id} icon={<Gift size={18} color={c.accent} />} iconTone="accent" title={`${data.customers[p.customerId]?.name ?? p.no} · ${p.name}`}
                  subtitle={packagePlanLabel(p)} badge={<Badge tone={PACKAGE_TONE[packageStatus(p, now)]}>{STATUS_LABEL[packageStatus(p, now)]}</Badge>}
                  onPress={() => router.push({ pathname: '/m/services/packages/[id]', params: { id: p.id } })} />
              ))}</Group>
            ) : <EmptyState compact icon={<Gift size={24} color={c.accent} />} title="Nothing sold yet" hint="Sell a package to a customer to see it here." />}
          </View>
        </Section>
      </View>

      <Sheet visible={selling} onClose={() => setSelling(false)} title="Sell a package" footer={<Button label="Sell" size="lg" block onPress={sell} />}>
        <View style={{ gap: 12, paddingBottom: 8 }}>
          <CustomerField value={sellCustomer} onChange={(cu) => setSellCustomer(cu?.id ?? null)} />
          <View style={{ gap: 8 }}>
            <T v="label" tone="soft">PACKAGE</T>
            {plans.filter((p) => p.active).map((p) => <Chip key={p.id} label={`${p.name} · ${inr(p.price, 0)}`} selected={planId === p.id} onPress={() => { setPlanId(p.id); setPrice('') }} />)}
            {!plans.some((p) => p.active) ? <T v="caption" tone="mute">No package is on sale. Add one first.</T> : null}
          </View>
          <Segmented value={mode} onChange={setMode} options={MODES.map((m) => ({ value: m, label: m.toUpperCase() }))} />
          <Field label="Reference (optional)" value={ref} onChangeText={setRef} />
          {manager ? <MoneyField label="Price (optional override)" value={price} onChange={setPrice} hint="Leave blank for the list price." /> : null}
        </View>
      </Sheet>

      <Sheet visible={!!editPlan} onClose={() => setEditPlan(null)} full title={editPlan?.id ? 'Edit package' : 'New package'} footer={<Button label="Save" size="lg" block onPress={savePlan_} />}>
        <View style={{ gap: 14, paddingBottom: 8 }}>
          <Field label="Name" value={name} onChangeText={setName} autoCapitalize="words" placeholder="Hair spa × 5" />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <MoneyField containerStyle={{ flex: 1 }} label="Price" value={planPrice} onChange={setPlanPrice} />
            <NumberField containerStyle={{ flex: 1 }} label="Sessions" value={sessions} onChange={setSessions} />
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <NumberField containerStyle={{ flex: 1 }} label="Valid for (days)" value={validity} onChange={setValidity} hint="0 = never expires" />
            <NumberField containerStyle={{ flex: 1 }} label="GST %" value={gst} onChange={setGst} />
          </View>
          <View style={{ gap: 8 }}>
            <T v="label" tone="soft">COVERS</T>
            <T v="caption" tone="mute">{only.length ? 'Only the services ticked below.' : 'Any service (tick some to limit it).'}</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {services.map((sv) => <Chip key={sv.value} label={sv.label} selected={only.includes(sv.value)} onPress={() => setOnly(only.includes(sv.value) ? only.filter((x) => x !== sv.value) : [...only, sv.value])} />)}
            </View>
          </View>
          <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline />
          <SwitchRow title="On sale" subtitle="Switch off to stop selling it" value={active} onChange={setActive} />
        </View>
      </Sheet>
    </Screen>
  )
}
