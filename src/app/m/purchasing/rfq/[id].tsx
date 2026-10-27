import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useVariantViews } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { perform, useApp, useCan } from '@/data/store'
import { compareQuotes, quotesFor, quotesFromLists } from '@/modules/purchasing/quotes'
import { awardRfq, closeRfq, recordQuote } from '@/modules/purchasing/ops-sourcing'
import { Button } from '@/ui/Button'
import { MoneyField, NumberField } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Badge, Card } from '@/ui/primitives'
import { KV, Notice, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { ask, toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

/** One request: who replied, the prices side by side with the cheapest marked, and awarding it into draft purchase orders. */
export default function RfqPage() {
  const { c } = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const can = useCan('purchases')
  const data = useApp((s) => s.data)
  const views = useVariantViews()
  const rfq = data.rfqs[id]
  const quotes = useMemo(() => (rfq ? quotesFor(data, rfq.id) : []), [data, rfq])
  const cmp = useMemo(() => (rfq ? compareQuotes(rfq, quotes) : null), [rfq, quotes])
  const [asking, setAsking] = useState<string | null>(null)
  const [prices, setPrices] = useState<Record<string, string>>({})
  const [freight, setFreight] = useState('')
  const [lead, setLead] = useState('')

  if (!can) return <Screen title="Request" back><T tone="mute">Quotations are for the owner and managers.</T></Screen>
  if (!rfq || !cmp) return <Screen title="Not found" back><T tone="mute">This request is no longer here.</T></Screen>
  const byId = new Map(views.map((v) => [v.id, v]))
  const name = (sid: string) => data.suppliers[sid]?.name ?? 'Supplier'
  const open = rfq.status === 'open'

  function startQuote(sid: string) {
    const q = quotes.find((x) => x.supplierId === sid)
    const listed = quotesFromLists(data, rfq!, Date.now()).find((x) => x.supplierId === sid)
    const base = q?.prices ?? listed?.prices ?? {}
    setPrices(Object.fromEntries(rfq!.items.map((i) => [i.variantId, base[i.variantId] ? String(base[i.variantId]) : ''])))
    setFreight(q?.freight ? String(q.freight) : ''); setLead(String(q?.leadDays ?? listed?.leadDays ?? '')); setAsking(sid)
  }
  function saveQuote() {
    try {
      perform((s, ctx) => recordQuote(s, { rfqId: rfq!.id, supplierId: asking!, prices: Object.fromEntries(Object.entries(prices).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)])), freight: Number(freight) || 0, leadDays: Number(lead) || undefined }, ctx))
      toast('Quote saved', 'ok'); setAsking(null)
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not save the quote', 'err') }
  }
  async function award(mode: 'cheapest-each' | 'single', supplierId?: string) {
    if (!(await ask({ title: 'Create purchase orders?', message: 'Draft orders are made at the quoted prices. They still go through approval before being sent.', confirm: 'Create orders' }))) return
    try {
      const r = perform((s, ctx) => awardRfq(s, rfq!.id, mode === 'single' ? { mode, supplierId: supplierId! } : { mode }, ctx))
      toast(`${r.orders.length} draft ${r.orders.length === 1 ? 'order' : 'orders'} created`, 'ok')
      router.replace('/m/purchasing/orders')
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not award', 'err') }
  }
  async function close() {
    if (!(await ask({ title: 'Close this request?', confirm: 'Close', danger: true }))) return
    try { perform((s, ctx) => closeRfq(s, rfq!.id, ctx)) } catch (e) { toast(e instanceof OpError ? e.message : 'Could not close', 'err') }
  }

  return (
    <Screen title={rfq.no} subtitle={rfq.title} back>
      <View style={{ gap: 14, paddingBottom: 24 }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Badge tone={rfq.status === 'awarded' ? 'success' : rfq.status === 'closed' ? 'default' : 'primary'}>{rfq.status === 'awarded' ? 'Awarded' : rfq.status === 'closed' ? 'Closed' : 'Open'}</Badge>
          {rfq.closesOn ? <Badge>Reply by {fmtDayShort(rfq.closesOn)}</Badge> : null}
        </View>

        <Section title="Suppliers asked" style={{ marginTop: 0 }}>
          <Card padded={false}>
            {rfq.supplierIds.map((sid, i) => {
              const q = quotes.find((x) => x.supplierId === sid)
              return (
                <View key={sid} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
                  <View style={{ flex: 1 }}><T v="bodyStrong">{name(sid)}</T><T v="caption" tone="mute">{q ? `Replied ${fmtDayShort(q.date)}` : 'No reply yet'}</T></View>
                  {open ? <Button label={q ? 'Edit quote' : 'Enter quote'} kind="soft" size="sm" onPress={() => startQuote(sid)} /> : null}
                </View>
              )
            })}
          </Card>
        </Section>

        {cmp.columns.length ? (
          <Section title="Comparison" style={{ marginTop: 0 }}>
            <View style={{ gap: 10 }}>
              {rfq.items.map((it) => (
                <Card key={it.variantId} style={{ gap: 4 }}>
                  <T v="bodyStrong">{byId.get(it.variantId)?.productName ?? 'Item'} × {it.qty}</T>
                  {cmp.columns.map((col) => (
                    <KV key={col.supplierId} k={name(col.supplierId)} v={col.prices[it.variantId] ? inr(col.prices[it.variantId] as number) : 'Not quoted'} tone={cmp.cheapest[it.variantId] === col.supplierId ? 'success' : undefined} sub={cmp.cheapest[it.variantId] === col.supplierId ? 'Lowest' : undefined} />
                  ))}
                </Card>
              ))}
              <Card>
                <T v="label" tone="soft">TOTALS WITH FREIGHT</T>
                {cmp.columns.map((col) => <KV key={col.supplierId} k={name(col.supplierId)} sub={col.complete ? (col.leadDays ? `${col.leadDays} days` : undefined) : `${col.missing} not quoted`} v={col.complete ? inr(col.total, 0) : '—'} strong={cmp.bestSingle?.supplierId === col.supplierId} tone={cmp.bestSingle?.supplierId === col.supplierId ? 'success' : undefined} />)}
              </Card>
              {cmp.splitSaves > 0 && cmp.split ? <Notice tone="success" title={`Splitting saves ${inr(cmp.splitSaves, 0)}`} body={`Buying each item from its cheapest supplier comes to ${inr(cmp.split.total, 0)}.`} /> : null}
            </View>
          </Section>
        ) : null}

        {open && cmp.columns.length ? (
          <View style={{ gap: 10 }}>
            {cmp.split ? <Button label={cmp.split.suppliers.length > 1 ? 'Order each item from its cheapest supplier' : `Order from ${name(cmp.split.suppliers[0])}`} block onPress={() => void award('cheapest-each')} /> : null}
            {cmp.bestSingle ? <Button label={`Order everything from ${name(cmp.bestSingle.supplierId)}`} kind="outline" block onPress={() => void award('single', cmp.bestSingle!.supplierId)} /> : null}
            <Button label="Close without ordering" kind="danger" block onPress={() => void close()} />
          </View>
        ) : null}
        {rfq.poIds.length ? <Button label="See the orders" kind="outline" block onPress={() => router.replace('/m/purchasing/orders')} /> : null}
      </View>
      <Sheet visible={!!asking} onClose={() => setAsking(null)} title={asking ? `Quote from ${name(asking)}` : ''} footer={<Button label="Save quote" size="lg" block onPress={saveQuote} />}>
        <View style={{ gap: 12 }}>
          {rfq.items.map((it) => <MoneyField key={it.variantId} label={`${byId.get(it.variantId)?.productName ?? 'Item'} × ${it.qty}`} value={prices[it.variantId] ?? ''} onChange={(v) => setPrices({ ...prices, [it.variantId]: v })} hint="Price each, before tax. Leave blank if not quoted." />)}
          <MoneyField label="Freight (optional)" value={freight} onChange={setFreight} />
          <NumberField label="Days to deliver (optional)" value={lead} onChange={setLead} />
        </View>
      </Sheet>
    </Screen>
  )
}
