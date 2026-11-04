import React from 'react'
import { ScrollView, View } from 'react-native'
import { fmtDateTime } from '@/domain/dates'
import { inr } from '@/domain/money'
import type { DataState } from '@/data/state'
import { locationName, REASON_LABEL, variantName } from '@/modules/warehouse/logic'
import type { WriteOff } from '@/modules/warehouse/types'
import { T } from '@/ui/Text'
import { useTheme } from '@/ui/theme'
import { DataTable, DeskPage, KpiStrip, KpiTile, SplitPane, Toolbar, cellNum, dtext, type Column } from './kit'

export interface DesktopWriteOffDetailProps {
  writeOff: WriteOff
  data: DataState
}

type LineRow = { id: string; variantId: string; qty: number; cost: number; batchId?: string; serial?: string; locationId?: string }

/**
 * The desktop write-off screen: a KPI strip for the value lost, a dense grid of the lines instead of a card list,
 * and a side panel for the reason and notes. A write-off is final (a mistake is corrected by receiving the stock
 * back), so there is nothing to act on here — no toolbar actions, just the record. Every value comes from
 * `src/app/m/warehouse/writeoffs/[id].tsx` exactly as the phone screen computes it.
 */
export function DesktopWriteOffDetail({ writeOff, data }: DesktopWriteOffDetailProps) {
  const { c } = useTheme()

  const rows: LineRow[] = writeOff.lines.map((l, i) => ({ id: `${l.variantId}-${i}`, variantId: l.variantId, qty: l.qty, cost: l.cost, batchId: l.batchId, serial: l.serial, locationId: l.locationId }))

  const columns: Array<Column<LineRow>> = [
    { key: 'item', label: 'Item', sortValue: (r) => variantName(data, r.variantId), render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{variantName(data, r.variantId)}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>
          {[r.batchId ? `Batch ${data.batches[r.batchId]?.batchNo ?? ''}` : '', r.serial ? `S/N ${r.serial}` : '', r.locationId ? locationName(data, r.locationId) : ''].filter(Boolean).join(' · ') || '—'}
        </T>
      </View>
    ) },
    { key: 'qty', label: 'Qty', width: 90, align: 'right', sortValue: (r) => r.qty, render: (r) => cellNum(String(r.qty)) },
    { key: 'cost', label: 'Cost each', width: 110, align: 'right', sortValue: (r) => r.cost, render: (r) => cellNum(inr(r.cost)) },
    { key: 'line', label: 'Line total', width: 120, align: 'right', sortValue: (r) => r.qty * r.cost, render: (r) => cellNum(inr(r.qty * r.cost), true) },
  ]

  return (
    <DeskPage toolbar={<Toolbar title={writeOff.no} subtitle={`${REASON_LABEL[writeOff.reason]} · ${fmtDateTime(writeOff.date)}`} />}>
      <KpiStrip>
        <KpiTile label="Value lost at cost" value={inr(writeOff.total)} tone="danger" delta={`${writeOff.lines.length} ${writeOff.lines.length === 1 ? 'line' : 'lines'}`} />
      </KpiStrip>

      <SplitPane widths={['flex', 320]}>
        <View style={{ flex: 1, margin: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
          <DataTable rows={rows} columns={columns} emptyLabel="No items on this write-off" />
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 14 }}>
          <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}>
            <T style={[dtext.label, { color: c.inkMute, marginBottom: 6 }]}>Details</T>
            <T style={dtext.cell}>{REASON_LABEL[writeOff.reason]}</T>
            <T style={[dtext.tiny, { color: c.inkMute, marginTop: 2 }]}>{fmtDateTime(writeOff.date)}</T>
          </View>

          {writeOff.notes ? (
            <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}>
              <T style={[dtext.label, { color: c.inkMute, marginBottom: 6 }]}>Notes</T>
              <T style={dtext.cell}>{writeOff.notes}</T>
            </View>
          ) : null}
        </ScrollView>
      </SplitPane>
    </DeskPage>
  )
}
