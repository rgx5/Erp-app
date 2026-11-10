import React, { useMemo, useState } from 'react'
import { ScrollView, View } from 'react-native'
import { useRouter } from 'expo-router'
import { inr } from '@/domain/money'
import { useList } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { perform, useApp, useCan } from '@/data/store'
import { catalogSettings, reorderPlan, type ReorderLine } from '@/modules/catalog/logic'
import { createDraftOrders, saveCatalogSettings } from '@/modules/catalog/ops'
import { reorderCsv } from '@/modules/catalog/reports'
import { NumberField, Select } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { Badge } from '@/ui/primitives'
import { Notice } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Check, ClipboardList, Download, Settings } from '@/ui/icons'
import { shareFile } from '@/features/shareFile'
import { csvFileName, toCsv } from '@/domain/csv'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'
import { DeskButton, DeskPage, Toolbar } from './kit'

interface Over { off?: boolean; qty?: string; supplierId?: string }

/**
 * The desktop Auto-reorder screen: a `DeskPage`/`Toolbar` shell with the per-supplier groups kept as editable
 * mobile rows (checkbox, quantity, supplier) in a centred column — the same pattern `DesktopNewPurchase` uses for
 * line items — rather than forced into a `DataTable`, since each row needs its own inputs. Every figure comes
 * from the same `reorderPlan` the phone `m/catalog/reorder.tsx` calls, and making orders still goes through
 * `createDraftOrders` unchanged.
 */
export function DesktopReorder() {
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

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Auto-reorder" />}>
        <View style={{ padding: 20 }}><T tone="mute">Auto-reorder is for the owner and managers.</T></View>
      </DeskPage>
    )
  }

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
    <DeskPage
      toolbar={
        <Toolbar title="Auto-reorder" subtitle={all.length ? `${all.length} ${all.length === 1 ? 'item' : 'items'} to order` : undefined}
          right={
            <>
              {all.length ? <DeskButton label="CSV" icon={<Download size={14} color={c.ink} />} onPress={() => void shareFile(csvFileName('reorder list'), toCsv(reorderCsv(plan)))} /> : null}
              <DeskButton label="Settings" icon={<Settings size={14} color={c.ink} />} onPress={() => setCfg(true)} />
              {chosen.length ? <DeskButton label={`Make draft orders · ${inr(total, 0)}`} tone="primary" icon={<ClipboardList size={14} color={c.onPrimary} />} onPress={make} /> : null}
            </>
          } />
      }
    >
      {!all.length ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 10 }}>
          <Check size={28} color={c.success} />
          <T style={{ fontSize: 16 }}>Nothing needs ordering</T>
          <T tone="mute" style={{ textAlign: 'center', maxWidth: 420 }}>Items show up here when stock plus what is already on order falls to the reorder level, or when the forecast says they will run out before an order could arrive.</T>
        </View>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ alignItems: 'center', padding: 28 }}>
          <View style={{ width: '100%', maxWidth: 780, gap: 14 }}>
            <T v="caption" tone="mute">Orders are made as drafts in Purchase orders; nothing is sent to a supplier until you send it. Items already on a draft or sent order are left out.</T>
            {plan.unassigned.length ? <Notice tone="warning" title={`${plan.unassigned.length} ${plan.unassigned.length === 1 ? 'item has' : 'items have'} no supplier`} body="Choose one below, or set a default supplier in settings." /> : null}
            {groups.map(([sid, lines]) => (
              <View key={sid || 'none'} style={{ gap: 10 }}>
                <T style={{ fontSize: 14, fontWeight: '600' }}>{sid ? `${data.suppliers[sid]?.name ?? 'Supplier'} · ${inr(lines.filter((l) => eff(l).on).reduce((s, l) => s + eff(l).qty * l.cost, 0), 0)}` : 'No supplier yet'}</T>
                {lines.map((l) => {
                  const e = eff(l)
                  return (
                    <View key={l.variantId} style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14, gap: 8, opacity: e.on ? 1 : 0.5 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <DeskButton label={e.on ? '✓ Included' : 'Excluded'} tone={e.on ? 'primary' : 'default'} onPress={() => set(l.variantId, { off: e.on })} />
                        <View style={{ flex: 1 }}>
                          <T v="bodyStrong" numberOfLines={1}>{l.name}</T>
                          <T v="caption" tone="mute" numberOfLines={1}>{l.stock} in stock{l.onOrder ? ` · ${l.onOrder} on order` : ''} · level {l.min}{l.perDay ? ` · sells ${l.perDay}/day` : ''}</T>
                        </View>
                        <Badge tone={l.reason === 'below-min' ? 'warning' : 'danger'}>{l.reason === 'below-min' ? 'Low' : 'Running out'}</Badge>
                      </View>
                      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-end' }}>
                        <View style={{ width: 120 }}><NumberField label={`Order (${l.unit})`} value={over[l.variantId]?.qty ?? String(l.qty)} onChange={(t) => set(l.variantId, { qty: t })} decimals={l.fractional} /></View>
                        <View style={{ flex: 1 }}>
                          <Select<string> value={e.supplierId} placeholder="Choose supplier" searchable options={suppliers.map((s) => ({ value: s.id, label: s.name })).sort((a, b) => a.label.localeCompare(b.label))} onChange={(v) => set(l.variantId, { supplierId: v })} />
                        </View>
                      </View>
                      <T v="caption" tone="mute">At {inr(l.cost, 2)} each · {inr(e.qty * l.cost, 0)}</T>
                    </View>
                  )
                })}
              </View>
            ))}
          </View>
        </ScrollView>
      )}

      <Sheet visible={cfg} onClose={() => setCfg(false)} title="Reorder settings" subtitle="Used by the reorder list, the forecast and min–max" footer={<DeskButton label="Save" tone="primary" onPress={saveCfg} />}>
        <View style={{ gap: 14, paddingBottom: 12 }}>
          <NumberField label="Days for an order to arrive" value={f.lead} onChange={(t) => setF({ ...f, lead: t })} />
          <NumberField label="Safety days of stock" value={f.safety} onChange={(t) => setF({ ...f, safety: t })} hint="Kept on top, in case of delays" />
          <NumberField label="Days of sales an order should cover" value={f.cover} onChange={(t) => setF({ ...f, cover: t })} />
          <NumberField label="Days of selling history to average" value={f.window} onChange={(t) => setF({ ...f, window: t })} />
          <Select<string> label="Supplier when none is known" value={f.supplier} placeholder="None" options={[{ value: '', label: 'None' }, ...suppliers.map((s) => ({ value: s.id, label: s.name }))]} onChange={(v) => setF({ ...f, supplier: v })} />
        </View>
      </Sheet>
    </DeskPage>
  )
}
