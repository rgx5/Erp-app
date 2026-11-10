import React from 'react'
import { ScrollView, View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import { itemName } from '@/modules/manufacturing/bom'
import type { materialRows, progressOf, qualityPosition } from '@/modules/manufacturing/production'
import { WO_LABEL } from '@/modules/manufacturing/production'
import type { ProductionEntry, QualityCheck, WorkOrder } from '@/modules/manufacturing/types'
import type { DataState } from '@/data/state'
import { Field, NumberField, Segmented, SwitchRow } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { KV, Notice } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { useTheme, type Tone } from '@/ui/theme'
import { DataTable, DeskButton, DeskPage, Pill, SplitPane, Toolbar, cellNum, dtext, type Column } from './kit'

const TONE: Record<string, Tone> = { planned: 'default', in_progress: 'primary', done: 'success', cancelled: 'danger' }
type Mode = null | 'issue' | 'return' | 'inspect' | 'receive' | 'complete'
type RawMaterialRow = ReturnType<typeof materialRows>[number]
type MaterialRow = RawMaterialRow & { id: string }

export interface DesktopWorkOrderDetailProps {
  wo: WorkOrder
  data: DataState
  entries: ProductionEntry[]
  checks: QualityCheck[]
  p: ReturnType<typeof progressOf>
  pos: ReturnType<typeof qualityPosition>
  rows: RawMaterialRow[]
  miss: Array<{ variantId: string; need: number; have: number }>
  childOrders: WorkOrder[]
  open: boolean
  mode: Mode
  qtys: Record<string, string>
  setQtys: (v: Record<string, string>) => void
  good: string
  setGood: (v: string) => void
  scrap: string
  setScrap: (v: string) => void
  checked: string
  setChecked: (v: string) => void
  rejected: string
  setRejected: (v: string) => void
  action: 'scrap' | 'rework'
  setAction: (v: 'scrap' | 'rework') => void
  recheck: boolean
  setRecheck: (v: boolean) => void
  marks: Record<string, boolean>
  setMarks: (v: Record<string, boolean>) => void
  labour: string
  setLabour: (v: string) => void
  overhead: string
  setOverhead: (v: string) => void
  onOpenSheet: (m: Exclude<Mode, null>) => void
  onCloseSheet: () => void
  onStart: (issueNow: boolean) => void
  onPlanShortfall: () => void
  onIssueOrReturn: () => void
  onInspect: () => void
  onReceiveOrComplete: () => void
  onClose: () => void
  onCancel: () => void
}

/**
 * The desktop work-order screen: a dense grid of materials against planned quantity, a side panel for cost,
 * inspections and part orders, and every issue/return/inspect/receive/complete action as a toolbar or panel
 * button instead of the phone's stacked buttons. Every figure and handler comes from
 * `src/app/m/manufacturing/orders/[id].tsx` unchanged.
 */
export function DesktopWorkOrderDetail(p: DesktopWorkOrderDetailProps) {
  const { c } = useTheme()
  const router = useRouter()
  const { wo, data, entries, checks, p: prog, pos, miss, childOrders, open, mode } = p
  const rows: MaterialRow[] = p.rows.map((r) => ({ ...r, id: r.variantId }))

  const columns: Array<Column<MaterialRow>> = [
    { key: 'name', label: 'Material', sortValue: (r) => itemName(data, r.variantId), render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{itemName(data, r.variantId)}</T>
        <T style={[dtext.tiny, { color: r.over > 0 ? c.danger : c.inkMute }]} numberOfLines={1}>{r.customerSupplied ? 'Customer’s material · ' : ''}planned wastage {r.plannedWastagePct}%{r.wastagePct !== null ? ` · actual ${r.wastagePct}%` : ''}{r.over > 0 ? ` · ${r.over} over` : ''}</T>
      </View>
    ) },
    { key: 'qty', label: 'Actual / planned', width: 150, align: 'right', sortValue: (r) => r.actual, render: (r) => cellNum(`${r.actual} / ${r.planned}`) },
  ]

  return (
    <DeskPage toolbar={<Toolbar title={wo.no} subtitle={wo.recipeName} right={<Pill tone={TONE[wo.status]} label={WO_LABEL[wo.status]} />} />}>
      {miss.length ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 10 }}>
          <Notice title={`${miss.length} material${miss.length === 1 ? ' is' : 's are'} short`} body={miss.map((m) => `${itemName(data, m.variantId)}: need ${m.need}, have ${m.have}`).join('\n')} action="Plan the parts" onAction={p.onPlanShortfall} />
        </View>
      ) : null}

      <SplitPane widths={['flex', 330]}>
        <View style={{ flex: 1, margin: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
          <DataTable rows={rows} columns={columns} emptyLabel="No materials on this recipe" />
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 14 }}>
          <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}>
            <T style={[dtext.label, { color: c.inkMute, marginBottom: 6 }]}>{itemName(data, wo.outputVariantId)} × {wo.qty}</T>
            <KV k="Good" v={String(prog.goodQty)} tone="success" />
            {prog.scrapQty ? <KV k="Scrapped" v={String(prog.scrapQty)} /> : null}
            <KV k="To go" v={String(prog.remaining)} />
            {wo.dueDate ? <KV k="Due" v={fmtDayShort(wo.dueDate)} /> : null}
            {wo.jobWork ? <View style={{ marginTop: 6 }}><Pill tone="accent" label="Job work — the output is the customer’s" /></View> : null}
            {wo.parentId ? <View style={{ marginTop: 6 }}><DeskButton label={`For ${data.workOrders[wo.parentId]?.no ?? 'another order'}`} onPress={() => router.push({ pathname: '/m/manufacturing/orders/[id]', params: { id: wo.parentId! } } as never)} /></View> : null}
          </View>

          <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}>
            <T style={[dtext.label, { color: c.inkMute, marginBottom: 6 }]}>Cost</T>
            <KV k="Standard per unit" v={inr(wo.stdMaterialPerUnit + wo.labourPerUnit + wo.overheadPerUnit)} sub={`Material ${inr(wo.stdMaterialPerUnit)} · labour ${inr(wo.labourPerUnit)} · overhead ${inr(wo.overheadPerUnit)}`} />
            <KV k="Material issued (net)" v={inr(prog.issuedValue - prog.returnedValue)} />
            <KV k="In work in progress" v={inr(prog.wipValue)} />
            {prog.closed ? <KV k="Variance" v={inr(prog.varianceValue)} tone={prog.varianceValue > 0 ? 'danger' : 'success'} strong /> : null}
          </View>

          {checks.length ? (
            <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14, gap: 2 }}>
              <T style={[dtext.label, { color: c.inkMute, marginBottom: 4 }]}>Inspections</T>
              {checks.map((q) => <KV key={q.id} k={q.no} v={`${q.qtyPassed} passed`} sub={q.qtyRejected ? `${q.qtyRejected} ${q.rejectAction === 'rework' ? 'sent for rework' : 'rejected'}${q.recheck ? ' · re-check' : ''}` : q.recheck ? 're-check' : undefined} />)}
            </View>
          ) : null}

          {childOrders.length ? (
            <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14, gap: 4 }}>
              <T style={[dtext.label, { color: c.inkMute, marginBottom: 4 }]}>Orders for its parts</T>
              {childOrders.map((k) => <DeskButton key={k.id} label={`${k.no} · ${itemName(data, k.outputVariantId)} × ${k.qty} · ${WO_LABEL[k.status]}`} onPress={() => router.push({ pathname: '/m/manufacturing/orders/[id]', params: { id: k.id } } as never)} />)}
            </View>
          ) : null}

          {entries.length ? (
            <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14, gap: 2 }}>
              <T style={[dtext.label, { color: c.inkMute, marginBottom: 4 }]}>History</T>
              {entries.map((e) => <KV key={e.id} k={`${e.no} · ${e.kind}`} v={e.kind === 'receipt' ? `${e.goodQty} good${e.scrapQty ? `, ${e.scrapQty} scrap` : ''}` : inr(e.kind === 'close' ? e.varianceValue : e.value)} sub={fmtDayShort(e.date)} />)}
            </View>
          ) : null}

          <View style={{ gap: 8 }}>
            {wo.status === 'planned' ? (
              <>
                <DeskButton label="Start and issue material" tone="primary" onPress={() => p.onStart(true)} />
                <DeskButton label="Start without issuing" onPress={() => p.onStart(false)} />
              </>
            ) : null}
            {wo.status === 'in_progress' ? (
              <>
                <DeskButton label="Issue more material" onPress={() => p.onOpenSheet('issue')} />
                <DeskButton label="Return unused material" onPress={() => p.onOpenSheet('return')} />
                {wo.checklist.length ? <DeskButton label="Record inspection" onPress={() => p.onOpenSheet('inspect')} /> : null}
                <DeskButton label="Receive some goods" onPress={() => p.onOpenSheet('receive')} />
                <DeskButton label="Finish the order" tone="primary" onPress={() => p.onOpenSheet('complete')} />
                {prog.goodQty + prog.scrapQty > 0 ? <DeskButton label="Close with what is received" onPress={p.onClose} /> : null}
              </>
            ) : null}
            {open ? <DeskButton label="Cancel order" tone="danger" onPress={p.onCancel} /> : null}
          </View>
        </ScrollView>
      </SplitPane>

      <Sheet visible={mode === 'issue' || mode === 'return'} onClose={p.onCloseSheet} title={mode === 'issue' ? 'Issue material' : 'Return material'}
        footer={<DeskButton label={mode === 'issue' ? 'Issue' : 'Return'} tone="primary" onPress={p.onIssueOrReturn} />}>
        <View style={{ gap: 12 }}>
          {rows.filter((r) => mode === 'issue' || r.actual > 0).map((r) => (
            <NumberField key={r.variantId} label={`${itemName(data, r.variantId)}${mode === 'return' ? ` (with order: ${r.actual})` : ''}`} value={p.qtys[r.variantId] ?? ''} onChange={(t) => p.setQtys({ ...p.qtys, [r.variantId]: t })} decimals />
          ))}
        </View>
      </Sheet>

      <Sheet visible={mode === 'inspect'} onClose={p.onCloseSheet} title="Inspection" subtitle={pos.rework ? `${pos.rework} units are waiting after rework` : undefined}
        footer={<DeskButton label="Save inspection" tone="primary" onPress={p.onInspect} />}>
        <View style={{ gap: 12 }}>
          {wo.checklist.map((ck) => <SwitchRow key={ck.id} title={ck.label} subtitle={ck.critical ? 'Critical — failing rejects the lot' : undefined} value={p.marks[ck.id] !== false} onChange={(v) => p.setMarks({ ...p.marks, [ck.id]: v })} />)}
          <NumberField label="Units checked" value={p.checked} onChange={p.setChecked} decimals />
          <NumberField label="Units rejected" value={p.rejected} onChange={p.setRejected} decimals />
          <Segmented value={p.action} onChange={p.setAction} options={[{ value: 'scrap', label: 'Scrap' }, { value: 'rework', label: 'Rework' }]} />
          {pos.rework > 0 ? <SwitchRow title="Re-check of reworked units" value={p.recheck} onChange={p.setRecheck} /> : null}
        </View>
      </Sheet>

      <Sheet visible={mode === 'receive' || mode === 'complete'} onClose={p.onCloseSheet} title={mode === 'complete' ? 'Finish the order' : 'Receive goods'}
        subtitle={wo.checklist.length ? `${pos.availableGood} passed inspection, not yet received` : undefined}
        footer={<DeskButton label={mode === 'complete' ? 'Receive and close' : 'Receive'} tone="primary" onPress={p.onReceiveOrComplete} />}>
        <View style={{ gap: 12 }}>
          <NumberField label="Good units" value={p.good} onChange={p.setGood} decimals />
          <NumberField label="Scrapped units" value={p.scrap} onChange={p.setScrap} decimals />
          <Field label="Actual labour (optional)" value={p.labour} onChangeText={p.setLabour} keyboardType="decimal-pad" hint="Blank = at standard" />
          <Field label="Actual overhead (optional)" value={p.overhead} onChangeText={p.setOverhead} keyboardType="decimal-pad" hint="Blank = at standard" />
          {mode === 'complete' ? (
            <View style={{ gap: 12 }}>
              <T v="label" tone="mute">Unused material going back on the shelf</T>
              {rows.filter((r) => r.actual > 0 && !r.customerSupplied).map((r) => <NumberField key={r.variantId} label={`${itemName(data, r.variantId)} (with order: ${r.actual})`} value={p.qtys[r.variantId] ?? ''} onChange={(t) => p.setQtys({ ...p.qtys, [r.variantId]: t })} decimals />)}
            </View>
          ) : null}
        </View>
      </Sheet>
    </DeskPage>
  )
}
