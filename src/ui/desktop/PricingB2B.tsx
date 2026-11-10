import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { toCsv } from '@/domain/csv'
import { fmtDate, fmtMonth } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useList, useStore } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { perform, useApp, useCan } from '@/data/store'
import { shareFile } from '@/features/shareFile'
import { b2bRegister, registerCsv, registerTotals } from '@/modules/pricing/b2b'
import { eInvoiceSkipReason } from '@/modules/pricing/einvoice'
import { ewbNeeded } from '@/modules/pricing/eway'
import { savePricingSettings } from '@/modules/pricing/ops'
import { eInvoiceId, ewayId } from '@/modules/pricing/types'
import { Field, NumberField, SwitchRow } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { Button } from '@/ui/Button'
import { T } from '@/ui/Text'
import { ChevronLeft, ChevronRight, Download, Settings } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'
import { DataTable, DeskButton, DeskPage, dtext, KpiStrip, KpiTile, Pill, Toolbar, cellNum, type Column } from './kit'

type Row = { id: string; title: string; sub: string; value: number; eTone: 'success' | 'danger' | 'warning' | 'default'; eLabel: string | null; wTone: 'success' | 'warning' | 'default'; wLabel: string | null }

/**
 * The desktop GST-invoices (B2B) screen: the month's register as a KPI strip and a dense grid, the same CSV
 * export and e-invoice / e-way badges the phone `m/pricing/b2b/index.tsx` already computes.
 */
export function DesktopB2BHome() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('pricing')
  const store = useStore()
  const bills = useList('bills')
  const customers = useApp((s) => s.data.customers)
  const einv = useApp((s) => s.data.eInvoices)
  const eway = useApp((s) => s.data.ewayBills)
  const settings = useApp((s) => s.data.pricingSettings?.settings)
  const [monthOffset, setMonthOffset] = useState(0)
  const [editing, setEditing] = useState(false)
  const [legal, setLegal] = useState('')
  const [pin, setPin] = useState('')
  const [addr2, setAddr2] = useState('')
  const [on, setOn] = useState(false)
  const [limit, setLimit] = useState('')

  const ref = new Date(); ref.setDate(1); ref.setMonth(ref.getMonth() + monthOffset)
  const from = new Date(ref.getFullYear(), ref.getMonth(), 1).getTime()
  const to = new Date(ref.getFullYear(), ref.getMonth() + 1, 1).getTime() - 1
  const rows = useMemo(() => b2bRegister(bills, customers, from, to), [bills, customers, from, to])
  const totals = registerTotals(rows)
  const others = useMemo(() => bills.filter((b) => b.date >= from && b.date <= to && !rows.some((r) => r.billId === b.id) && ewbNeeded(b, settings).needed), [bills, rows, from, to, settings])

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="GST invoices" />}>
        <View style={{ padding: 20 }}><T tone="mute">GST invoices are for the owner and managers.</T></View>
      </DeskPage>
    )
  }

  const open = (billId: string) => router.push({ pathname: '/m/pricing/b2b/[billId]', params: { billId } })
  function edit() { setLegal(settings?.legalName ?? ''); setPin(settings?.sellerPin ?? ''); setAddr2(settings?.sellerAddr2 ?? ''); setOn(!!settings?.eInvoiceOn); setLimit(String(settings?.ewbThreshold ?? 50000)); setEditing(true) }
  function saveSettings() {
    try {
      perform((s, ctx) => savePricingSettings(s, { legalName: legal.trim() || undefined, sellerPin: pin.trim() || undefined, sellerAddr2: addr2.trim() || undefined, eInvoiceOn: on, ewbThreshold: Number(limit) || undefined }, ctx))
      toast('Saved', 'ok'); setEditing(false)
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not save', 'err') }
  }

  const tableRows: Row[] = [
    ...rows.map((r) => {
      const b = bills.find((x) => x.id === r.billId)!
      const e = einv[eInvoiceId(r.billId)]
      const w = eway[ewayId(r.billId)]
      const needsE = !eInvoiceSkipReason(b, store, b.customerId ? customers[b.customerId] : null)
      return {
        id: r.billId, title: r.buyerName || r.buyerGstin, sub: `${r.no} · ${fmtDate(r.date)} · ${r.igst ? 'IGST' : 'CGST + SGST'}`, value: r.total,
        eTone: !needsE ? 'default' as const : e?.status === 'registered' ? 'success' as const : e?.status === 'cancelled' ? 'danger' as const : 'warning' as const,
        eLabel: !needsE ? null : e?.status === 'registered' ? 'IRN' : e?.status === 'cancelled' ? 'IRN cancelled' : 'No IRN',
        wTone: w?.status === 'generated' ? 'success' as const : ewbNeeded(b, settings).needed ? 'warning' as const : 'default' as const,
        wLabel: w?.status === 'generated' ? 'E-way' : ewbNeeded(b, settings).needed ? 'E-way due' : null,
      }
    }),
    ...others.map((b) => ({ id: b.id, title: b.customerId ? customers[b.customerId]?.name ?? 'Customer' : 'Walk-in', sub: `${b.no} · ${fmtDate(b.date)} · no GSTIN`, value: b.total, eTone: 'default' as const, eLabel: null, wTone: 'warning' as const, wLabel: 'E-way due' })),
  ]
  const columns: Array<Column<Row>> = [
    { key: 'title', label: 'Buyer', sortValue: (r) => r.title, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.title}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.sub}</T>
      </View>
    ) },
    { key: 'status', label: 'Status', width: 170, render: (r) => (
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {r.eLabel ? <Pill tone={r.eTone} label={r.eLabel} /> : null}
        {r.wLabel ? <Pill tone={r.wTone} label={r.wLabel} /> : null}
      </View>
    ) },
    { key: 'value', label: 'Total', width: 120, align: 'right', sortValue: (r) => r.value, render: (r) => cellNum(inr(r.value, 0), true) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title="GST invoices"
          subtitle="B2B register, e-invoice, e-way bill"
          left={(
            <>
              <DeskButton label="Earlier" icon={<ChevronLeft size={14} color={c.ink} />} onPress={() => setMonthOffset(monthOffset - 1)} />
              <Pill tone="primary" label={fmtMonth(from)} />
              <DeskButton label="Later" icon={<ChevronRight size={14} color={monthOffset >= 0 ? c.inkMute : c.ink} />} disabled={monthOffset >= 0} onPress={() => setMonthOffset(Math.min(0, monthOffset + 1))} />
            </>
          )}
          right={(
            <>
              <DeskButton label="Export register" icon={<Download size={14} color={c.ink} />} disabled={!rows.length} onPress={() => void shareFile(`b2b-register-${fmtMonth(from).toLowerCase().replace(/\s+/g, '-')}.csv`, toCsv(registerCsv(rows)))} />
              <DeskButton label="Settings" icon={<Settings size={14} color={c.ink} />} onPress={edit} />
            </>
          )}
        />
      }
    >
      <KpiStrip>
        <KpiTile label="Invoices" value={String(totals.count)} tone="primary" />
        <KpiTile label="Taxable value" value={inr(totals.taxable, 0)} tone="accent" />
        <KpiTile label="CGST + SGST" value={inr(totals.cgst + totals.sgst, 0)} tone="success" />
        <KpiTile label="IGST" value={inr(totals.igst, 0)} tone="warning" />
      </KpiStrip>

      <View style={{ paddingHorizontal: 20, paddingTop: 10 }}>
        <T v="caption" tone="mute">This app builds the e-invoice and e-way bill files and checks them. It cannot register them: upload the file on the government portal, then paste the answer back on the invoice.</T>
      </View>

      <View style={{ flex: 1, margin: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable rows={tableRows} columns={columns} onRowPress={(r) => open(r.id)} emptyLabel="No invoices to businesses this month" />
      </View>

      <Sheet visible={editing} onClose={() => setEditing(false)} title="E-invoice and e-way bill settings" footer={<Button label="Save" size="lg" block onPress={saveSettings} />}>
        <View style={{ gap: 14 }}>
          <T v="caption" tone="mute">The shop’s GSTIN, address and city come from Settings → Business. The portals also want the details below.</T>
          <Field label="Registered legal name" value={legal} onChangeText={setLegal} placeholder={store.name} />
          <Field label="Pincode (6 digits)" value={pin} onChangeText={(t) => setPin(t.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" />
          <Field label="Address line 2 (optional)" value={addr2} onChangeText={setAddr2} />
          <NumberField label="E-way bill needed above ₹" value={limit} onChange={setLimit} hint="₹50,000 unless your state sets a different limit for moves within the state" />
          <SwitchRow title="Remind me on Home" subtitle="Invoices without an IRN and sales that may need an e-way bill" value={on} onChange={setOn} />
        </View>
      </Sheet>
    </DeskPage>
  )
}
