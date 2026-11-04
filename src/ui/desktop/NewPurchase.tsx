import React from 'react'
import { ScrollView, View } from 'react-native'
import { variantLabel } from '@/domain/codes'
import { inr, inr0, round2 } from '@/domain/money'
import type { GrnBuilt, GrnDraftLine, InvoiceCheck } from '@/domain/purchasing'
import { fmtQty, isFrac, unitName } from '@/domain/qty'
import { needsPricing } from '@/domain/pricing'
import type { Supplier } from '@/domain/types'
import type { VariantView } from '@/domain/views'
import type { IndustryPack } from '@/industries/types'
import { Button, IconButton } from '@/ui/Button'
import { Field, MoneyField, NumberField, Segmented, Select } from '@/ui/Inputs'
import { Badge, Card } from '@/ui/primitives'
import { KV, Notice, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Plus, ScanBarcode, Trash, UserPlus } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { PanelSlot } from '@/modules/PanelSlot'
import { DeskButton, DeskPage, Toolbar } from './kit'

type PayMode = 'full' | 'later' | 'part'

export interface DesktopNewPurchaseProps {
  labels: IndustryPack['labels']
  suppliers: Supplier[]
  supplierId: string
  setSupplierId: (v: string) => void
  lines: GrnDraftLine[]
  patch: (variantId: string, p: Partial<GrnDraftLine>) => void
  onRemoveLine: (variantId: string) => void
  byId: Map<string, VariantView>
  built: GrnBuilt
  invoiceRef: string
  setInvoiceRef: (v: string) => void
  invoiceTotal: string
  setInvoiceTotal: (v: string) => void
  date: string
  setDate: (v: string) => void
  notes: string
  setNotes: (v: string) => void
  ext: Record<string, unknown>
  onSetExt: (moduleId: string, value: unknown) => void
  onSetPanelQty: (variantId: string, qty: number) => void
  payMode: PayMode
  setPayMode: (v: PayMode) => void
  part: string
  setPart: (v: string) => void
  total: number
  paid: number
  check: InvoiceCheck | null
  zeroCost: number
  errors: { supplier: string | null; lines: string | null; paid: string | null; date: string | null }
  tried: boolean
  busy: boolean
  onAddItem: () => void
  onScan: () => void
  onNewSupplier: () => void
  onSave: () => void
}

/**
 * The desktop "Receive stock" screen: a `DeskPage`/`Toolbar` shell (so it carries the same app chrome as every other
 * desktop screen) around the exact form `src/app/purchases/new.tsx` already builds, centred in a readable column
 * instead of stretched edge-to-edge. No pricing, stock or tax logic lives here — `built`, `total`, `paid`, `check`
 * and every field come from the phone screen unchanged; this file only re-homes the same `Field`/`Select`/`Card`
 * controls under desktop chrome, exactly as the task calls for.
 */
export function DesktopNewPurchase({
  labels, suppliers, supplierId, setSupplierId, lines, patch, onRemoveLine, byId, built,
  invoiceRef, setInvoiceRef, invoiceTotal, setInvoiceTotal, date, setDate, notes, setNotes,
  ext, onSetExt, onSetPanelQty, payMode, setPayMode, part, setPart, total, paid, check, zeroCost,
  errors, tried, busy, onAddItem, onScan, onNewSupplier, onSave,
}: DesktopNewPurchaseProps) {
  const { c } = useTheme()

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title="Receive stock"
          subtitle={built.items.length ? `${built.items.length} ${built.items.length === 1 ? 'line' : 'lines'} · ${inr(total)}` : 'Goods from a supplier'}
          right={<DeskButton label={busy ? 'Saving…' : total > 0 ? `Receive stock · ${inr(total)}` : 'Receive stock'} tone="primary" disabled={busy} onPress={onSave} />}
        />
      }
    >
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ alignItems: 'center', padding: 28 }}>
        <View style={{ width: '100%', maxWidth: 780, gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Select<string> label="Supplier" value={supplierId} placeholder="Who sent it?" searchable error={tried ? errors.supplier : null}
                options={suppliers.map((s) => ({ value: s.id, label: s.name, sub: s.phone || undefined })).sort((a, b) => a.label.localeCompare(b.label))} onChange={setSupplierId} />
            </View>
            <IconButton label="New supplier" tone="primary" size={50} onPress={onNewSupplier}><UserPlus size={20} color={c.primary} /></IconButton>
          </View>

          <Section title="Items received" style={{ marginTop: 18 }}>
            <View style={{ gap: 10 }}>
              {lines.map((l) => {
                const v = byId.get(l.variantId)
                if (!v) return null
                const frac = isFrac(v)
                const qty = Number(l.qty) || 0
                const cost = Number(l.cost) || 0
                const label = variantLabel(v.size, v.color)
                return (
                  <Card key={l.variantId} padded={false}>
                    <View style={{ padding: 14, gap: 12 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <View style={{ flex: 1, gap: 1 }}>
                          <T v="bodyStrong" numberOfLines={1}>{v.productName}</T>
                          <T v="caption" tone="mute" numberOfLines={1}>{[label, v.sku, v.trackStock ? `${fmtQty(v.stock)} in stock` : null].filter(Boolean).join(' · ')}</T>
                        </View>
                        <IconButton label="Remove" tone="ghost" size={36} onPress={() => onRemoveLine(l.variantId)}><Trash size={17} color={c.inkMute} /></IconButton>
                      </View>
                      <View style={{ flexDirection: 'row', gap: 10 }}>
                        <View style={{ flex: 1 }}><NumberField label={`Quantity (${unitName(v).toLowerCase()})`} value={l.qty} onChange={(t) => patch(l.variantId, { qty: t })} decimals={frac} placeholder="0" /></View>
                        <View style={{ flex: 1 }}><MoneyField label="Cost each" value={l.cost} onChange={(t) => patch(l.variantId, { cost: t })} /></View>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        {v.cost > 0 && cost > 0 && cost !== v.cost ? <Badge tone={cost > v.cost ? 'warning' : 'success'}>{cost > v.cost ? '▲' : '▼'} from {inr0(v.cost)}</Badge> : null}
                        {needsPricing(v) ? <Badge tone="accent">No selling price yet</Badge> : null}
                        <T v="num" style={{ marginLeft: 'auto' }}>{qty > 0 && cost > 0 ? inr(round2(qty * cost)) : ''}</T>
                      </View>
                    </View>
                  </Card>
                )
              })}
              {tried && errors.lines ? <T v="caption" tone="danger">{errors.lines}</T> : null}
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}><Button label={`Add ${labels.item.toLowerCase()}`} kind="soft" block icon={<Plus size={19} color={c.primary} />} onPress={onAddItem} /></View>
                <View style={{ flex: 1 }}><Button label="Scan" kind="soft" block icon={<ScanBarcode size={19} color={c.primary} />} onPress={onScan} /></View>
              </View>
              {built.skipped > 0 ? <T v="caption" tone="mute">{built.skipped} {built.skipped === 1 ? 'line has' : 'lines have'} no quantity and will be left out.</T> : null}
            </View>
          </Section>

          <PanelSlot slot="receipt" items={built.items.map((i) => ({ variantId: i.variantId, qty: i.qty, cost: i.cost }))} ext={ext} setExt={onSetExt} setQty={onSetPanelQty} />

          <Section title="The supplier’s bill" style={{ marginTop: 18 }}>
            <View style={{ gap: 14 }}>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}><Field label="Bill number" value={invoiceRef} onChangeText={setInvoiceRef} autoCapitalize="characters" placeholder="Optional" /></View>
                <View style={{ flex: 1 }}><Field label="Date" value={date} onChangeText={setDate} keyboardType="numbers-and-punctuation" mono maxLength={10} error={tried ? errors.date : null} /></View>
              </View>
              <MoneyField label="Total on their bill" value={invoiceTotal} onChange={setInvoiceTotal} hint="Optional — we’ll check your receipt against it" />
              {check ? (
                check.ok
                  ? <Notice tone="success" title="Matches the supplier’s bill" body={`Your receipt totals ${inr(total)}.`} />
                  : <Notice tone="warning" title={`${inr(Math.abs(check.diff))} ${check.diff > 0 ? 'more' : 'less'} than their bill`} body={`You’ve entered ${inr(total)}; they billed ${inr(Number(invoiceTotal))}. Check quantities, costs and any missing lines — or carry on if the difference is expected.`} />
              ) : null}
            </View>
          </Section>

          <Section title="Payment" style={{ marginTop: 18 }}>
            <View style={{ gap: 14 }}>
              <Segmented<PayMode> value={payMode} onChange={setPayMode} options={[{ value: 'full', label: 'Paid in full' }, { value: 'part', label: 'Part paid' }, { value: 'later', label: 'Pay later' }]} />
              {payMode === 'part' ? <MoneyField label="Paid now" value={part} onChange={setPart} error={tried ? errors.paid : null} /> : null}
              <Card flat>
                <KV k="Total" v={inr(total)} strong />
                <KV k="Paid" v={inr(paid)} tone={paid ? 'success' : undefined} />
                <KV k="Still owed to supplier" v={inr(Math.max(0, round2(total - paid)))} tone={total - paid > 0 ? 'warning' : undefined} />
              </Card>
              <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline />
              {zeroCost ? <Notice tone="accent" title={`${zeroCost} ${zeroCost === 1 ? 'line has' : 'lines have'} no cost`} body="Profit reports will treat them as free. Add the cost if you know it." /> : null}
            </View>
          </Section>
        </View>
      </ScrollView>
    </DeskPage>
  )
}
