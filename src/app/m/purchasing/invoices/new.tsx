import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { fromInputDate, fmtDayShort, toInputDate } from '@/domain/dates'
import { inr, round2 } from '@/domain/money'
import { useList } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { perform, useApp, useCan } from '@/data/store'
import { buildInvoiceLines, GST_RATES, isInterState, ITC_BLOCK_LABEL, ITC_BLOCKS, itcFor, taxTotals } from '@/modules/purchasing/itc'
import { recordPurchaseInvoice } from '@/modules/purchasing/ops-invoices'
import { reversedIds } from '@/modules/purchasing/reversal'
import type { ItcBlock } from '@/modules/purchasing/types'
import { dateOk, supplierOptions } from '@/modules/purchasing/ui/helpers'
import { Button, IconButton } from '@/ui/Button'
import { Field, MoneyField, Segmented, Select } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Card, Chip } from '@/ui/primitives'
import { KV, Notice, Section } from '@/ui/blocks'
import { Plus, Trash } from '@/ui/icons'
import { T } from '@/ui/Text'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

interface Line { description: string; hsn: string; taxable: string; rate: number }
const blank = (): Line => ({ description: '', hsn: '', taxable: '', rate: 18 })

/** Capture a supplier's tax invoice: its lines and GST, and whether the credit (ITC) can be claimed. */
export default function NewPurchaseInvoice() {
  const { c } = useTheme()
  const router = useRouter()
  const params = useLocalSearchParams<{ purchaseId?: string }>()
  const can = useCan('purchases')
  const data = useApp((s) => s.data)
  const suppliers = useList('suppliers')
  const [supplierId, setSupplierId] = useState(data.purchases[params.purchaseId ?? '']?.supplierId ?? '')
  const [purchaseId, setPurchaseId] = useState(params.purchaseId ?? '')
  const [kind, setKind] = useState<'goods' | 'services'>('goods')
  const [head, setHead] = useState('')
  const [invoiceNo, setInvoiceNo] = useState('')
  const [invDate, setInvDate] = useState(toInputDate(Date.now()))
  const [due, setDue] = useState('')
  const [printed, setPrinted] = useState('')
  const [blocked, setBlocked] = useState<ItcBlock>('none')
  const [lines, setLines] = useState<Line[]>([blank()])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const supplier = data.suppliers[supplierId]
  const invoiced = useMemo(() => new Set(Object.values(data.purchaseInvoices).filter((i) => !i.reverses && !reversedIds(Object.values(data.purchaseInvoices)).has(i.id)).map((i) => i.purchaseId)), [data.purchaseInvoices])
  const receipts = useMemo(() => Object.values(data.purchases).filter((p) => p.supplierId === supplierId && !invoiced.has(p.id)).sort((a, b) => b.date - a.date), [data.purchases, supplierId, invoiced])
  const inter = isInterState(data.store, supplier?.gstin)
  const drafts = lines.map((l) => ({ description: l.description, hsn: l.hsn, taxable: Number(l.taxable) || 0, rate: l.rate })).filter((l) => l.taxable > 0)
  const t = taxTotals(buildInvoiceLines(drafts, inter))
  const sum = round2(t.taxable + t.tax)
  const invDateMs = dateOk(invDate) && invDate ? fromInputDate(invDate) : Date.now()
  const itc = supplier && drafts.length ? itcFor({ supplierGstin: supplier.gstin, storeRegistration: data.store?.registrationType, blocked, cgst: t.cgst, sgst: t.sgst, igst: t.igst, invoiceDate: invDateMs, asOf: Date.now() }) : null

  if (!can) return <Screen title="Supplier invoice" back><T tone="mute">Supplier invoices are for the owner and managers.</T></Screen>
  const setLine = (i: number, p: Partial<Line>) => setLines(lines.map((l, k) => (k === i ? { ...l, ...p } : l)))

  function save() {
    if (!dateOk(invDate) || !dateOk(due)) { toast('Write dates as YYYY-MM-DD', 'err'); return }
    setBusy(true)
    try {
      const r = perform((s, ctx) => recordPurchaseInvoice(s, {
        supplierId, invoiceNo, invoiceDate: invDateMs, dueDate: due ? fromInputDate(due) : undefined, kind, head: kind === 'services' ? head : undefined,
        purchaseId: kind === 'goods' && purchaseId ? purchaseId : undefined, lines: drafts, blocked, printedTotal: Number(printed) || undefined, note,
      }, ctx))
      toast(`${r.invoice.no} · ${inr(r.invoice.total, 0)}`, 'ok'); router.back()
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not record the invoice', 'err'); setBusy(false) }
  }

  return (
    <Screen title="Supplier invoice" subtitle="Capture GST for input credit" back footer={<Button label={sum > 0 ? `Save invoice · ${inr(sum, 0)}` : 'Save invoice'} size="lg" block loading={busy} disabled={!supplierId || !drafts.length} onPress={save} />}>
      <View style={{ gap: 16, paddingBottom: 14 }}>
        <Select<string> label="Supplier" value={supplierId} placeholder="Who sent the invoice?" searchable options={supplierOptions(suppliers)} onChange={(v) => { setSupplierId(v); setPurchaseId('') }}
          hint={supplier ? (supplier.gstin ? `GSTIN ${supplier.gstin}` : 'No GSTIN saved — credit cannot be claimed') : undefined} />
        <Segmented value={kind} options={[{ value: 'goods', label: 'Goods' }, { value: 'services', label: 'Services / expense' }]} onChange={setKind} />
        {kind === 'services' ? <Field label="What it was for" value={head} onChangeText={setHead} placeholder="Repairs, Rent, Freight…" /> : null}
        {kind === 'goods' && supplierId ? (
          <Select<string> label="Goods receipt (optional)" value={purchaseId} placeholder="Link to goods you received" options={[{ value: '', label: 'Not linked' }, ...receipts.map((p) => ({ value: p.id, label: `${p.no} · ${fmtDayShort(p.date)}`, sub: inr(p.total, 0) }))]} onChange={setPurchaseId}
            hint="Linking stops the same bill being owed twice" />
        ) : null}
        <Field label="Invoice number" value={invoiceNo} onChangeText={setInvoiceNo} placeholder="As printed on the invoice" />
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}><Field label="Invoice date" value={invDate} onChangeText={setInvDate} placeholder="YYYY-MM-DD" error={dateOk(invDate) ? null : 'YYYY-MM-DD'} /></View>
          <View style={{ flex: 1 }}><Field label="Due date" value={due} onChangeText={setDue} placeholder="YYYY-MM-DD" error={dateOk(due) ? null : 'YYYY-MM-DD'} /></View>
        </View>

        <Section title="Lines" style={{ marginTop: 0 }}>
          <View style={{ gap: 10 }}>
            {lines.map((l, i) => (
              <Card key={i} style={{ gap: 10 }}>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
                  <View style={{ flex: 1 }}><Field label="Description" value={l.description} onChangeText={(v) => setLine(i, { description: v })} /></View>
                  {lines.length > 1 ? <IconButton label="Remove" tone="ghost" size={36} onPress={() => setLines(lines.filter((_, k) => k !== i))}><Trash size={18} color={c.inkMute} /></IconButton> : null}
                </View>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <View style={{ flex: 1 }}><Field label="HSN / SAC" value={l.hsn} onChangeText={(v) => setLine(i, { hsn: v })} keyboardType="number-pad" /></View>
                  <View style={{ flex: 1 }}><MoneyField label="Amount before tax" value={l.taxable} onChange={(v) => setLine(i, { taxable: v })} /></View>
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{GST_RATES.map((r) => <Chip key={r} label={`${r}%`} selected={l.rate === r} onPress={() => setLine(i, { rate: r })} />)}</View>
              </Card>
            ))}
            <Button label="Add a line" kind="soft" block icon={<Plus size={18} color={c.primary} />} onPress={() => setLines([...lines, blank()])} />
          </View>
        </Section>

        <MoneyField label="Total printed on the invoice (optional)" value={printed} onChange={setPrinted} hint="Checked against the lines; a small difference is kept as round-off" />
        <Section title="Input credit" style={{ marginTop: 0 }}>
          <Select<ItcBlock> label="Is credit blocked?" value={blocked} options={ITC_BLOCKS.map((b) => ({ value: b, label: ITC_BLOCK_LABEL[b] }))} onChange={setBlocked} />
        </Section>
        <Field label="Note (optional)" value={note} onChangeText={setNote} />

        {drafts.length ? (
          <Card>
            <KV k="Before tax" v={inr(t.taxable)} />
            {inter ? <KV k="IGST" v={inr(t.igst)} /> : <><KV k="CGST" v={inr(t.cgst)} /><KV k="SGST" v={inr(t.sgst)} /></>}
            <KV k="Invoice total" v={inr(sum)} strong />
          </Card>
        ) : null}
        {itc ? (itc.eligible
          ? <Notice tone="success" title={`Credit of ${inr(itc.cgst + itc.sgst + itc.igst)} can be claimed`} body="It will show in the input credit register." />
          : <Notice tone="warning" title="No input credit on this invoice" body={itc.reason} />) : null}
      </View>
    </Screen>
  )
}
