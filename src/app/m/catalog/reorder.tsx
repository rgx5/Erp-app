import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { inr } from '@/domain/money'
import { useList } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { perform, useApp, useCan } from '@/data/store'
import { catalogSettings, reorderPlan, type ReorderLine } from '@/modules/catalog/logic'
import { createDraftOrders, saveCatalogSettings } from '@/modules/catalog/ops'
import { reorderCsv } from '@/modules/catalog/reports'
import { CsvButton, NoAccess } from '@/modules/catalog/ui/common'
import { Button, IconButton } from '@/ui/Button'
import { NumberField, Select } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Badge, Card, Tap } from '@/ui/primitives'
import { EmptyState, Notice, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Check, ClipboardList, Settings } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

interface Over { off?: boolean; qty?: string; supplierId?: string }

/** What to order now, grouped by supplier. Choose what to include, adjust quantities, and make draft purchase orders. */
export default function Reorder() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('purchases')
  const data = useApp((s) => s.data)
  const suppliers = useList('suppliers')
  const [over, setOver] = useState<Record<string, Over>>({})
  const [cfg, setCfg] = useState(false)
  const now = Date.now()
  const plan = useMemo(() => reorderPlan(data, now), [data, now])
  const settings = catalogSettings(data)
  const [f, setF] = useState({ lead: String(settings.leadDays), safety: String(settings.safetyDays), cover: String(settings.coverDays), window: String(settings.windowDays), supplier: settings.defaultSupplierId ?? '' })

  const all = useMemo(() => [...plan.groups.flatMap((g) => g.lines), ...plan.unassigned], [plan])
  const eff = (l: ReorderLine) => ({ on: !over[l.variantId]?.off, qty: Number(over[l.variantId]?.qty ?? l.qty) || 0, supplierId: over[l.variantId]?.supplierId ?? l.supplierId })
  const groups = useMemo(() => {
    const by = new Map<string, ReorderLine[]>()
    for (const l of all) { const s = over[l.variantId]?.supplierId ?? l.supplierId; by.set(s, [...(by.get(s) ?? []), l]) }
    return [...by.entries()].sort((a, b) => (a[0] ? 0 : 1) - (b[0] ? 0 : 1) || (data.suppliers[a[0]]?.name ?? '').localeCompare(data.suppliers[b[0]]?.name ?? ''))
  }, [all, over, data.suppliers])

  if (!can) return <NoAccess title="Auto-reorder" who="the owner and managers" />

  const chosen = all.filter((l) => eff(l).on && eff(l).qty > 0 && eff(l).supplierId)
  const total = chosen.reduce((s, l) => s + eff(l).qty * l.cost, 0)
  const set = (id: string, p: Over) => setOver((o) => ({ ...o, [id]: { ...o[id], ...p } }))

  function make() {
    const by = new Map<string, Array<{ variantId: string; qty: number; cost: number }>>()
    for (const l of chosen) by.set(eff(l).supplierId, [...(by.get(eff(l).supplierId) ?? []), { variantId: l.variantId, qty: eff(l).qty, cost: l.cost }])
    try {
      const r = perform((s, ctx) => createDraftOrders(s, [...by.entries()].map(([supplierId, items]) => ({ supplierId, items })), ctx))
      toast(`${r.orders.length} draft ${r.orders.length === 1 ? 'order' : 'orders'} made`, 'ok')
      setOver({})
      router.push('/m/purchasing/orders')
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not make the orders', 'err') }
  }
  function saveCfg() {
    try {
      perform((s, ctx) => saveCatalogSettings(s, { leadDays: Number(f.lead), safetyDays: Number(f.safety), coverDays: Number(f.cover), windowDays: Number(f.window), defaultSupplierId: f.supplier || undefined }, ctx))
      setCfg(false)
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not save', 'err') }
  }

  return (
    <Screen title="Auto-reorder" subtitle={all.length ? `${all.length} ${all.length === 1 ? 'item' : 'items'} to order` : undefined} back
      right={<View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>{all.length ? <CsvButton name="reorder list" rows={() => reorderCsv(plan)} /> : null}<IconButton label="Settings" onPress={() => setCfg(true)}><Settings size={20} color={c.ink} /></IconButton></View>}
      footer={chosen.length ? <Button label={`Make draft orders · ${inr(total, 0)}`} size="lg" block icon={<ClipboardList size={18} color={c.onPrimary} />} onPress={make} /> : undefined}>
      {!all.length ? (
        <EmptyState icon={<Check size={26} color={c.success} />} title="Nothing needs ordering" hint="Items show up here when stock plus what is already on order falls to the reorder level, or when the forecast says they will run out before an order could arrive." />
      ) : (
        <View style={{ gap: 14, paddingBottom: 24 }}>
          <T v="caption" tone="mute">Orders are made as drafts in Purchase orders; nothing is sent to a supplier until you send it. Items already on a draft or sent order are left out.</T>
          {plan.unassigned.length ? <Notice tone="warning" title={`${plan.unassigned.length} ${plan.unassigned.length === 1 ? 'item has' : 'items have'} no supplier`} body="Choose one below, or set a default supplier in settings." /> : null}
          {groups.map(([sid, lines]) => (
            <Section key={sid || 'none'} title={sid ? `${data.suppliers[sid]?.name ?? 'Supplier'} · ${inr(lines.filter((l) => eff(l).on).reduce((s, l) => s + eff(l).qty * l.cost, 0), 0)}` : 'No supplier yet'} style={{ marginTop: 0 }}>
              <Card padded={false}>
                {lines.map((l, i) => {
                  const e = eff(l)
                  return (
                    <View key={l.variantId} style={{ padding: 14, gap: 8, borderTopWidth: i ? 1 : 0, borderTopColor: c.line, opacity: e.on ? 1 : 0.5 }}>
                      <Tap onPress={() => set(l.variantId, { off: e.on })} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: e.on ? c.primary : c.lineStrong, backgroundColor: e.on ? c.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>{e.on ? <Check size={14} color={c.onPrimary} /> : null}</View>
                        <View style={{ flex: 1 }}>
                          <T v="bodyStrong" numberOfLines={1}>{l.name}</T>
                          <T v="caption" tone="mute" numberOfLines={1}>{l.stock} in stock{l.onOrder ? ` · ${l.onOrder} on order` : ''} · level {l.min}{l.perDay ? ` · sells ${l.perDay}/day` : ''}</T>
                        </View>
                        <Badge tone={l.reason === 'below-min' ? 'warning' : 'danger'}>{l.reason === 'below-min' ? 'Low' : 'Running out'}</Badge>
                      </Tap>
                      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-end' }}>
                        <View style={{ width: 100 }}><NumberField label={`Order (${l.unit})`} value={over[l.variantId]?.qty ?? String(l.qty)} onChange={(t) => set(l.variantId, { qty: t })} decimals={l.fractional} /></View>
                        <View style={{ flex: 1 }}>
                          <Select<string> value={e.supplierId} placeholder="Choose supplier" searchable options={suppliers.map((s) => ({ value: s.id, label: s.name })).sort((a, b) => a.label.localeCompare(b.label))} onChange={(v) => set(l.variantId, { supplierId: v })} />
                        </View>
                      </View>
                      <T v="caption" tone="mute">At {inr(l.cost, 2)} each · {inr(e.qty * l.cost, 0)}</T>
                    </View>
                  )
                })}
              </Card>
            </Section>
          ))}
        </View>
      )}

      <Sheet visible={cfg} onClose={() => setCfg(false)} title="Reorder settings" subtitle="Used by the reorder list, the forecast and min–max"
        footer={<Button label="Save" block onPress={saveCfg} />}>
        <View style={{ gap: 14, paddingBottom: 12 }}>
          <NumberField label="Days for an order to arrive" value={f.lead} onChange={(t) => setF({ ...f, lead: t })} />
          <NumberField label="Safety days of stock" value={f.safety} onChange={(t) => setF({ ...f, safety: t })} hint="Kept on top, in case of delays" />
          <NumberField label="Days of sales an order should cover" value={f.cover} onChange={(t) => setF({ ...f, cover: t })} />
          <NumberField label="Days of selling history to average" value={f.window} onChange={(t) => setF({ ...f, window: t })} />
          <Select<string> label="Supplier when none is known" value={f.supplier} placeholder="None" options={[{ value: '', label: 'None' }, ...suppliers.map((s) => ({ value: s.id, label: s.name }))]} onChange={(v) => setF({ ...f, supplier: v })} />
        </View>
      </Sheet>
    </Screen>
  )
}
