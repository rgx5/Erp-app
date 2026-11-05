import React, { useMemo } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { csvFileName } from '@/domain/csv'
import { fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import { perform, useApp, useCan } from '@/data/store'
import { OpError } from '@/data/ops'
import { shareFile } from '@/features/shareFile'
import { itcClosingSoon, itcRegister } from '@/modules/purchasing/itc'
import { reversePurchaseInvoice } from '@/modules/purchasing/ops-invoices'
import { itcCsv } from '@/modules/purchasing/reports'
import { reversedIds } from '@/modules/purchasing/reversal'
import { T } from '@/ui/Text'
import { Download, Plus } from '@/ui/icons'
import { ask, toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'
import { DataTable, DeskButton, DeskPage, dtext, KpiStrip, KpiTile, Pill, Toolbar, cellNum, cellText, type Column } from './kit'

type InvoiceRow = { id: string; no: string; invoiceNo: string; supplierName: string; date: number; total: number; eligible: boolean; cancelled: boolean }

/**
 * The desktop supplier-invoices screen: a KPI strip for the GST input-credit register, a warning for credit closing
 * soon, and a dense grid of every invoice — instead of the phone's stacked list with inline cancel buttons. Every
 * figure comes from the same `itcRegister`/`itcClosingSoon` the phone `m/purchasing/invoices/index.tsx` calls.
 */
export function DesktopSupplierInvoices() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('purchases')
  const data = useApp((s) => s.data)
  const now = Date.now()
  const reg = useMemo(() => itcRegister(data, 0, now + 86_400_000), [data, now])
  const soon = useMemo(() => itcClosingSoon(data, now, 30), [data, now])
  const all = Object.values(data.purchaseInvoices)
  const gone = reversedIds(all)
  const list = all.filter((i) => !i.reverses).sort((a, b) => b.invoiceDate - a.invoiceDate)

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Supplier invoices" />}>
        <View style={{ padding: 20 }}><T tone="mute">Supplier invoices are for the owner and managers.</T></View>
      </DeskPage>
    )
  }

  async function cancel(id: string, no: string) {
    if (!(await ask({ title: `Cancel ${no}?`, message: 'Its input credit and anything it added to what you owe are taken back.', confirm: 'Cancel invoice', danger: true }))) return
    try { perform((s, ctx) => reversePurchaseInvoice(s, id, 'Cancelled', ctx)); toast('Invoice cancelled', 'ok') } catch (e) { toast(e instanceof OpError ? e.message : 'Could not cancel', 'err') }
  }

  const rows: InvoiceRow[] = list.map((i) => ({
    id: i.id, no: i.no, invoiceNo: i.invoiceNo, supplierName: data.suppliers[i.supplierId]?.name ?? 'Supplier', date: i.invoiceDate, total: i.total, eligible: i.itc.eligible, cancelled: gone.has(i.id),
  }))

  const columns: Array<Column<InvoiceRow>> = [
    { key: 'supplier', label: 'Supplier', sortValue: (r) => r.supplierName, render: (r) => cellText(r.supplierName, true) },
    { key: 'no', label: 'Invoice', width: 180, sortValue: (r) => r.invoiceNo, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cell} numberOfLines={1}>{r.invoiceNo}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.no}</T>
      </View>
    ) },
    { key: 'date', label: 'Date', width: 110, sortValue: (r) => r.date, render: (r) => cellText(fmtDayShort(r.date)) },
    { key: 'total', label: 'Total', width: 110, align: 'right', sortValue: (r) => r.total, render: (r) => cellNum(inr(r.total, 0), true) },
    { key: 'status', label: 'Credit', width: 120, sortValue: (r) => (r.cancelled ? 2 : r.eligible ? 0 : 1), render: (r) => (r.cancelled ? <Pill tone="danger" label="Cancelled" /> : r.eligible ? <Pill tone="success" label="Credit" /> : <Pill tone="warning" label="Blocked" />) },
    { key: 'actions', label: '', width: 90, render: (r) => (r.cancelled ? null : <DeskButton label="Cancel" onPress={() => void cancel(r.id, r.no)} />) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title="Supplier invoices"
          subtitle="GST input credit"
          right={
            <>
              {list.length ? <DeskButton label="CSV" icon={<Download size={14} color={c.ink} />} onPress={() => void shareFile(csvFileName('input credit'), itcCsv(data, 0, now + 86_400_000)).catch(() => toast('Could not export', 'err'))} /> : null}
              <DeskButton label="Add supplier invoice" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={() => router.push('/m/purchasing/invoices/new')} />
            </>
          }
        />
      }
    >
      <KpiStrip>
        <KpiTile label="Credit to claim" value={inr(reg.eligible.total, 0)} tone="success" delta="Eligible invoices" />
        <KpiTile label="Net credit" value={inr(reg.net.total, 0)} tone="primary" delta={`${inr(reg.reversed.total, 0)} given back on returns`} />
        <KpiTile label="No credit" value={inr(reg.blocked.total, 0)} tone="warning" delta="Part of the cost" />
      </KpiStrip>

      {soon.length ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 10 }}>
          <Pill tone="warning" label={`${soon.length} ${soon.length === 1 ? 'invoice' : 'invoices'} closing for credit within 30 days`} />
        </View>
      ) : null}

      <View style={{ flex: 1, marginHorizontal: 14, marginTop: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable rows={rows} columns={columns} emptyLabel="No supplier invoices" />
      </View>
    </DeskPage>
  )
}
