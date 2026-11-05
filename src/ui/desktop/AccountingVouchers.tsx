import React from 'react'
import { TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import { voucherDebit, VOUCHER_LABEL } from '@/modules/accounting/logic'
import type { Voucher, VoucherType } from '@/modules/accounting/types'
import { T } from '@/ui/Text'
import { fonts, useTheme } from '@/ui/theme'
import { Plus, Search as SearchIcon } from '@/ui/icons'
import { DataTable, DeskButton, DeskPage, DeskSegmented, KpiStrip, KpiTile, Pill, Toolbar, cellNum, cellText, dtext, type Column } from './kit'

type Filter = '' | VoucherType
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: '', label: 'All' }, { id: 'receipt', label: 'Receipts' }, { id: 'payment', label: 'Payments' },
  { id: 'journal', label: 'Journals' }, { id: 'contra', label: 'Contra' }, { id: 'closing', label: 'Year-end' },
]

type Row = { id: string; v: Voucher; reversed: boolean; isReversal: boolean }

export interface DesktopVouchersProps {
  q: string
  setQ: (q: string) => void
  type: Filter
  setType: (t: Filter) => void
  rows: Voucher[]
  isReversed: (v: Voucher) => boolean
  total: number
}

/**
 * The desktop vouchers screen: a KPI strip (count and total of what's listed), a search bar with a type filter, and
 * one dense sortable grid — the desktop twin of `DesktopPurchases`. Every figure comes from `voucherDebit`/
 * `isReversed`/`VOUCHER_LABEL` exactly as `src/app/m/accounting/vouchers/index.tsx` already computes them.
 */
export function DesktopVouchers({ q, setQ, type, setType, rows, isReversed, total }: DesktopVouchersProps) {
  const { c } = useTheme()
  const router = useRouter()

  const data: Row[] = rows.map((v) => ({ id: v.id, v, reversed: isReversed(v), isReversal: !!v.reversesId }))

  const columns: Array<Column<Row>> = [
    { key: 'no', label: 'Voucher', width: 160, sortValue: (r) => r.v.no, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.v.no}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{VOUCHER_LABEL[r.v.type]}</T>
      </View>
    ) },
    { key: 'date', label: 'Date', width: 100, sortValue: (r) => r.v.date, render: (r) => cellText(fmtDayShort(r.v.date)) },
    { key: 'narration', label: 'Narration', sortValue: (r) => r.v.narration, render: (r) => cellText(r.v.narration || '—') },
    { key: 'status', label: 'Status', width: 120, render: (r) => (r.reversed ? <Pill tone="warning" label="Reversed" /> : r.isReversal ? <Pill label="Reversal" /> : null) },
    { key: 'amount', label: 'Amount', width: 130, align: 'right', sortValue: (r) => voucherDebit(r.v.lines), render: (r) => cellNum(inr(voucherDebit(r.v.lines), 2), true) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar title="Vouchers" subtitle={`${rows.length} entries`}
          right={<DeskButton label="New voucher" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={() => router.push('/m/accounting/vouchers/new')} />} />
      }
    >
      <KpiStrip>
        <KpiTile label="Entries" value={String(rows.length)} />
        <KpiTile label="Total" value={inr(total, 2)} tone="primary" />
      </KpiStrip>

      <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1, maxWidth: 320, flexDirection: 'row', alignItems: 'center', gap: 8, height: 32, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: c.lineStrong, backgroundColor: c.surface }}>
          <SearchIcon size={14} color={c.inkMute} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Search number or narration"
            placeholderTextColor={c.inkMute}
            autoCorrect={false}
            autoCapitalize="none"
            style={{ flex: 1, minWidth: 0, color: c.ink, fontFamily: fonts.body, fontSize: 12.5, paddingVertical: 0, outlineWidth: 0 }}
          />
        </View>
        <DeskSegmented<Filter> value={type} onChange={setType} options={FILTERS} />
      </View>

      <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable
          rows={data}
          columns={columns}
          onRowPress={(r) => router.push({ pathname: '/m/accounting/vouchers/[id]', params: { id: r.id } })}
          emptyLabel={q || type ? 'No vouchers match' : 'No vouchers yet'}
        />
      </View>
    </DeskPage>
  )
}
