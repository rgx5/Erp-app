import React from 'react'
import { ScrollView, View } from 'react-native'
import { fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import type { DataState } from '@/data/state'
import type { Comparison } from '@/modules/purchasing/quotes'
import type { Rfq, RfqQuote } from '@/modules/purchasing/types'
import type { VariantView } from '@/domain/views'
import { Button } from '@/ui/Button'
import { MoneyField, NumberField } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { Notice } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { toneColor, useTheme } from '@/ui/theme'
import { DataTable, DeskButton, DeskPage, dtext, KpiStrip, KpiTile, Pill, SplitPane, Toolbar, cellText, type Column } from './kit'

export interface DesktopRfqDetailProps {
  rfq: Rfq
  data: DataState
  quotes: RfqQuote[]
  cmp: Comparison
  asking: string | null
  setAsking: (v: string | null) => void
  prices: Record<string, string>
  setPrices: (v: Record<string, string>) => void
  freight: string
  setFreight: (v: string) => void
  lead: string
  setLead: (v: string) => void
  byId: Map<string, VariantView>
  onStartQuote: (supplierId: string) => void
  onSaveQuote: () => void
  onAward: (mode: 'cheapest-each' | 'single', supplierId?: string) => void
  onClose: () => void
  onSeeOrders: () => void
}

type ItemRow = { id: string; name: string; qty: number }

/**
 * The desktop request-for-quotation screen: a toolbar and KPI strip, a dense comparison grid — one column per
 * supplier asked, the cheapest price picked out — and a side panel to enter or edit a supplier's quote and award
 * the request. The comparison itself (`cmp`), the quotes and every award/close handler are passed down from
 * `src/app/m/purchasing/rfq/[id].tsx` exactly as the phone screen computes them (`compareQuotes`); this file only
 * lays the same data out as a grid instead of stacked cards.
 */
export function DesktopRfqDetail({ rfq, data, quotes, cmp, asking, setAsking, prices, setPrices, freight, setFreight, lead, setLead, byId, onStartQuote, onSaveQuote, onAward, onClose, onSeeOrders }: DesktopRfqDetailProps) {
  const { c } = useTheme()
  const name = (sid: string) => data.suppliers[sid]?.name ?? 'Supplier'
  const open = rfq.status === 'open'

  const rows: ItemRow[] = rfq.items.map((it) => ({ id: it.variantId, name: byId.get(it.variantId)?.productName ?? 'Item', qty: it.qty }))

  const columns: Array<Column<ItemRow>> = [
    { key: 'item', label: 'Item', sortValue: (r) => r.name, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.name}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]}>Qty {r.qty}</T>
      </View>
    ) },
    ...cmp.columns.map((col): Column<ItemRow> => ({
      key: col.supplierId, label: name(col.supplierId), width: 140, align: 'right',
      sortValue: (r) => col.prices[r.id] ?? -1,
      render: (r) => {
        const p = col.prices[r.id]
        const isCheapest = cmp.cheapest[r.id] === col.supplierId
        return p !== undefined
          ? <T style={[dtext.num, { color: isCheapest ? toneColor(c, 'success') : c.ink }]}>{inr(p)}</T>
          : <T style={[dtext.tiny, { color: c.inkMute }]}>Not quoted</T>
      },
    })),
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title={rfq.no}
          subtitle={rfq.title}
          right={
            <>
              {rfq.poIds.length ? <DeskButton label="See the orders" onPress={onSeeOrders} /> : null}
              {open && cmp.columns.length ? <DeskButton label="Close without ordering" tone="danger" onPress={onClose} /> : null}
              {open && cmp.bestSingle ? <DeskButton label={`Order all from ${name(cmp.bestSingle.supplierId)}`} onPress={() => onAward('single', cmp.bestSingle!.supplierId)} /> : null}
              {open && cmp.split ? <DeskButton label={cmp.split.suppliers.length > 1 ? 'Order each item from its cheapest supplier' : `Order from ${name(cmp.split.suppliers[0])}`} tone="primary" onPress={() => onAward('cheapest-each')} /> : null}
            </>
          }
        />
      }
    >
      <KpiStrip>
        <KpiTile label="Status" value={rfq.status === 'awarded' ? 'Awarded' : rfq.status === 'closed' ? 'Closed' : 'Open'} tone={rfq.status === 'awarded' ? 'success' : rfq.status === 'closed' ? 'default' : 'primary'} delta={rfq.closesOn ? `Reply by ${fmtDayShort(rfq.closesOn)}` : undefined} />
        <KpiTile label="Replies" value={`${quotes.length} / ${rfq.supplierIds.length}`} tone={quotes.length === rfq.supplierIds.length ? 'success' : 'warning'} delta="Suppliers asked" />
        {cmp.bestSingle ? <KpiTile label="Best single total" value={inr(cmp.bestSingle.total, 0)} tone="success" delta={name(cmp.bestSingle.supplierId)} /> : null}
        {cmp.splitSaves > 0 ? <KpiTile label="Splitting saves" value={inr(cmp.splitSaves, 0)} tone="success" delta="Buying each item at its best price" /> : null}
      </KpiStrip>

      <SplitPane widths={['flex', 340]}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 14 }}>
          {cmp.columns.length ? (
            <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden', minHeight: 200 }}>
              <DataTable rows={rows} columns={columns} emptyLabel="No items on this request" />
            </View>
          ) : (
            <View style={{ padding: 20, alignItems: 'center' }}><T tone="mute">No supplier has quoted yet.</T></View>
          )}

          {cmp.columns.length ? (
            <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}>
              <T style={[dtext.label, { color: c.inkMute, marginBottom: 6 }]}>Totals with freight</T>
              {cmp.columns.map((col) => (
                <View key={col.supplierId} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <T style={dtext.cell}>{name(col.supplierId)}</T>
                    {cmp.bestSingle?.supplierId === col.supplierId ? <Pill tone="success" label="Lowest" /> : null}
                  </View>
                  <T style={dtext.numStrong}>{col.complete ? inr(col.total, 0) : `${col.missing} not quoted`}</T>
                </View>
              ))}
            </View>
          ) : null}

          {cmp.splitSaves > 0 && cmp.split ? <Notice tone="success" title={`Splitting saves ${inr(cmp.splitSaves, 0)}`} body={`Buying each item from its cheapest supplier comes to ${inr(cmp.split.total, 0)}.`} /> : null}
        </ScrollView>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 10 }}>
          <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
            <View style={{ padding: 14, paddingBottom: 6 }}><T style={[dtext.label, { color: c.inkMute }]}>Suppliers asked</T></View>
            {rfq.supplierIds.map((sid, i) => {
              const q = quotes.find((x) => x.supplierId === sid)
              return (
                <View key={sid} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, paddingTop: i ? 10 : 0, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
                  <View style={{ flex: 1 }}>
                    <T style={dtext.cellStrong}>{name(sid)}</T>
                    <T style={[dtext.tiny, { color: c.inkMute }]}>{q ? `Replied ${fmtDayShort(q.date)}` : 'No reply yet'}</T>
                  </View>
                  {open ? <DeskButton label={q ? 'Edit quote' : 'Enter quote'} onPress={() => onStartQuote(sid)} /> : null}
                </View>
              )
            })}
          </View>
        </ScrollView>
      </SplitPane>

      <Sheet visible={!!asking} onClose={() => setAsking(null)} title={asking ? `Quote from ${name(asking)}` : ''} footer={<Button label="Save quote" size="lg" block onPress={onSaveQuote} />}>
        <View style={{ gap: 12 }}>
          {rfq.items.map((it) => <MoneyField key={it.variantId} label={`${byId.get(it.variantId)?.productName ?? 'Item'} × ${it.qty}`} value={prices[it.variantId] ?? ''} onChange={(v) => setPrices({ ...prices, [it.variantId]: v })} hint="Price each, before tax. Leave blank if not quoted." />)}
          <MoneyField label="Freight (optional)" value={freight} onChange={setFreight} />
          <NumberField label="Days to deliver (optional)" value={lead} onChange={setLead} />
        </View>
      </Sheet>
    </DeskPage>
  )
}
