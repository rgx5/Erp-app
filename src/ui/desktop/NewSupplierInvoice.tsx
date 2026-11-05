import React from 'react'
import { View } from 'react-native'
import { fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import type { Purchase, Supplier } from '@/domain/types'
import type { TaxTotals } from '@/modules/purchasing/itc'
import type { ItcBlock, ItcResult } from '@/modules/purchasing/types'
import { Button, IconButton } from '@/ui/Button'
import { Field, MoneyField, Segmented, Select } from '@/ui/Inputs'
import { Card, Chip } from '@/ui/primitives'
import { KV, Notice, Section } from '@/ui/blocks'
import { Plus, Trash } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { DeskButton } from './kit'
import { DesktopSettingsPage } from './SettingsPage'

interface Line { description: string; hsn: string; taxable: string; rate: number }

export interface DesktopNewSupplierInvoiceProps {
  suppliers: Supplier[]
  supplierId: string
  onSupplierChange: (v: string) => void
  supplier: Supplier | undefined
  kind: 'goods' | 'services'
  setKind: (v: 'goods' | 'services') => void
  head: string
  setHead: (v: string) => void
  purchaseId: string
  setPurchaseId: (v: string) => void
  receipts: Purchase[]
  invoiceNo: string
  setInvoiceNo: (v: string) => void
  invDate: string
  setInvDate: (v: string) => void
  invDateOk: boolean
  due: string
  setDue: (v: string) => void
  dueOk: boolean
  lines: Line[]
  setLine: (i: number, p: Partial<Line>) => void
  onAddLine: () => void
  onRemoveLine: (i: number) => void
  gstRates: readonly number[]
  printed: string
  setPrinted: (v: string) => void
  blocked: ItcBlock
  setBlocked: (v: ItcBlock) => void
  itcBlocks: readonly ItcBlock[]
  itcBlockLabel: Record<ItcBlock, string>
  note: string
  setNote: (v: string) => void
  inter: boolean
  drafts: Array<{ description: string; hsn: string; taxable: number; rate: number }>
  t: TaxTotals
  sum: number
  itc: ItcResult | null
  busy: boolean
  canSave: boolean
  onSave: () => void
}

/**
 * The desktop "supplier invoice" form: the same GST lines and input-credit check the phone screen builds
 * (`src/app/m/purchasing/invoices/new.tsx`), centred in `DesktopSettingsPage`'s readable column. No tax or input
 * credit math lives here — `t`, `sum` and `itc` come from the phone screen's own `taxTotals`/`itcFor` calls.
 */
export function DesktopNewSupplierInvoice(p: DesktopNewSupplierInvoiceProps) {
  const { c } = useTheme()
  return (
    <DesktopSettingsPage title="Supplier invoice" subtitle="Capture GST for input credit"
      right={<DeskButton label={p.sum > 0 ? `Save invoice · ${inr(p.sum, 0)}` : 'Save invoice'} tone="primary" disabled={p.busy || !p.canSave} onPress={p.onSave} />}>
      <View style={{ gap: 16 }}>
        <Select<string> label="Supplier" value={p.supplierId} placeholder="Who sent the invoice?" searchable options={p.suppliers.map((s) => ({ value: s.id, label: s.name, sub: s.phone || undefined }))} onChange={p.onSupplierChange}
          hint={p.supplier ? (p.supplier.gstin ? `GSTIN ${p.supplier.gstin}` : 'No GSTIN saved — credit cannot be claimed') : undefined} />
        <Segmented value={p.kind} options={[{ value: 'goods', label: 'Goods' }, { value: 'services', label: 'Services / expense' }]} onChange={p.setKind} />
        {p.kind === 'services' ? <Field label="What it was for" value={p.head} onChangeText={p.setHead} placeholder="Repairs, Rent, Freight…" /> : null}
        {p.kind === 'goods' && p.supplierId ? (
          <Select<string> label="Goods receipt (optional)" value={p.purchaseId} placeholder="Link to goods you received" options={[{ value: '', label: 'Not linked' }, ...p.receipts.map((r) => ({ value: r.id, label: `${r.no} · ${fmtDayShort(r.date)}`, sub: inr(r.total, 0) }))]} onChange={p.setPurchaseId}
            hint="Linking stops the same bill being owed twice" />
        ) : null}
        <Field label="Invoice number" value={p.invoiceNo} onChangeText={p.setInvoiceNo} placeholder="As printed on the invoice" />
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}><Field label="Invoice date" value={p.invDate} onChangeText={p.setInvDate} placeholder="YYYY-MM-DD" error={p.invDateOk ? null : 'YYYY-MM-DD'} /></View>
          <View style={{ flex: 1 }}><Field label="Due date" value={p.due} onChangeText={p.setDue} placeholder="YYYY-MM-DD" error={p.dueOk ? null : 'YYYY-MM-DD'} /></View>
        </View>
      </View>

      <Section title="Lines" style={{ marginTop: 18 }}>
        <View style={{ gap: 10 }}>
          {p.lines.map((l, i) => (
            <Card key={i} style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
                <View style={{ flex: 1 }}><Field label="Description" value={l.description} onChangeText={(v) => p.setLine(i, { description: v })} /></View>
                {p.lines.length > 1 ? <IconButton label="Remove" tone="ghost" size={36} onPress={() => p.onRemoveLine(i)}><Trash size={18} color={c.inkMute} /></IconButton> : null}
              </View>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ flex: 1 }}><Field label="HSN / SAC" value={l.hsn} onChangeText={(v) => p.setLine(i, { hsn: v })} keyboardType="number-pad" /></View>
                <View style={{ flex: 1 }}><MoneyField label="Amount before tax" value={l.taxable} onChange={(v) => p.setLine(i, { taxable: v })} /></View>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{p.gstRates.map((r) => <Chip key={r} label={`${r}%`} selected={l.rate === r} onPress={() => p.setLine(i, { rate: r })} />)}</View>
            </Card>
          ))}
          <Button label="Add a line" kind="soft" block icon={<Plus size={18} color={c.primary} />} onPress={p.onAddLine} />
        </View>
      </Section>

      <View style={{ marginTop: 18, gap: 16 }}>
        <MoneyField label="Total printed on the invoice (optional)" value={p.printed} onChange={p.setPrinted} hint="Checked against the lines; a small difference is kept as round-off" />
        <Section title="Input credit" style={{ marginTop: 0 }}>
          <Select<ItcBlock> label="Is credit blocked?" value={p.blocked} options={p.itcBlocks.map((b) => ({ value: b, label: p.itcBlockLabel[b] }))} onChange={p.setBlocked} />
        </Section>
        <Field label="Note (optional)" value={p.note} onChangeText={p.setNote} />

        {p.drafts.length ? (
          <Card>
            <KV k="Before tax" v={inr(p.t.taxable)} />
            {p.inter ? <KV k="IGST" v={inr(p.t.igst)} /> : <><KV k="CGST" v={inr(p.t.cgst)} /><KV k="SGST" v={inr(p.t.sgst)} /></>}
            <KV k="Invoice total" v={inr(p.sum)} strong />
          </Card>
        ) : null}
        {p.itc ? (p.itc.eligible
          ? <Notice tone="success" title={`Credit of ${inr(p.itc.cgst + p.itc.sgst + p.itc.igst)} can be claimed`} body="It will show in the input credit register." />
          : <Notice tone="warning" title="No input credit on this invoice" body={p.itc.reason} />) : null}
      </View>
    </DesktopSettingsPage>
  )
}
