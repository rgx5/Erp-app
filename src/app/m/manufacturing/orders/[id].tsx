import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import { OpError, type OpCtx } from '@/data/ops'
import type { Changes, DataState } from '@/data/state'
import { perform, useApp, useCan } from '@/data/store'
import { itemName } from '@/modules/manufacturing/bom'
import {
  cancelWorkOrder, closeWorkOrder, completeWorkOrder, issueMaterials, planShortfallOrders, receiveOutput, recordQuality, returnMaterials, startWorkOrder,
} from '@/modules/manufacturing/ops'
import { checksOf, entriesOf, materialRows, progressOf, qualityPosition, shortages, toIssue, WO_LABEL } from '@/modules/manufacturing/production'
import { Button } from '@/ui/Button'
import { Field, NumberField, Segmented, SwitchRow } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Badge, Card, ProgressBar, Tap } from '@/ui/primitives'
import { KV, Notice, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { ask, toast } from '@/ui/overlays'
import type { Tone } from '@/ui/theme'

const TONE: Record<string, Tone> = { planned: 'default', in_progress: 'primary', done: 'success', cancelled: 'danger' }
type Mode = null | 'issue' | 'return' | 'inspect' | 'receive' | 'complete'

/** One work order: material in, goods out, inspections, and what it cost against standard. */
export default function WorkOrderScreen() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const can = useCan('inventory')
  const data = useApp((s) => s.data)
  const wo = data.workOrders[id]
  const [mode, setMode] = useState<Mode>(null)
  const [qtys, setQtys] = useState<Record<string, string>>({})
  const [good, setGood] = useState('')
  const [scrap, setScrap] = useState('')
  const [checked, setChecked] = useState('')
  const [rejected, setRejected] = useState('')
  const [action, setAction] = useState<'scrap' | 'rework'>('scrap')
  const [recheck, setRecheck] = useState(false)
  const [marks, setMarks] = useState<Record<string, boolean>>({})
  const [labour, setLabour] = useState('')
  const [overhead, setOverhead] = useState('')

  const entries = useMemo(() => (wo ? entriesOf(data, wo.id) : []), [data, wo])
  const checks = useMemo(() => (wo ? checksOf(data, wo.id) : []), [data, wo])
  const p = useMemo(() => (wo ? progressOf(wo, entries) : null), [wo, entries])
  const pos = useMemo(() => qualityPosition(checks, entries), [checks, entries])

  if (!can) return <Screen title="Work order" back><T tone="mute">Work orders are for the owner, managers and stock keepers.</T></Screen>
  if (!wo || !p) return <Screen title="Work order" back><T tone="mute">This work order is not here any more.</T></Screen>

  const rows = materialRows(wo, p)
  const miss = wo.status === 'planned' ? shortages(data, wo, p) : []
  const children = Object.values(data.workOrders).filter((c) => c.parentId === wo.id)
  const open = wo.status === 'planned' || wo.status === 'in_progress'

  const run = (fn: (s: DataState, ctx: OpCtx) => { changes: Changes }, ok: string, after?: () => void) => {
    try { perform(fn); toast(ok, 'ok'); setMode(null); after?.() } catch (e) { toast(e instanceof OpError ? e.message : 'Could not do that', 'err') }
  }
  const lines = (names: Array<{ variantId: string }>) => names.map((l) => ({ variantId: l.variantId, qty: Number(qtys[l.variantId]) || 0 })).filter((l) => l.qty > 0)
  const openSheet = (m: Mode) => {
    if (m === 'issue') setQtys(Object.fromEntries(toIssue(wo, p).map((l) => [l.variantId, String(l.qty)])))
    else if (m === 'return') setQtys({})
    else if (m === 'inspect') { setMarks(Object.fromEntries(wo.checklist.map((c) => [c.id, true]))); setChecked(String(pos.rework > 0 ? pos.rework : Math.max(0, wo.qty - pos.passed))); setRejected(''); setRecheck(false) }
    else if (m === 'receive' || m === 'complete') { const g = pos.availableGood || p.remaining; setGood(String(wo.checklist.length ? pos.availableGood : g)); setScrap(String(pos.pendingScrap || '')); setLabour(''); setOverhead(''); setQtys({}) }
    setMode(m)
  }

  return (
    <Screen title={wo.no} subtitle={wo.recipeName} back>
      <View style={{ gap: 14, paddingBottom: 28 }}>
        <Card style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <T v="h2" style={{ flex: 1 }} numberOfLines={2}>{itemName(data, wo.outputVariantId)} × {wo.qty}</T>
            <Badge tone={TONE[wo.status]}>{WO_LABEL[wo.status]}</Badge>
          </View>
          <ProgressBar value={wo.qty > 0 ? Math.min(1, p.goodQty / wo.qty) : 0} tone="success" />
          <T v="caption" tone="mute">{p.goodQty} good{p.scrapQty ? ` · ${p.scrapQty} scrapped` : ''} · {p.remaining} to go{wo.dueDate ? ` · due ${fmtDayShort(wo.dueDate)}` : ''}</T>
          {wo.jobWork ? <Badge tone="accent">Job work — the output is the customer’s</Badge> : null}
          {wo.parentId ? <Tap onPress={() => router.push({ pathname: '/m/manufacturing/orders/[id]', params: { id: wo.parentId! } } as never)}><T v="caption" tone="primary">For {data.workOrders[wo.parentId]?.no ?? 'another order'}</T></Tap> : null}
        </Card>

        {miss.length ? <Notice title={`${miss.length} material${miss.length === 1 ? ' is' : 's are'} short`} body={miss.map((m) => `${itemName(data, m.variantId)}: need ${m.need}, have ${m.have}`).join('\n')} action="Plan the parts" onAction={() => run((s, ctx) => planShortfallOrders(s, wo.id, ctx), 'Planned', undefined)} /> : null}

        <Section title="Materials">
          <Card style={{ gap: 8 }}>
            {rows.map((r) => (
              <View key={r.variantId} style={{ gap: 2 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                  <T v="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>{itemName(data, r.variantId)}</T>
                  <T v="num">{r.actual} / {r.planned}</T>
                </View>
                <T v="caption" tone={r.over > 0 ? 'danger' : 'mute'}>{r.customerSupplied ? 'Customer’s material · ' : ''}planned wastage {r.plannedWastagePct}%{r.wastagePct !== null ? ` · actual ${r.wastagePct}%` : ''}{r.over > 0 ? ` · ${r.over} over` : ''}</T>
              </View>
            ))}
          </Card>
        </Section>

        <Section title="Cost">
          <Card style={{ gap: 4 }}>
            <KV k="Standard per unit" v={inr(wo.stdMaterialPerUnit + wo.labourPerUnit + wo.overheadPerUnit)} sub={`Material ${inr(wo.stdMaterialPerUnit)} · labour ${inr(wo.labourPerUnit)} · overhead ${inr(wo.overheadPerUnit)}`} />
            <KV k="Material issued (net)" v={inr(p.issuedValue - p.returnedValue)} />
            <KV k="In work in progress" v={inr(p.wipValue)} />
            {p.closed ? <KV k="Variance" v={inr(p.varianceValue)} tone={p.varianceValue > 0 ? 'danger' : 'success'} strong /> : null}
          </Card>
        </Section>

        {checks.length ? (
          <Section title="Inspections">
            <Card style={{ gap: 4 }}>
              {checks.map((q) => <KV key={q.id} k={q.no} v={`${q.qtyPassed} passed`} sub={q.qtyRejected ? `${q.qtyRejected} ${q.rejectAction === 'rework' ? 'sent for rework' : 'rejected'}${q.recheck ? ' · re-check' : ''}` : q.recheck ? 're-check' : undefined} />)}
            </Card>
          </Section>
        ) : null}

        {children.length ? (
          <Section title="Orders for its parts">
            {children.map((k) => (
              <Tap key={k.id} onPress={() => router.push({ pathname: '/m/manufacturing/orders/[id]', params: { id: k.id } } as never)}>
                <Card><T v="bodyStrong">{k.no} · {itemName(data, k.outputVariantId)} × {k.qty}</T><T v="caption" tone="mute">{WO_LABEL[k.status]}</T></Card>
              </Tap>
            ))}
          </Section>
        ) : null}

        {entries.length ? (
          <Section title="History">
            <Card style={{ gap: 4 }}>
              {entries.map((e) => <KV key={e.id} k={`${e.no} · ${e.kind}`} v={e.kind === 'receipt' ? `${e.goodQty} good${e.scrapQty ? `, ${e.scrapQty} scrap` : ''}` : inr(e.kind === 'close' ? e.varianceValue : e.value)} sub={fmtDayShort(e.date)} />)}
            </Card>
          </Section>
        ) : null}

        {wo.status === 'planned' ? (
          <View style={{ gap: 10 }}>
            <Button label="Start and issue material" size="lg" block onPress={() => run((s, ctx) => startWorkOrder(s, wo.id, ctx), 'Started')} />
            <Button label="Start without issuing" kind="outline" block onPress={() => run((s, ctx) => startWorkOrder(s, wo.id, ctx, { issueNow: false }), 'Started')} />
          </View>
        ) : null}
        {wo.status === 'in_progress' ? (
          <View style={{ gap: 10 }}>
            <Button label="Issue more material" kind="soft" block onPress={() => openSheet('issue')} />
            <Button label="Return unused material" kind="soft" block onPress={() => openSheet('return')} />
            {wo.checklist.length ? <Button label="Record inspection" kind="soft" block onPress={() => openSheet('inspect')} /> : null}
            <Button label="Receive some goods" kind="outline" block onPress={() => openSheet('receive')} />
            <Button label="Finish the order" size="lg" block onPress={() => openSheet('complete')} />
            {p.goodQty + p.scrapQty > 0 ? <Button label="Close with what is received" kind="outline" block onPress={() => run((s, ctx) => closeWorkOrder(s, wo.id, ctx), 'Order closed')} /> : null}
          </View>
        ) : null}
        {open ? <Button label="Cancel order" kind="danger" block onPress={async () => { if (await ask({ title: 'Cancel this order?', message: wo.status === 'in_progress' ? 'Unused material goes back on the shelf.' : undefined, confirm: 'Cancel order', cancel: 'Keep' })) run((s, ctx) => cancelWorkOrder(s, wo.id, ctx), 'Cancelled') }} /> : null}
      </View>

      <Sheet visible={mode === 'issue' || mode === 'return'} onClose={() => setMode(null)} title={mode === 'issue' ? 'Issue material' : 'Return material'}
        footer={<Button label={mode === 'issue' ? 'Issue' : 'Return'} size="lg" block onPress={() => run((s, ctx) => (mode === 'issue' ? issueMaterials(s, wo.id, lines(rows), ctx) : returnMaterials(s, wo.id, lines(rows), ctx)), mode === 'issue' ? 'Issued' : 'Returned')} />}>
        <View style={{ gap: 12 }}>
          {rows.filter((r) => mode === 'issue' || r.actual > 0).map((r) => (
            <NumberField key={r.variantId} label={`${itemName(data, r.variantId)}${mode === 'return' ? ` (with order: ${r.actual})` : ''}`} value={qtys[r.variantId] ?? ''} onChange={(t) => setQtys({ ...qtys, [r.variantId]: t })} decimals />
          ))}
        </View>
      </Sheet>

      <Sheet visible={mode === 'inspect'} onClose={() => setMode(null)} title="Inspection" subtitle={pos.rework ? `${pos.rework} units are waiting after rework` : undefined}
        footer={<Button label="Save inspection" size="lg" block onPress={() => run((s, ctx) => recordQuality(s, wo.id, { results: wo.checklist.map((c) => ({ itemId: c.id, pass: marks[c.id] !== false })), qtyChecked: Number(checked) || 0, qtyRejected: Number(rejected) || 0, rejectAction: action, recheck }, ctx), 'Inspection saved')} />}>
        <View style={{ gap: 12 }}>
          {wo.checklist.map((c) => <SwitchRow key={c.id} title={c.label} subtitle={c.critical ? 'Critical — failing rejects the lot' : undefined} value={marks[c.id] !== false} onChange={(v) => setMarks({ ...marks, [c.id]: v })} />)}
          <NumberField label="Units checked" value={checked} onChange={setChecked} decimals />
          <NumberField label="Units rejected" value={rejected} onChange={setRejected} decimals />
          <Segmented value={action} onChange={setAction} options={[{ value: 'scrap', label: 'Scrap' }, { value: 'rework', label: 'Rework' }]} />
          {pos.rework > 0 ? <SwitchRow title="Re-check of reworked units" value={recheck} onChange={setRecheck} /> : null}
        </View>
      </Sheet>

      <Sheet visible={mode === 'receive' || mode === 'complete'} onClose={() => setMode(null)} title={mode === 'complete' ? 'Finish the order' : 'Receive goods'}
        subtitle={wo.checklist.length ? `${pos.availableGood} passed inspection, not yet received` : undefined}
        footer={<Button label={mode === 'complete' ? 'Receive and close' : 'Receive'} size="lg" block onPress={() => {
          const d = { goodQty: Number(good) || 0, scrapQty: Number(scrap) || 0, ...(labour ? { labour: Number(labour) } : {}), ...(overhead ? { overhead: Number(overhead) } : {}) }
          if (mode === 'complete') run((s, ctx) => completeWorkOrder(s, wo.id, { ...d, returns: lines(rows) }, ctx), 'Order finished')
          else run((s, ctx) => receiveOutput(s, wo.id, d, ctx), 'Goods received')
        }} />}>
        <View style={{ gap: 12 }}>
          <NumberField label="Good units" value={good} onChange={setGood} decimals />
          <NumberField label="Scrapped units" value={scrap} onChange={setScrap} decimals />
          <Field label="Actual labour (optional)" value={labour} onChangeText={setLabour} keyboardType="decimal-pad" hint="Blank = at standard" />
          <Field label="Actual overhead (optional)" value={overhead} onChangeText={setOverhead} keyboardType="decimal-pad" hint="Blank = at standard" />
          {mode === 'complete' ? (
            <View style={{ gap: 12 }}>
              <T v="label" tone="mute">Unused material going back on the shelf</T>
              {rows.filter((r) => r.actual > 0 && !r.customerSupplied).map((r) => <NumberField key={r.variantId} label={`${itemName(data, r.variantId)} (with order: ${r.actual})`} value={qtys[r.variantId] ?? ''} onChange={(t) => setQtys({ ...qtys, [r.variantId]: t })} decimals />)}
            </View>
          ) : null}
        </View>
      </Sheet>
    </Screen>
  )
}
