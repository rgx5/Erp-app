import React from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { useRouter } from 'expo-router'
import { variantLabel } from '@/domain/codes'
import { fmtDateTime } from '@/domain/dates'
import { inr, inr0 } from '@/domain/money'
import type { InvoiceCheck } from '@/domain/purchasing'
import { fmtQty, fmtQtyUnit } from '@/domain/qty'
import type { Purchase, Supplier } from '@/domain/types'
import type { VariantView } from '@/domain/views'
import { KV, Notice } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Printer } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { DataTable, DeskButton, DeskPage, KpiStrip, KpiTile, Pill, SplitPane, Toolbar, cellNum, dtext, type Column } from './kit'

export interface DesktopPurchaseDetailProps {
  purchase: Purchase
  supplier: Supplier | undefined
  byId: Map<string, VariantView>
  due: number
  check: InvoiceCheck | null
  by: string | undefined
  qtyTotal: number
  onPrintLabels: () => void
}

type ItemRow = { id: string; variantId: string; name: string; sub: string; meta: string; qty: number; cost: number; line: number; productId: string | null }

/**
 * The desktop purchase-receipt screen: a toolbar with the one action the phone screen offers (print labels), a KPI
 * strip for the receipt's total and what is owed, a dense grid of the items received, and a side panel for the
 * supplier, the bill-match check and the money breakdown. Every value (`due`, `check`, `by`, `qtyTotal`) is passed
 * down from `src/app/purchases/[id].tsx` exactly as the phone screen computes it; this file only lays it out as a
 * grid + side panel instead of stacked cards, matching `DesktopPurchases` (the list this screen is reached from).
 */
export function DesktopPurchaseDetail({ purchase, supplier, byId, due, check, by, qtyTotal, onPrintLabels }: DesktopPurchaseDetailProps) {
  const { c } = useTheme()
  const router = useRouter()

  const rows: ItemRow[] = purchase.items.map((i) => {
    const v = byId.get(i.variantId)
    const short = i.invoicedQty !== undefined && i.invoicedQty !== i.qty
    const meta = short ? `Billed ${fmtQty(i.invoicedQty ?? 0)}, received ${fmtQty(i.qty)}` : v?.trackStock ? `${fmtQtyUnit(v.stock, v)} in stock now` : ''
    return {
      id: i.variantId, variantId: i.variantId, name: v?.productName ?? 'Removed item',
      sub: [v ? variantLabel(v.size, v.color) : '', v?.sku].filter(Boolean).join(' · '),
      meta, qty: i.qty, cost: i.cost, line: Math.round(i.qty * i.cost * 100) / 100, productId: v?.productId ?? null,
    }
  })

  const columns: Array<Column<ItemRow>> = [
    { key: 'item', label: 'Item received', sortValue: (r) => r.name, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.name}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{[r.sub, r.meta].filter(Boolean).join(' · ')}</T>
      </View>
    ) },
    { key: 'qty', label: 'Qty', width: 100, align: 'right', sortValue: (r) => r.qty, render: (r) => cellNum(fmtQty(r.qty)) },
    { key: 'cost', label: 'Cost each', width: 110, align: 'right', sortValue: (r) => r.cost, render: (r) => cellNum(inr(r.cost, r.cost % 1 ? 2 : 0)) },
    { key: 'line', label: 'Line total', width: 120, align: 'right', sortValue: (r) => r.line, render: (r) => cellNum(inr0(r.line), true) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title={purchase.no}
          subtitle={[supplier?.name, fmtDateTime(purchase.date)].filter(Boolean).join(' · ')}
          right={<DeskButton label="Print labels" icon={<Printer size={14} color={c.ink} />} onPress={onPrintLabels} />}
        />
      }
    >
      <KpiStrip>
        <KpiTile label="Receipt total" value={inr0(purchase.total)} tone="primary" delta={`${purchase.items.length} ${purchase.items.length === 1 ? 'line' : 'lines'} · ${fmtQty(qtyTotal)} units`} />
        <KpiTile label={due > 0 ? 'Still owed' : 'Paid'} value={inr0(due > 0 ? due : purchase.paid)} tone={due > 0 ? 'warning' : 'success'} delta={due > 0 ? `${inr0(purchase.paid)} paid` : 'Settled in full'} />
      </KpiStrip>

      {check ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 10 }}>
          {check.ok
            ? <Notice tone="success" title="Matched the supplier’s bill" body={`Their bill: ${inr(purchase.invoiceTotal ?? 0)}`} />
            : <Notice tone="warning" title={`${inr(Math.abs(check.diff))} ${check.diff > 0 ? 'more' : 'less'} than their bill`} body={`Their bill: ${inr(purchase.invoiceTotal ?? 0)} · this receipt: ${inr(purchase.total)}`} />}
        </View>
      ) : null}

      <SplitPane widths={['flex', 320]}>
        <View style={{ flex: 1, margin: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
          <DataTable
            rows={rows}
            columns={columns}
            onRowPress={(r) => (r.productId ? router.push({ pathname: '/items/[id]', params: { id: r.productId } }) : undefined)}
            emptyLabel="No items on this receipt"
          />
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 14 }}>
          {supplier ? (
            <Pressable
              onPress={() => router.push({ pathname: '/suppliers/[id]', params: { id: supplier.id } })}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <T style={dtext.cellStrong} numberOfLines={1}>{supplier.name}</T>
                <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{[supplier.phone, supplier.gstin].filter(Boolean).join(' · ') || 'Supplier'}</T>
              </View>
              <Pill tone="primary" label="View" />
            </Pressable>
          ) : null}

          <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}>
            <T style={[dtext.label, { color: c.inkMute, marginBottom: 6 }]}>Details</T>
            <KV k="Subtotal" v={inr(purchase.total)} strong />
            <KV k="Paid" v={inr(purchase.paid)} tone={purchase.paid ? 'success' : undefined} />
            <KV k="Owed to supplier" v={inr(Math.max(0, due))} tone={due > 0 ? 'warning' : undefined} />
            {purchase.invoiceRef ? <KV k="Supplier’s bill no." v={purchase.invoiceRef} /> : null}
            {by ? <KV k="Received by" v={by} /> : null}
          </View>

          {purchase.notes ? (
            <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}>
              <T style={[dtext.label, { color: c.inkMute, marginBottom: 6 }]}>Notes</T>
              <T style={dtext.cell}>{purchase.notes}</T>
            </View>
          ) : null}
        </ScrollView>
      </SplitPane>
    </DeskPage>
  )
}
