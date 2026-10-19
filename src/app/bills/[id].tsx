import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { fmtDateTime } from '@/domain/dates'
import { inr, round2 } from '@/domain/money'
import { fmtQty, fmtQtyUnit, qtyStep, rulesOfBillItem, round3 } from '@/domain/qty'
import { planReturn, creditNotesFor } from '@/domain/returns'
import { invoiceHtml, isCreditNote, paymentSummary, receiptHtml, receiptText } from '@/domain/receipt'
import { variantLabel } from '@/domain/codes'
import { useIndustry, useLabels, useList, useStore } from '@/data/hooks'
import { OpError, processReturn } from '@/data/ops'
import { perform, useApp, useCan } from '@/data/store'
import { printHtml, sharePdf, whatsApp } from '@/features/share'
import { Button } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { Avatar, Badge, Card, Group, Tap } from '@/ui/primitives'
import { Segmented, Select } from '@/ui/Inputs'
import { KV, Notice, Section } from '@/ui/blocks'
import { Sheet } from '@/ui/Sheet'
import { T } from '@/ui/Text'
import { FileText, Printer, Return, Share } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

export default function BillDetail() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { c } = useTheme()
  const router = useRouter()
  const store = useStore()
  const labels = useLabels()
  const pack = useIndustry()
  const bill = useApp((s) => s.data.bills[id])
  const bills = useList('bills')
  const customer = useApp((s) => (bill?.customerId ? s.data.customers[bill.customerId] : null)) ?? null
  const seller = useApp((s) => (bill ? s.data.users[bill.soldBy ?? bill.cashierId] : null)) ?? null
  const canPos = useCan('pos')
  const [returning, setReturning] = useState(false)

  const notes = useMemo(() => (bill ? creditNotesFor(bills, bill.id) : []), [bills, bill])
  if (!bill) return <Screen title="Not found" back><T tone="mute">This bill is no longer here.</T></Screen>

  const credit = isCreditNote(bill)
  const ctx = { bill, store, customer, seller }
  const canReturn = canPos && !credit && bill.status !== 'held' && bill.items.some((i) => round3(i.qty - i.returnedQty) > 0)
  const original = credit && bill.refundOfBillId ? useApp.getState().data.bills[bill.refundOfBillId] : null

  return (
    <Screen title={bill.no} subtitle={fmtDateTime(bill.date)} back
      right={bill.status === 'partial-return' ? <Badge tone="warning">Part returned</Badge> : bill.status === 'returned' && !credit ? <Badge tone="danger">Returned</Badge> : credit ? <Badge tone="danger">Credit note</Badge> : bill.status === 'held' ? <Badge tone="accent">Parked</Badge> : <Badge tone="success">Paid</Badge>}
      footer={bill.status === 'held' ? undefined : (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button label="WhatsApp" kind="success" icon={<Share size={18} color="#fff" />} onPress={() => void whatsApp(receiptText(ctx), customer?.phone)} />
          <Button label="Print" kind="outline" icon={<Printer size={18} color={c.ink} />} onPress={() => void printHtml(receiptHtml(ctx))} />
          <View style={{ flex: 1 }}><Button label="PDF" kind="outline" block icon={<FileText size={18} color={c.ink} />} onPress={() => void sharePdf(invoiceHtml(ctx), `${bill.no}.pdf`)} /></View>
        </View>
      )}>
      <View style={{ gap: 14 }}>
        <Card style={{ alignItems: 'center', gap: 2 }}>
          <T v="label" tone="mute">{credit ? 'REFUNDED' : 'TOTAL'}</T>
          <T v="display" tone={credit ? 'danger' : 'default'}>{inr(bill.total, 2)}</T>
          <T v="caption" tone="mute">{paymentSummary(bill) || 'No payment taken'}</T>
        </Card>

        {original ? <Notice tone="primary" title={`Return against ${original.no}`} action="Open" onAction={() => router.push({ pathname: '/bills/[id]', params: { id: original.id } })} /> : null}
        {bill.notes && credit ? <T v="caption" tone="soft">{bill.notes}</T> : null}

        {customer ? (
          <Tap onPress={() => router.push({ pathname: '/customers/[id]', params: { id: customer.id } })} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Avatar name={customer.name} size={40} />
            <View style={{ flex: 1 }}><T v="bodyStrong">{customer.name}</T><T v="caption" tone="mute">{customer.phone}</T></View>
            {bill.loyaltyEarned > 0 ? <Badge tone="success">+{bill.loyaltyEarned} pts</Badge> : null}
          </Tap>
        ) : null}

        <Section title="Items" style={{ marginTop: 6 }}>
          <Group>
            {bill.items.map((i, n) => (
              <View key={n} style={{ padding: 14, gap: 3 }}>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <T v="bodyStrong" numberOfLines={2}>{i.name}</T>
                    <T v="caption" tone="mute">{[variantLabel(i.size, i.color), i.sku].filter(Boolean).join(' · ')}</T>
                  </View>
                  <T v="num" tone={credit ? 'danger' : 'default'}>{inr(i.lineTotal, 2)}</T>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <T v="caption" tone="soft">{fmtQtyUnit(i.qty, rulesOfBillItem(i))} × {inr(i.price)}</T>
                  {i.discountAmount > 0 ? <T v="caption" tone="success">−{inr(i.discountAmount)}</T> : null}
                  {i.returnedQty > 0 ? <Badge tone="danger">{fmtQty(i.returnedQty)} returned</Badge> : null}
                  <T v="micro" tone="mute" style={{ marginLeft: 'auto' }}>GST {i.taxRate}%</T>
                </View>
              </View>
            ))}
          </Group>
        </Section>

        <Card>
          <KV k="Items total (MRP)" v={inr(Math.abs(bill.grossMrp))} />
          {bill.itemDiscount + bill.billDiscount > 0 ? <KV k={`Discounts${bill.coupon ? ` (${bill.coupon})` : ''}`} v={`− ${inr(bill.itemDiscount + bill.billDiscount)}`} tone="success" /> : null}
          <KV k="Taxable value" v={inr(Math.abs(bill.taxableTotal))} />
          <KV k="CGST" v={inr(Math.abs(bill.cgstTotal))} />
          <KV k="SGST" v={inr(Math.abs(bill.sgstTotal))} />
          {bill.roundOff ? <KV k="Round off" v={inr(bill.roundOff)} /> : null}
          <View style={{ height: 1, backgroundColor: c.line, marginVertical: 6 }} />
          <KV k={credit ? 'Refund' : 'Total'} v={inr(Math.abs(bill.total))} strong big />
        </Card>

        {seller ? <T v="caption" tone="mute">Served by {seller.name}{seller.code ? ` · No. ${seller.code}` : ''}</T> : null}

        {notes.length ? (
          <Section title="Credit notes">
            <Group>
              {notes.map((n) => (
                <Tap key={n.id} onPress={() => router.push({ pathname: '/bills/[id]', params: { id: n.id } })} style={{ flexDirection: 'row', alignItems: 'center', padding: 14, gap: 10 }}>
                  <View style={{ flex: 1 }}><T v="bodyStrong">{n.no}</T><T v="caption" tone="mute">{fmtDateTime(n.date)}</T></View>
                  <T v="num" tone="danger">{inr(n.total, 2)}</T>
                </Tap>
              ))}
            </Group>
          </Section>
        ) : null}

        {canReturn ? <Button label={`Return / exchange · ${labels.items.toLowerCase()}`} kind="soft" block size="lg" icon={<Return size={18} color={c.primary} />} onPress={() => setReturning(true)} /> : null}
      </View>

      {returning ? <ReturnSheet billId={bill.id} reasons={pack.returnReasons} onClose={() => setReturning(false)} onDone={(noteId) => { setReturning(false); router.replace({ pathname: '/bills/[id]', params: { id: noteId } }) }} /> : null}
    </Screen>
  )
}

function ReturnSheet({ billId, reasons, onClose, onDone }: { billId: string; reasons: string[]; onClose: () => void; onDone: (creditNoteId: string) => void }) {
  const { c } = useTheme()
  const store = useStore()
  const bills = useList('bills')
  const bill = bills.find((b) => b.id === billId)!
  const hasCustomer = !!bill.customerId
  const [qty, setQty] = useState<Record<string, number>>({})
  const [mode, setMode] = useState<'cash' | 'credit'>('cash')
  const [reason, setReason] = useState(reasons[0] ?? '')

  const lines = Object.entries(qty).map(([variantId, q]) => ({ variantId, qty: q })).filter((l) => l.qty > 0)
  const plan = useMemo(() => planReturn(bill, creditNotesFor(bills, bill.id), lines), [bill, bills, qty]) // eslint-disable-line react-hooks/exhaustive-deps
  const ageDays = Math.floor((Date.now() - bill.date) / 86_400_000)
  const late = (store.returnWindowDays ?? 0) > 0 && ageDays > (store.returnWindowDays ?? 0)

  function submit() {
    try {
      const r = perform((s, ctx) => processReturn(s, bill.id, lines, mode, ctx, reason))
      toast(`${r.creditNote.no} — refund ${inr(Math.abs(r.creditNote.total), 0)} by ${mode === 'cash' ? 'cash' : 'store credit'}`, 'ok')
      onDone(r.creditNote.id)
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not process the return', 'err') }
  }

  return (
    <Sheet visible onClose={onClose} title="Return / exchange" subtitle={`Against ${bill.no}`} full
      footer={<Button label={plan ? `Refund ${inr(plan.total, 0)}` : 'Choose what is coming back'} size="lg" block disabled={!plan} onPress={submit} />}>
      <View style={{ gap: 16, paddingBottom: 10 }}>
        {late ? <Notice tone="warning" title={`${ageDays} days old`} body={`Outside the ${store.returnWindowDays}-day window — allowed, but recorded.`} /> : null}
        <View style={{ gap: 10 }}>
          {bill.items.map((it) => {
            const left = round3(it.qty - it.returnedQty)
            const r = rulesOfBillItem(it)
            const step = qtyStep(r)
            const q = qty[it.variantId] ?? 0
            return (
              <View key={it.variantId} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, opacity: left <= 0 ? 0.45 : 1 }}>
                <View style={{ flex: 1 }}>
                  <T v="bodyStrong" numberOfLines={1}>{it.name}</T>
                  <T v="caption" tone="mute">{[variantLabel(it.size, it.color), left > 0 ? `${fmtQtyUnit(left, r)} to return` : 'All returned'].filter(Boolean).join(' · ')}</T>
                </View>
                {left > 0 ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Tap onPress={() => setQty({ ...qty, [it.variantId]: Math.max(0, round3(q - step)) })} style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: c.sunken, alignItems: 'center', justifyContent: 'center' }}><T v="h2">−</T></Tap>
                    <T v="num" style={{ minWidth: 28, textAlign: 'center' }}>{fmtQty(q)}</T>
                    <Tap onPress={() => setQty({ ...qty, [it.variantId]: Math.min(left, round3(q + step)) })} style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: c.primaryTint, alignItems: 'center', justifyContent: 'center' }}><T v="h2" tone="primary">+</T></Tap>
                  </View>
                ) : null}
              </View>
            )
          })}
        </View>
        <Segmented value={mode} options={[{ value: 'cash', label: 'Cash refund' }, { value: 'credit', label: 'Store credit' }]} onChange={(m) => { if (m === 'credit' && !hasCustomer) { toast('Attach a customer to the sale to refund as store credit', 'err'); return } setMode(m) }} />
        <Select label="Reason" value={reason} options={reasons.map((r) => ({ value: r, label: r }))} onChange={setReason} />
        {plan ? (
          <Card flat>
            <KV k="Refund" v={inr(plan.total, 2)} strong />
            {plan.loyaltyReverse > 0 ? <KV k="Points taken back" v={`−${plan.loyaltyReverse}`} /> : null}
            {plan.complete ? <T v="caption" tone="mute">This returns the whole bill{plan.roundOff ? ` — including its ${inr(Math.abs(plan.roundOff))} round-off` : ''}.</T> : null}
          </Card>
        ) : null}
      </View>
    </Sheet>
  )
}

void round2
