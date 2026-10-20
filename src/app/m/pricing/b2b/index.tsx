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
import { Button, IconButton } from '@/ui/Button'
import { Field, NumberField, SwitchRow } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Badge, Card } from '@/ui/primitives'
import { EmptyState, ListRow, Notice, Section, StatTile } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { ChevronLeft, ChevronRight, Download, FileText, Settings } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

/** GST invoices to businesses: the register for the month, and each invoice's e-invoice / e-way bill status. */
export default function B2BHome() {
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

  if (!can) return <Screen title="GST invoices" back><T tone="mute">GST invoices are for the owner and managers.</T></Screen>

  const open = (billId: string) => router.push({ pathname: '/m/pricing/b2b/[billId]', params: { billId } })
  function edit() { setLegal(settings?.legalName ?? ''); setPin(settings?.sellerPin ?? ''); setAddr2(settings?.sellerAddr2 ?? ''); setOn(!!settings?.eInvoiceOn); setLimit(String(settings?.ewbThreshold ?? 50000)); setEditing(true) }
  function saveSettings() {
    try {
      perform((s, ctx) => savePricingSettings(s, { legalName: legal.trim() || undefined, sellerPin: pin.trim() || undefined, sellerAddr2: addr2.trim() || undefined, eInvoiceOn: on, ewbThreshold: Number(limit) || undefined }, ctx))
      toast('Saved', 'ok'); setEditing(false)
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not save', 'err') }
  }
  const badges = (billId: string, credit: boolean) => {
    const b = bills.find((x) => x.id === billId)!
    const e = einv[eInvoiceId(billId)]
    const w = eway[ewayId(billId)]
    const needsE = !eInvoiceSkipReason(b, store, b.customerId ? customers[b.customerId] : null)
    return (
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {needsE ? <Badge tone={e?.status === 'registered' ? 'success' : e?.status === 'cancelled' ? 'danger' : 'warning'}>{e?.status === 'registered' ? 'IRN' : e?.status === 'cancelled' ? 'IRN cancelled' : credit ? 'No IRN' : 'No IRN'}</Badge> : null}
        {w?.status === 'generated' ? <Badge tone="success">E-way</Badge> : ewbNeeded(b, settings).needed ? <Badge tone="warning">E-way due</Badge> : null}
      </View>
    )
  }

  return (
    <Screen title="GST invoices" subtitle="B2B register, e-invoice, e-way bill" back right={<IconButton label="Settings" tone="surface" onPress={edit}><Settings size={20} color={c.ink} /></IconButton>}>
      <View style={{ gap: 14, paddingBottom: 20 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <IconButton label="Earlier month" tone="surface" onPress={() => setMonthOffset(monthOffset - 1)}><ChevronLeft size={20} color={c.ink} /></IconButton>
          <T v="h2">{fmtMonth(from)}</T>
          <IconButton label="Later month" tone="surface" onPress={() => setMonthOffset(Math.min(0, monthOffset + 1))}><ChevronRight size={20} color={monthOffset >= 0 ? c.lineStrong : c.ink} /></IconButton>
        </View>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <StatTile label="Invoices" value={String(totals.count)} icon={<FileText size={16} color={c.primary} />} />
          <StatTile label="Taxable value" value={inr(totals.taxable, 0)} tone="accent" />
        </View>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <StatTile label="CGST + SGST" value={inr(totals.cgst + totals.sgst, 0)} tone="success" />
          <StatTile label="IGST" value={inr(totals.igst, 0)} tone="warning" />
        </View>
        <Button label="Export register (CSV)" kind="soft" block disabled={!rows.length} icon={<Download size={18} color={c.primary} />} onPress={() => void shareFile(`b2b-register-${fmtMonth(from).toLowerCase().replace(/\s+/g, '-')}.csv`, toCsv(registerCsv(rows)))} />

        <Notice tone="primary" title="What this app does and does not do" body="It builds the e-invoice and e-way bill files and checks them. It cannot register them: upload the file on the government portal (or through your GST software provider), then paste the answer back on the invoice." />

        <Section title="Invoices">
          {rows.length || others.length ? (
            <Card padded={false}>
              {[...rows.map((r) => ({ id: r.billId, title: r.buyerName || r.buyerGstin, sub: `${r.no} · ${fmtDate(r.date)} · ${r.igst ? 'IGST' : 'CGST + SGST'}`, value: inr(r.total, 0), credit: r.kind === 'Credit note' })),
                ...others.map((b) => ({ id: b.id, title: b.customerId ? customers[b.customerId]?.name ?? 'Customer' : 'Walk-in', sub: `${b.no} · ${fmtDate(b.date)} · no GSTIN`, value: inr(b.total, 0), credit: false }))].map((r, i) => (
                <View key={r.id} style={{ borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
                  <ListRow title={r.title} subtitle={r.sub} value={r.credit ? `−${inr(Math.abs(Number(r.value.replace(/[^0-9.]/g, ''))), 0)}` : r.value} badge={badges(r.id, r.credit)} onPress={() => open(r.id)} />
                </View>
              ))}
            </Card>
          ) : <EmptyState icon={<FileText size={26} color={c.primary} />} title="No invoices to businesses this month" hint="Add the buyer’s GSTIN in the GST invoice section at checkout, or save it on the customer." compact />}
        </Section>
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
    </Screen>
  )
}
