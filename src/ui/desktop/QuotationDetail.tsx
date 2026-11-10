import React from 'react'
import { ScrollView, View } from 'react-native'
import { variantLabel } from '@/domain/codes'
import { fmtDate } from '@/domain/dates'
import { inr } from '@/domain/money'
import { fmtQty } from '@/domain/qty'
import type { CartTotals } from '@/domain/cart'
import { QUOTE_LABEL } from '@/modules/sales-docs/logic/quotes'
import { QUOTE_TONE } from '@/modules/sales-docs/ui/tones'
import { DateField } from '@/modules/sales-docs/ui/forms'
import type { Quotation } from '@/modules/sales-docs/types'
import type { Bill, StoreSettings } from '@/domain/types'
import { Button } from '@/ui/Button'
import { Sheet } from '@/ui/Sheet'
import { KV, Notice } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { CheckCircle, Pencil, Printer, Receipt, Send, Share, Trash } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { DataTable, DeskButton, DeskPage, Pill, SplitPane, Toolbar, cellNum, dtext, type Column } from './kit'

type ItemRow = { id: string; name: string; sub: string; qty: number; price: number; total: number }

export interface DesktopQuotationDetailProps {
  q: Quotation
  store: StoreSettings
  status: 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired' | 'converted'
  t: CartTotals
  bill: Bill | undefined
  left: number
  canEdit: boolean
  canConvert: boolean
  extending: boolean
  until: string
  setUntil: (v: string) => void
  onOpenExtend: () => void
  onCloseExtend: () => void
  onExtend: () => void
  onMove: (to: 'draft' | 'sent' | 'accepted' | 'rejected') => void
  onConvert: () => void
  onDelete: () => void
  onOpenBill: () => void
  onWhatsApp: () => void
  onPdf: () => void
  onPrint: () => void
  onEdit: () => void
}

/**
 * The desktop quotation screen: a toolbar with the one primary action ("Turn into a bill"), a dense grid of the
 * items offered, and a side panel with status, totals, sharing and the status-change actions the phone screen
 * stacks as buttons. Every figure and handler (`t`, `status`, `onMove`, `onConvert`, `onExtend`, …) comes from
 * `src/app/m/sales-docs/quotations/[id].tsx` unchanged; this file only lays the same data out as a grid + panel.
 */
export function DesktopQuotationDetail(p: DesktopQuotationDetailProps) {
  const { c } = useTheme()
  const { q, store, status, t, bill, left } = p

  const rows: ItemRow[] = q.items.map((l, i) => ({
    id: l.variantId, name: l.name, sub: [variantLabel(l.size, l.color), `${fmtQty(l.qty)}${l.unit && l.unit !== 'pc' ? ` ${l.unit}` : ''} × ${inr(l.price)}`].filter(Boolean).join(' · '),
    qty: l.qty, price: l.price, total: t.items[i]?.lineTotal ?? l.price * l.qty,
  }))
  const columns: Array<Column<ItemRow>> = [
    { key: 'item', label: 'Item offered', sortValue: (r) => r.name, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.name}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.sub}</T>
      </View>
    ) },
    { key: 'total', label: 'Line total', width: 130, align: 'right', sortValue: (r) => r.total, render: (r) => cellNum(inr(r.total, 0), true) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title={q.no}
          subtitle={q.partyName}
          right={p.canConvert ? <DeskButton label="Turn into a bill" tone="primary" icon={<Receipt size={14} color={c.onPrimary} />} onPress={p.onConvert} /> : undefined}
        />
      }
    >
      {status === 'expired' ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 10 }}>
          <Notice tone="warning" title="This quotation has lapsed" body={`The prices were held until ${fmtDate(q.validUntil)}.`} action="Extend" onAction={p.onOpenExtend} />
        </View>
      ) : null}
      {bill ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 10 }}>
          <Notice tone="success" icon={<CheckCircle size={20} color={c.success} />} title={`Billed as ${bill.no}`} body={q.convertedAt ? fmtDate(q.convertedAt) : undefined} action="Open" onAction={p.onOpenBill} />
        </View>
      ) : null}

      <SplitPane widths={['flex', 320]}>
        <View style={{ flex: 1, margin: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
          <DataTable rows={rows} columns={columns} emptyLabel="No items on this quotation" />
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 14 }}>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            <Pill tone={QUOTE_TONE[status]} label={QUOTE_LABEL[status]} />
            {status === 'draft' || status === 'sent' || status === 'accepted' ? <Pill tone={left <= 2 ? 'warning' : 'default'} label={left <= 0 ? 'Last day today' : `${left} day${left === 1 ? '' : 's'} left`} /> : null}
          </View>

          <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}>
            <T style={[dtext.label, { color: c.inkMute, marginBottom: 6 }]}>Details</T>
            <KV k="For" v={q.partyName} />
            {q.partyPhone ? <KV k="Phone" v={q.partyPhone} /> : null}
            <KV k="Dated" v={fmtDate(q.date)} />
            <KV k="Valid until" v={fmtDate(q.validUntil)} />
          </View>

          <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}>
            <T style={[dtext.label, { color: c.inkMute, marginBottom: 6 }]}>Totals</T>
            {t.itemDiscount + t.billDiscount > 0 ? <KV k="Discount" v={`− ${inr(t.itemDiscount + t.billDiscount)}`} tone="success" /> : null}
            <KV k={store.priceIncludesTax ? 'GST included' : 'GST added'} v={inr(t.taxTotal)} />
            <KV k="Total" v={inr(t.total)} strong big />
          </View>

          {q.notes ? <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}><T style={[dtext.label, { color: c.inkMute, marginBottom: 6 }]}>Notes</T><T style={dtext.cell}>{q.notes}</T></View> : null}
          {q.terms ? <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}><T style={[dtext.label, { color: c.inkMute, marginBottom: 6 }]}>Terms</T><T style={[dtext.cell, { color: c.inkMute }]}>{q.terms}</T></View> : null}

          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <DeskButton label="WhatsApp" icon={<Send size={14} color={c.primary} />} onPress={p.onWhatsApp} />
              <DeskButton label="PDF" icon={<Share size={14} color={c.ink} />} onPress={p.onPdf} />
              <DeskButton label="Print" icon={<Printer size={14} color={c.ink} />} onPress={p.onPrint} />
            </View>
            {q.status === 'draft' ? <DeskButton label="Mark as sent" onPress={() => p.onMove('sent')} /> : null}
            {q.status === 'draft' || q.status === 'sent' ? <DeskButton label="Customer accepted" tone="primary" icon={<CheckCircle size={14} color={c.onPrimary} />} onPress={() => p.onMove('accepted')} /> : null}
            {q.status === 'draft' || q.status === 'sent' || q.status === 'accepted' ? <DeskButton label="Customer said no" onPress={() => p.onMove('rejected')} /> : null}
            {q.status === 'rejected' ? <DeskButton label="Reopen as draft" onPress={() => p.onMove('draft')} /> : null}
            {p.canEdit ? <DeskButton label="Edit quotation" icon={<Pencil size={14} color={c.ink} />} onPress={p.onEdit} /> : null}
            {status === 'expired' ? <DeskButton label="Extend validity" onPress={p.onOpenExtend} /> : null}
            {q.status === 'draft' ? <DeskButton label="Delete draft" tone="danger" icon={<Trash size={14} color={c.danger} />} onPress={p.onDelete} /> : null}
          </View>
        </ScrollView>
      </SplitPane>

      <Sheet visible={p.extending} onClose={p.onCloseExtend} title="Extend validity" footer={<Button label="Save" block onPress={p.onExtend} />}>
        <DateField label="Valid until" value={p.until} onChange={p.setUntil} />
      </Sheet>
    </DeskPage>
  )
}
