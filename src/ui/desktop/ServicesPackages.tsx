import React, { useMemo, useState } from 'react'
import { ScrollView, View } from 'react-native'
import { useRouter } from 'expo-router'
import { inr } from '@/domain/money'
import { listOf } from '@/data/state'
import { useApp, useCan } from '@/data/store'
import { Button } from '@/ui/Button'
import { Field, MoneyField, NumberField, Segmented, SwitchRow } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { Badge, Chip, Group } from '@/ui/primitives'
import { ListRow } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Gift } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'
import { packagePlanLabel, packageStatus, planLine, STATUS_LABEL } from '@/modules/services/logic/packages'
import { sellPackage, savePlan } from '@/modules/services/ops'
import type { PackageMode, PackagePlan, PackageStatus } from '@/modules/services/types'
import { act, CustomerField, PACKAGE_TONE, useVariantChoices } from '@/modules/services/ui/common'
import { DataTable, DeskButton, DeskPage, DeskSegmented, dtext, KpiStrip, KpiTile, SplitPane, Toolbar, cellNum, type Column } from './kit'

type Filter = PackageStatus | 'all'
type Row = { id: string; title: string; sub: string; status: PackageStatus; price: number }
const MODES: PackageMode[] = ['cash', 'upi', 'card', 'bank']

/**
 * The desktop packages & memberships screen: a KPI strip, a dense grid of every package sold, and a side panel
 * of the plans on offer — instead of the phone's two stacked sections. Every figure and the selling/plan-editing
 * sheets come straight from the same `sellPackage`/`savePlan` operations the phone `m/services/packages/index.tsx` calls.
 */
export function DesktopServicesPackages() {
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

  const plans = useMemo(() => listOf(data.packagePlans ?? {}).sort((a, b) => b.createdAt - a.createdAt), [data.packagePlans])
  const sold = useMemo(() => listOf(data.customerPackages ?? {})
    .filter((p) => (!filterCustomer || p.customerId === filterCustomer) && (filter === 'all' || packageStatus(p, now) === filter))
    .sort((a, b) => b.soldAt - a.soldAt), [data.customerPackages, filterCustomer, filter, now])

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Packages & memberships" />}>
        <View style={{ padding: 20 }}><T tone="mute">Packages & memberships are for people who work at the counter.</T></View>
      </DeskPage>
    )
  }

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

  const rows: Row[] = sold.slice(0, 200).map((p) => ({ id: p.id, title: `${data.customers[p.customerId]?.name ?? p.no} · ${p.name}`, sub: packagePlanLabel(p), status: packageStatus(p, now), price: p.price }))
  const columns: Array<Column<Row>> = [
    { key: 'title', label: 'Package', sortValue: (r) => r.title, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.title}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.sub}</T>
      </View>
    ) },
    { key: 'status', label: 'Status', width: 120, sortValue: (r) => r.status, render: (r) => <Badge tone={PACKAGE_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge> },
    { key: 'price', label: 'Price', width: 110, align: 'right', sortValue: (r) => r.price, render: (r) => cellNum(inr(r.price, 0)) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title="Packages & memberships"
          subtitle="Prepaid sessions"
          right={<DeskButton label="Sell" tone="primary" icon={<Gift size={14} color={c.onPrimary} />} onPress={() => { setSellCustomer(null); setPlanId(''); setMode('cash'); setRef(''); setPrice(''); setSelling(true) }} />}
        />
      }
    >
      <KpiStrip>
        <KpiTile label="Plans on offer" value={String(plans.filter((p) => p.active).length)} tone="accent" delta={`${plans.length} in all`} />
        <KpiTile label="Sold" value={String(sold.length)} tone="primary" delta={`${sold.filter((p) => packageStatus(p, now) === 'active').length} active`} />
      </KpiStrip>

      <SplitPane widths={['flex', 320]}>
        <View style={{ flex: 1, margin: 14, gap: 10 }}>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <View style={{ flex: 1, minWidth: 220 }}><CustomerField label="Filter by customer" value={filterCustomer} optional onChange={(cu) => setFilterCustomer(cu?.id ?? null)} /></View>
            <DeskSegmented<Filter> value={filter} onChange={setFilter} options={[{ id: 'all', label: 'All' }, { id: 'active', label: 'Active' }, { id: 'frozen', label: 'Frozen' }, { id: 'expired', label: 'Expired' }]} />
          </View>
          <View style={{ flex: 1, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
            <DataTable rows={rows} columns={columns} onRowPress={(r) => router.push({ pathname: '/m/services/packages/[id]', params: { id: r.id } })} emptyLabel="Nothing sold yet" />
          </View>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <T style={[dtext.label, { color: c.inkMute }]}>Plans</T>
            {manager ? <DeskButton label="Add" onPress={() => startPlan()} /> : null}
          </View>
          {plans.length ? (
            <Group>{plans.map((pl) => (
              <ListRow key={pl.id} icon={<Gift size={18} color={c.accent} />} iconTone="accent" title={pl.name} subtitle={planLine(pl)} meta={pl.active ? undefined : 'Off sale'}
                value={inr(pl.price, 0)} onPress={manager ? () => startPlan(pl) : undefined} />
            ))}</Group>
          ) : <T tone="mute">No packages yet.</T>}
        </ScrollView>
      </SplitPane>

      <Sheet visible={selling} onClose={() => setSelling(false)} title="Sell a package" footer={<Button label="Sell" size="lg" block onPress={sell} />}>
        <View style={{ gap: 12, paddingBottom: 8 }}>
          <CustomerField value={sellCustomer} onChange={(cu) => setSellCustomer(cu?.id ?? null)} />
          <View style={{ gap: 8 }}>
            <T v="label" tone="soft">PACKAGE</T>
            {plans.filter((pl) => pl.active).map((pl) => <Chip key={pl.id} label={`${pl.name} · ${inr(pl.price, 0)}`} selected={planId === pl.id} onPress={() => { setPlanId(pl.id); setPrice('') }} />)}
            {!plans.some((pl) => pl.active) ? <T v="caption" tone="mute">No package is on sale. Add one first.</T> : null}
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
    </DeskPage>
  )
}
