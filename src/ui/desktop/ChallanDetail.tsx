import React from 'react'
import { ScrollView, View } from 'react-native'
import { fmtDateTime } from '@/domain/dates'
import { fmtQty } from '@/domain/qty'
import { CHALLAN_LABEL, CHALLAN_STEPS } from '@/modules/sales-docs/logic/challans'
import { CHALLAN_TONE } from '@/modules/sales-docs/ui/tones'
import type { Challan, ChallanStatus, SalesOrder } from '@/modules/sales-docs/types'
import type { Bill } from '@/domain/types'
import { Field } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { KV, Notice } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { CheckCircle, Pencil, Printer, Send, Share, Trash, Truck } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { DataTable, DeskButton, DeskPage, Pill, SplitPane, Toolbar, cellText, dtext, type Column } from './kit'

type ItemRow = { id: string; name: string; sku: string; qty: string }

export interface DesktopChallanDetailProps {
  ch: Challan
  next: ChallanStatus | null
  order: SalesOrder | undefined
  bill: Bill | undefined
  sheet: boolean
  vehicle: string
  setVehicle: (v: string) => void
  driver: string
  setDriver: (v: string) => void
  tracking: string
  setTracking: (v: string) => void
  proof: string
  setProof: (v: string) => void
  onOpenStep: () => void
  onCloseSheet: () => void
  onStep: () => void
  onDelete: () => void
  onOpenBill: () => void
  onWhatsApp: () => void
  onPdf: () => void
  onPrint: () => void
  onEdit: () => void
}

/**
 * The desktop challan screen: a toolbar with the next step as the primary action, a dense grid of what is in the
 * parcel, and a side panel with the delivery steps, transport details and sharing. Every handler comes from
 * `src/app/m/sales-docs/challans/[id].tsx` unchanged.
 */
export function DesktopChallanDetail(p: DesktopChallanDetailProps) {
  const { c } = useTheme()
  const { ch, order, bill, next } = p

  const rows: ItemRow[] = ch.items.map((l, i) => ({ id: `${l.variantId ?? ''}${i}`, name: l.name, sku: l.sku, qty: `${fmtQty(l.qty)}${l.unit && l.unit !== 'pc' ? ` ${l.unit}` : ''}` }))
  const columns: Array<Column<ItemRow>> = [
    { key: 'item', label: 'Item', sortValue: (r) => r.name, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.name}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.sku}</T>
      </View>
    ) },
    { key: 'qty', label: 'Qty', width: 110, align: 'right', render: (r) => cellText(r.qty) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar title={ch.no} subtitle={ch.partyName}
          right={next ? <DeskButton label={next === 'dispatched' ? 'Send it out' : 'Mark delivered'} tone="primary" icon={next === 'dispatched' ? <Truck size={14} color={c.onPrimary} /> : <CheckCircle size={14} color={c.onPrimary} />} onPress={p.onOpenStep} /> : undefined} />
      }
    >
      {bill ? <View style={{ paddingHorizontal: 20, paddingTop: 10 }}><Notice tone="success" title={`Billed on ${bill.no}`} action="Open" onAction={p.onOpenBill} /></View> : null}

      <SplitPane widths={['flex', 320]}>
        <View style={{ flex: 1, margin: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
          <DataTable rows={rows} columns={columns} emptyLabel="No items on this challan" />
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 14 }}>
          <View style={{ flexDirection: 'row' }}><Pill tone={CHALLAN_TONE[ch.status]} label={CHALLAN_LABEL[ch.status]} /></View>

          <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14, gap: 6 }}>
            <T style={[dtext.label, { color: c.inkMute, marginBottom: 2 }]}>Steps</T>
            {CHALLAN_STEPS.map((st, i) => {
              const done = CHALLAN_STEPS.indexOf(ch.status) >= i
              const at = st === 'packed' ? ch.date : st === 'dispatched' ? ch.dispatchedAt : ch.deliveredAt
              return (
                <View key={st} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 3 }}>
                  <CheckCircle size={15} color={done ? c.success : c.lineStrong} />
                  <T style={[dtext.cell, { flex: 1, color: done ? c.ink : c.inkMute }]}>{CHALLAN_LABEL[st]}</T>
                  {at ? <T style={[dtext.tiny, { color: c.inkMute }]}>{fmtDateTime(at)}</T> : null}
                </View>
              )
            })}
          </View>

          <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}>
            <T style={[dtext.label, { color: c.inkMute, marginBottom: 6 }]}>Details</T>
            <KV k="To" v={ch.partyName} />
            {ch.partyPhone ? <KV k="Phone" v={ch.partyPhone} /> : null}
            {ch.address ? <KV k="Address" v={ch.address} /> : null}
            {order ? <KV k="Order" v={order.no} /> : null}
            {ch.vehicle ? <KV k="Vehicle" v={ch.vehicle} /> : null}
            {ch.driver ? <KV k="Driver" v={ch.driver} /> : null}
            {ch.trackingNo ? <KV k="Tracking" v={ch.trackingNo} /> : null}
            {ch.proof ? <KV k="Received by" v={ch.proof} /> : null}
          </View>

          {ch.notes ? <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}><T style={[dtext.label, { color: c.inkMute, marginBottom: 6 }]}>Notes</T><T style={dtext.cell}>{ch.notes}</T></View> : null}

          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <DeskButton label="WhatsApp" icon={<Send size={14} color={c.primary} />} onPress={p.onWhatsApp} />
              <DeskButton label="PDF" icon={<Share size={14} color={c.ink} />} onPress={p.onPdf} />
              <DeskButton label="Print" icon={<Printer size={14} color={c.ink} />} onPress={p.onPrint} />
            </View>
            {ch.status === 'packed' ? <DeskButton label="Edit challan" icon={<Pencil size={14} color={c.ink} />} onPress={p.onEdit} /> : null}
            {ch.status === 'packed' ? <DeskButton label="Delete challan" tone="danger" icon={<Trash size={14} color={c.danger} />} onPress={p.onDelete} /> : null}
          </View>
        </ScrollView>
      </SplitPane>

      <Sheet visible={p.sheet} onClose={p.onCloseSheet} title={next === 'dispatched' ? 'Send it out' : 'Mark delivered'} footer={<DeskButton label="Save" tone="primary" onPress={p.onStep} />}>
        <View style={{ gap: 14 }}>
          {next === 'dispatched' ? (
            <>
              <Field label="Vehicle" value={p.vehicle} onChangeText={p.setVehicle} autoCapitalize="characters" />
              <Field label="Driver" value={p.driver} onChangeText={p.setDriver} />
              <Field label="Tracking / LR number" value={p.tracking} onChangeText={p.setTracking} autoCapitalize="characters" />
            </>
          ) : (
            <Field label="Received by" value={p.proof} onChangeText={p.setProof} placeholder="Name of the person who received it" />
          )}
        </View>
      </Sheet>
    </DeskPage>
  )
}
