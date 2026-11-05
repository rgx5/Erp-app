import React from 'react'
import { ScrollView, View } from 'react-native'
import { fmtDate } from '@/domain/dates'
import { inr } from '@/domain/money'
import { voucherDebit, VOUCHER_LABEL } from '@/modules/accounting/logic'
import type { Voucher } from '@/modules/accounting/types'
import { KV, Notice } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Undo } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { DataTable, DeskButton, DeskPage, KpiStrip, KpiTile, Pill, SplitPane, Toolbar, cellNum, cellText, dtext, type Column } from './kit'

type LineRow = { id: string; accountLabel: string; partyName: string | undefined; debit: number; credit: number }

export interface DesktopVoucherDetailProps {
  voucher: Voucher
  original: Voucher | undefined
  reversed: boolean
  locked: boolean
  lineRows: LineRow[]
  canReverse: boolean
  onReverse: () => void
}

/**
 * The desktop voucher screen: a toolbar with the one action the phone screen offers (reverse), a KPI strip for the
 * amount, a dense grid of the debit/credit lines, and a side panel for date, narration and status. Every value is
 * passed down from `src/app/m/accounting/vouchers/[id].tsx` exactly as the phone screen computes it.
 */
export function DesktopVoucherDetail({ voucher: v, original, reversed, locked, lineRows, canReverse, onReverse }: DesktopVoucherDetailProps) {
  const { c } = useTheme()

  const columns: Array<Column<LineRow>> = [
    { key: 'account', label: 'Account', sortValue: (r) => r.accountLabel, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.accountLabel}</T>
        {r.partyName ? <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.partyName}</T> : null}
      </View>
    ) },
    { key: 'debit', label: 'Debit', width: 130, align: 'right', sortValue: (r) => r.debit, render: (r) => cellNum(r.debit ? inr(r.debit, 2) : '', true) },
    { key: 'credit', label: 'Credit', width: 130, align: 'right', sortValue: (r) => r.credit, render: (r) => cellNum(r.credit ? inr(r.credit, 2) : '', true) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title={v.no}
          subtitle={VOUCHER_LABEL[v.type]}
          right={canReverse ? <DeskButton label="Reverse this voucher" tone="danger" icon={<Undo size={14} color={c.danger} />} onPress={onReverse} /> : undefined}
        />
      }
    >
      <KpiStrip>
        <KpiTile label="Amount" value={inr(voucherDebit(v.lines), 2)} tone="primary" delta={`${v.lines.length} ${v.lines.length === 1 ? 'line' : 'lines'}`} />
        <KpiTile label="Status" value={reversed ? 'Reversed' : v.reversesId ? 'Reversal' : 'Posted'} tone={reversed ? 'warning' : 'success'} delta={locked ? 'Locked period' : undefined} />
      </KpiStrip>

      {reversed ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 10 }}>
          <Notice tone="warning" title="This voucher has been reversed" body="Its effect was cancelled by a later entry." />
        </View>
      ) : null}

      <SplitPane widths={['flex', 300]}>
        <View style={{ flex: 1, margin: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
          <DataTable rows={lineRows} columns={columns} emptyLabel="No entries on this voucher" />
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 14 }}>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            {reversed ? <Pill tone="warning" label="Reversed" /> : null}
            {v.reversesId ? <Pill label="Reversal" /> : null}
            {locked ? <Pill tone="primary" label="Locked period" /> : null}
          </View>

          <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}>
            <T style={[dtext.label, { color: c.inkMute, marginBottom: 6 }]}>Details</T>
            <KV k="Date" v={fmtDate(v.date)} />
            <KV k="Amount" v={inr(voucherDebit(v.lines), 2)} strong />
            {v.narration ? <KV k="Narration" v={v.narration} /> : null}
            {original ? <KV k="Reverses" v={original.no} /> : null}
          </View>
        </ScrollView>
      </SplitPane>
    </DeskPage>
  )
}
