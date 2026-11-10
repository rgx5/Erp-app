import React, { useMemo, useState } from 'react'
import { TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useList, useStore } from '@/data/hooks'
import { useApp, useCan } from '@/data/store'
import { docTotal } from '@/modules/sales-docs/logic/lines'
import { quotePipeline } from '@/modules/sales-docs/logic/pipeline'
import { daysLeft, effectiveStatus, QUOTE_LABEL } from '@/modules/sales-docs/logic/quotes'
import { QUOTE_TONE } from '@/modules/sales-docs/ui/tones'
import type { QuoteStatus } from '@/modules/sales-docs/types'
import { T } from '@/ui/Text'
import { fonts, useTheme } from '@/ui/theme'
import { Plus, Search as SearchIcon } from '@/ui/icons'
import { DataTable, DeskButton, DeskPage, DeskSegmented, KpiStrip, KpiTile, Pill, Toolbar, cellNum, cellText, dtext, type Column } from './kit'

type Filter = '' | 'open' | QuoteStatus
type Row = { id: string; party: string; no: string; date: number; validUntil: number; status: QuoteStatus; left: number; total: number }

/**
 * The desktop Quotations screen: a KPI strip for what is open and what has been billed, a search bar with a status
 * filter, and one dense sortable grid instead of the phone's scrolling cards. Every figure comes from the same
 * `quotePipeline`/`effectiveStatus`/`daysLeft`/`docTotal` the phone `m/sales-docs/quotations/index.tsx` calls.
 */
export function DesktopQuotations() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('pos')
  const store = useStore()
  const quotes = useList('quotations')
  const data = useApp((s) => s.data)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('open')
  const now = Date.now()

  const pipe = useMemo(() => quotePipeline(data, now), [data, now])
  const rows: Row[] = useMemo(() => {
    const n = q.trim().toLowerCase()
    return quotes
      .map((x) => ({ x, status: effectiveStatus(x, now) }))
      .filter((r) => (filter === '' ? true : filter === 'open' ? r.status === 'draft' || r.status === 'sent' || r.status === 'accepted' : r.status === filter))
      .filter((r) => !n || r.x.no.toLowerCase().includes(n) || r.x.partyName.toLowerCase().includes(n) || r.x.partyPhone.includes(n))
      .sort((a, b) => b.x.date - a.x.date)
      .map((r) => ({ id: r.x.id, party: r.x.partyName, no: r.x.no, date: r.x.date, validUntil: r.x.validUntil, status: r.status, left: daysLeft(r.x, now), total: docTotal(r.x.items, r.x.billDiscountType, r.x.billDiscountValue, store) }))
  }, [quotes, q, filter, now, store])

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Quotations" />}>
        <View style={{ padding: 20 }}><T tone="mute">Quotations are for people who use the billing counter.</T></View>
      </DeskPage>
    )
  }

  const columns: Array<Column<Row>> = [
    { key: 'party', label: 'Customer', sortValue: (r) => r.party, render: (r) => cellText(r.party, true) },
    { key: 'no', label: 'Quotation', width: 190, sortValue: (r) => r.no, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cell} numberOfLines={1}>{r.no}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{fmtDayShort(r.date)} · valid till {fmtDayShort(r.validUntil)}</T>
      </View>
    ) },
    { key: 'status', label: 'Status', width: 150, sortValue: (r) => r.status, render: (r) => (
      <View style={{ flexDirection: 'row', gap: 6 }}>
        <Pill tone={QUOTE_TONE[r.status]} label={QUOTE_LABEL[r.status]} />
        {(r.status === 'sent' || r.status === 'draft' || r.status === 'accepted') && r.left <= 2 ? <Pill tone="warning" label={r.left <= 0 ? 'Last day' : `${r.left}d left`} /> : null}
      </View>
    ) },
    { key: 'total', label: 'Total', width: 120, align: 'right', sortValue: (r) => r.total, render: (r) => cellNum(inr(r.total, 0), true) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title="Quotations"
          subtitle={`${quotes.length} in all`}
          right={<DeskButton label="New quotation" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={() => router.push('/m/sales-docs/quotations/new')} />}
        />
      }
    >
      <KpiStrip>
        <KpiTile label="Open" value={inr(pipe.open.value, 0)} tone="primary" delta={`${pipe.open.count} quotation${pipe.open.count === 1 ? '' : 's'}${pipe.expiringSoon ? ` · ${pipe.expiringSoon} expiring` : ''}`} />
        <KpiTile label="Billed" value={inr(pipe.converted.value, 0)} tone="success" delta={pipe.winRatePct === null ? 'No decided quotes yet' : `${pipe.winRatePct}% won`} />
      </KpiStrip>

      <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1, maxWidth: 320, flexDirection: 'row', alignItems: 'center', gap: 8, height: 32, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: c.lineStrong, backgroundColor: c.surface }}>
          <SearchIcon size={14} color={c.inkMute} />
          <TextInput value={q} onChangeText={setQ} placeholder="Search number, name or phone" placeholderTextColor={c.inkMute} autoCorrect={false} autoCapitalize="none"
            style={{ flex: 1, minWidth: 0, color: c.ink, fontFamily: fonts.body, fontSize: 12.5, paddingVertical: 0, outlineWidth: 0 }} />
        </View>
        <DeskSegmented<Filter> value={filter} onChange={setFilter} options={[{ id: 'open', label: 'Open' }, { id: '', label: 'All' }, { id: 'draft', label: 'Drafts' }, { id: 'accepted', label: 'Accepted' }, { id: 'converted', label: 'Billed' }, { id: 'expired', label: 'Expired' }, { id: 'rejected', label: 'Rejected' }]} />
      </View>

      <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable rows={rows} columns={columns} onRowPress={(r) => router.push({ pathname: '/m/sales-docs/quotations/[id]', params: { id: r.id } })} emptyLabel={q || filter !== 'open' ? 'No quotations match' : 'No open quotations'} />
      </View>
    </DeskPage>
  )
}
