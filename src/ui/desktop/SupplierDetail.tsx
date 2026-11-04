import React from 'react'
import { ScrollView, View } from 'react-native'
import { useRouter } from 'expo-router'
import { dayLabel } from '@/domain/dates'
import { inr, inr0 } from '@/domain/money'
import { purchaseDue } from '@/domain/stock'
import type { Purchase, Supplier } from '@/domain/types'
import { KV } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Pencil, Phone, Truck } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { PanelSlot } from '@/modules/PanelSlot'
import { DataTable, DeskButton, DeskPage, KpiStrip, KpiTile, Pill, SplitPane, Toolbar, cellNum, cellText, dtext, type Column } from './kit'

export interface DesktopSupplierDetailProps {
  supplier: Supplier
  mine: Purchase[]
  owed: number
  bought: number
  onCall: () => void
  onWhatsapp: () => void
  onEdit: () => void
}

type ReceiptRow = { id: string; no: string; invoiceRef: string; date: number; total: number; due: number }

/**
 * The desktop supplier screen: a toolbar with the actions the phone screen scatters across the header and a card
 * (edit, call, WhatsApp, receive stock), a KPI strip for what's owed and bought, a dense grid of every receipt from
 * this supplier, and a side panel for their contact details. `owed`, `bought` and `mine` are passed down from
 * `src/app/suppliers/[id].tsx` exactly as the phone screen computes them (`supplierOwed`), and row click reuses the
 * same `/purchases/[id]` route the phone list links to.
 */
export function DesktopSupplierDetail({ supplier, mine, owed, bought, onCall, onWhatsapp, onEdit }: DesktopSupplierDetailProps) {
  const { c } = useTheme()
  const router = useRouter()

  const rows: ReceiptRow[] = mine.map((p) => ({ id: p.id, no: p.no, invoiceRef: p.invoiceRef, date: p.date, total: p.total, due: purchaseDue(p) }))

  const columns: Array<Column<ReceiptRow>> = [
    { key: 'no', label: 'Receipt', sortValue: (r) => r.no, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.no}</T>
        {r.invoiceRef ? <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>Bill {r.invoiceRef}</T> : null}
      </View>
    ) },
    { key: 'date', label: 'Date', width: 120, align: 'right', sortValue: (r) => r.date, render: (r) => cellText(dayLabel(r.date)) },
    { key: 'total', label: 'Total', width: 120, align: 'right', sortValue: (r) => r.total, render: (r) => cellNum(inr0(r.total), true) },
    { key: 'status', label: 'Status', width: 130, sortValue: (r) => r.due, render: (r) => (r.due > 0 ? <Pill tone="warning" label={`Due ${inr0(r.due)}`} /> : <Pill tone="success" label="Paid" />) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title={supplier.name}
          subtitle={supplier.gstin || supplier.phone || 'Supplier'}
          right={
            <>
              {supplier.phone ? <DeskButton label="Call" icon={<Phone size={14} color={c.ink} />} onPress={onCall} /> : null}
              {supplier.phone ? <DeskButton label="WhatsApp" onPress={onWhatsapp} /> : null}
              <DeskButton label="Edit" icon={<Pencil size={14} color={c.ink} />} onPress={onEdit} />
              <DeskButton label="Receive stock" tone="primary" icon={<Truck size={14} color={c.onPrimary} />} onPress={() => router.push({ pathname: '/purchases/new', params: { supplierId: supplier.id } })} />
            </>
          }
        />
      }
    >
      <KpiStrip>
        <KpiTile label={owed < 0 ? 'Paid in advance' : 'You owe'} value={inr0(Math.abs(owed))} tone={owed > 0 ? 'warning' : 'success'} delta={owed > 0 ? 'Across unpaid receipts' : owed < 0 ? 'Credit with them' : 'Settled'} />
        <KpiTile label="Bought in all" value={inr0(bought)} tone="primary" delta={`${mine.length} ${mine.length === 1 ? 'receipt' : 'receipts'}`} />
      </KpiStrip>

      <SplitPane widths={['flex', 320]}>
        <View style={{ flex: 1, margin: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
          <DataTable
            rows={rows}
            columns={columns}
            onRowPress={(r) => router.push({ pathname: '/purchases/[id]', params: { id: r.id } })}
            emptyLabel={`Nothing received from ${supplier.name} yet`}
          />
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 14 }}>
          <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}>
            <T style={[dtext.label, { color: c.inkMute, marginBottom: 6 }]}>Details</T>
            <KV k="Phone" v={supplier.phone || '—'} />
            <KV k="GSTIN" v={supplier.gstin || '—'} />
            <KV k="Address" v={supplier.address || '—'} />
            {supplier.openingBalance ? <KV k="Owed when you started" v={inr(supplier.openingBalance)} /> : null}
          </View>

          <PanelSlot slot="supplier" supplier={supplier} />
        </ScrollView>
      </SplitPane>
    </DeskPage>
  )
}
