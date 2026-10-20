import React, { useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { variantLabel } from '@/domain/codes'
import { fmtDate, fromInputDate, toInputDate } from '@/domain/dates'
import { inr } from '@/domain/money'
import { fmtQty } from '@/domain/qty'
import { useList, useStore } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { perform, useCan } from '@/data/store'
import { printHtml, sharePdf, whatsApp } from '@/features/share'
import { quotationHtml } from '@/modules/sales-docs/html'
import { canConvertQuote, canEditQuote, daysLeft, effectiveStatus, QUOTE_LABEL, quotationText } from '@/modules/sales-docs/logic/quotes'
import { docTotals } from '@/modules/sales-docs/logic/lines'
import { deleteQuotation, extendQuote, setQuoteStatus } from '@/modules/sales-docs/ops'
import { loadIntoCart } from '@/modules/sales-docs/ui/billing'
import { DateField, isInputDate } from '@/modules/sales-docs/ui/forms'
import { QUOTE_TONE } from '@/modules/sales-docs/ui/tones'
import { Button } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Badge, Card } from '@/ui/primitives'
import { KV, Notice, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { CheckCircle, Pencil, Printer, Receipt, Send, Share, Trash } from '@/ui/icons'
import { ask, toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

/** One quotation: what was offered, where it stands, and the one tap that turns it into a bill. */
export default function QuotationPage() {
  const { c } = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const can = useCan('pos')
  const store = useStore()
  const q = useList('quotations').find((x) => x.id === id)
  const bills = useList('bills')
  const [extending, setExtending] = useState(false)
  const [until, setUntil] = useState('')

  if (!can) return <Screen title="Quotation" back><T tone="mute">Quotations are for people who use the billing counter.</T></Screen>
  if (!q) return <Screen title="Not found" back><T tone="mute">This quotation is no longer here.</T></Screen>
  const now = Date.now()
  const status = effectiveStatus(q, now)
  const t = docTotals(q.items, q.billDiscountType, q.billDiscountValue, store)
  const bill = q.billId ? bills.find((b) => b.id === q.billId) : undefined
  const left = daysLeft(q, now)

  function move(to: 'draft' | 'sent' | 'accepted' | 'rejected') {
    try { perform((s, ctx) => setQuoteStatus(s, q!.id, to, ctx)); toast(to === 'sent' ? 'Marked as sent' : to === 'accepted' ? 'Marked as accepted' : to === 'rejected' ? 'Marked as rejected' : 'Back to draft', 'ok') }
    catch (e) { toast(e instanceof OpError ? e.message : 'Could not change the quotation', 'err') }
  }
  async function convert() {
    if (await loadIntoCart({ items: q!.items, customerId: q!.customerId, discountType: q!.billDiscountType, discountValue: q!.billDiscountValue, link: { quotationId: q!.id } })) router.push('/sell/checkout')
  }
  function extend() {
    if (!isInputDate(until)) { toast('Write the date as YYYY-MM-DD', 'err'); return }
    try { perform((s, ctx) => extendQuote(s, q!.id, fromInputDate(until), ctx)); setExtending(false); toast('New last day saved', 'ok') }
    catch (e) { toast(e instanceof OpError ? e.message : 'Could not extend', 'err') }
  }
  async function remove() {
    if (!(await ask({ title: `Delete ${q!.no}?`, confirm: 'Delete', danger: true }))) return
    try { perform((s, ctx) => deleteQuotation(s, q!.id, ctx)); router.back() } catch (e) { toast(e instanceof OpError ? e.message : 'Could not delete', 'err') }
  }

  return (
    <Screen title={q.no} subtitle={q.partyName} back
      footer={canConvertQuote(q) ? <Button label="Turn into a bill" size="lg" block icon={<Receipt size={18} color={c.onPrimary} />} onPress={convert} /> : undefined}>
      <View style={{ gap: 14, paddingBottom: 14 }}>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Badge tone={QUOTE_TONE[status]}>{QUOTE_LABEL[status]}</Badge>
          {status === 'draft' || status === 'sent' || status === 'accepted' ? <Badge tone={left <= 2 ? 'warning' : 'default'}>{left <= 0 ? 'Last day today' : `${left} day${left === 1 ? '' : 's'} left`}</Badge> : null}
        </View>
        {status === 'expired' ? <Notice tone="warning" title="This quotation has lapsed" body={`The prices were held until ${fmtDate(q.validUntil)}.`} action="Extend" onAction={() => { setUntil(toInputDate(Date.now() + 7 * 86_400_000)); setExtending(true) }} /> : null}
        {bill ? <Notice tone="success" icon={<CheckCircle size={20} color={c.success} />} title={`Billed as ${bill.no}`} body={q.convertedAt ? fmtDate(q.convertedAt) : undefined} action="Open" onAction={() => router.push({ pathname: '/bills/[id]', params: { id: bill.id } })} /> : null}

        <Card>
          <KV k="For" v={q.partyName} />
          {q.partyPhone ? <KV k="Phone" v={q.partyPhone} /> : null}
          <KV k="Dated" v={fmtDate(q.date)} />
          <KV k="Valid until" v={fmtDate(q.validUntil)} />
        </Card>

        <Section title="Items" style={{ marginTop: 6 }}>
          <Card padded={false}>
            {q.items.map((l, i) => (
              <View key={l.variantId} style={{ padding: 14, flexDirection: 'row', gap: 8, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
                <View style={{ flex: 1 }}>
                  <T v="bodyStrong" numberOfLines={1}>{l.name}</T>
                  <T v="caption" tone="mute">{[variantLabel(l.size, l.color), `${fmtQty(l.qty)}${l.unit && l.unit !== 'pc' ? ` ${l.unit}` : ''} × ${inr(l.price)}`].filter(Boolean).join(' · ')}</T>
                </View>
                <T v="num">{inr(t.items[i]?.lineTotal ?? l.price * l.qty, 0)}</T>
              </View>
            ))}
          </Card>
        </Section>

        <Card>
          {t.itemDiscount + t.billDiscount > 0 ? <KV k="Discount" v={`− ${inr(t.itemDiscount + t.billDiscount)}`} tone="success" /> : null}
          <KV k={store.priceIncludesTax ? 'GST included' : 'GST added'} v={inr(t.taxTotal)} />
          <KV k="Total" v={inr(t.total)} strong big />
        </Card>

        {q.notes ? <Card><T v="label" tone="soft">NOTES</T><T>{q.notes}</T></Card> : null}
        {q.terms ? <Card><T v="label" tone="soft">TERMS</T><T tone="soft">{q.terms}</T></Card> : null}

        <View style={{ gap: 10, marginTop: 4 }}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button label="WhatsApp" kind="soft" icon={<Send size={18} color={c.primary} />} style={{ flex: 1 }} onPress={() => whatsApp(quotationText(q, store), q.partyPhone)} />
            <Button label="PDF" kind="outline" icon={<Share size={18} color={c.ink} />} style={{ flex: 1 }} onPress={() => sharePdf(quotationHtml(q, store, now), `${q.no}.pdf`)} />
            <Button label="Print" kind="outline" icon={<Printer size={18} color={c.ink} />} style={{ flex: 1 }} onPress={() => printHtml(quotationHtml(q, store, now))} />
          </View>
          {q.status === 'draft' ? <Button label="Mark as sent" kind="outline" block onPress={() => move('sent')} /> : null}
          {q.status === 'draft' || q.status === 'sent' ? <Button label="Customer accepted" kind="success" block icon={<CheckCircle size={18} color={c.onPrimary} />} onPress={() => move('accepted')} /> : null}
          {q.status === 'draft' || q.status === 'sent' || q.status === 'accepted' ? <Button label="Customer said no" kind="outline" block onPress={() => move('rejected')} /> : null}
          {q.status === 'rejected' ? <Button label="Reopen as draft" kind="outline" block onPress={() => move('draft')} /> : null}
          {canEditQuote(q) ? <Button label="Edit quotation" kind="outline" block icon={<Pencil size={18} color={c.ink} />} onPress={() => router.push({ pathname: '/m/sales-docs/quotations/new', params: { id: q.id } })} /> : null}
          {status === 'expired' ? <Button label="Extend validity" kind="outline" block onPress={() => { setUntil(toInputDate(Date.now() + 7 * 86_400_000)); setExtending(true) }} /> : null}
          {q.status === 'draft' ? <Button label="Delete draft" kind="danger" block icon={<Trash size={18} color={c.danger} />} onPress={remove} /> : null}
        </View>
      </View>
      <Sheet visible={extending} onClose={() => setExtending(false)} title="Extend validity" footer={<Button label="Save" block onPress={extend} />}>
        <DateField label="Valid until" value={until} onChange={setUntil} />
      </Sheet>
    </Screen>
  )
}

