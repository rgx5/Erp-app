import React from 'react'
import { ScrollView, View } from 'react-native'
import { fmtDateTime } from '@/domain/dates'
import { inr } from '@/domain/money'
import type { DataState } from '@/data/state'
import { locationName, STATUS_LABEL, variantName, type TransferProgress } from '@/modules/warehouse/logic'
import type { Transfer, TransferReceipt } from '@/modules/warehouse/types'
import { NumberField } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { KV, Notice } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Truck } from '@/ui/icons'
import { useTheme, type Tone } from '@/ui/theme'
import { DataTable, DeskButton, DeskPage, KpiStrip, KpiTile, Pill, SplitPane, Toolbar, cellNum, cellText, dtext, type Column } from './kit'

type LineRow = { id: string; variantId: string; sent: number; received: number; outstanding: number; lost: number }

export interface DesktopTransferDetailProps {
  transfer: Transfer
  data: DataState
  progress: TransferProgress
  open: boolean
  receipts: TransferReceipt[]
  receiving: boolean
  setReceiving: (v: boolean) => void
  got: Record<string, string>
  setGot: (v: Record<string, string>) => void
  onReceiveAll: () => void
  onReceivePart: () => void
  onCloseShort: () => void
}

/**
 * The desktop transfer screen: a toolbar with the actions the phone screen keeps in its footer (receive
 * everything, receive part, close short), a KPI strip for status and what is still outstanding, a dense grid of
 * the lines with their sent/received/outstanding figures, and a side panel for past receipts and notes. Every
 * figure (`progress`, `open`, `receipts`) and handler comes from `src/app/m/warehouse/transfers/[id].tsx` exactly
 * as the phone screen computes it; the "receive part" `Sheet` is reused unchanged, just opened from a toolbar
 * button instead of a footer one.
 */
export function DesktopTransferDetail({ transfer, data, progress, open, receipts, receiving, setReceiving, got, setGot, onReceiveAll, onReceivePart, onCloseShort }: DesktopTransferDetailProps) {
  const { c } = useTheme()

  const rows: LineRow[] = progress.lines.map((l) => ({ id: l.variantId, ...l }))
  const mine = receipts.filter((r) => r.transferId === transfer.id).sort((a, b) => a.date - b.date)

  const columns: Array<Column<LineRow>> = [
    { key: 'item', label: 'Item', sortValue: (r) => variantName(data, r.variantId), render: (r) => cellText(variantName(data, r.variantId), true) },
    { key: 'sent', label: 'Sent', width: 90, align: 'right', sortValue: (r) => r.sent, render: (r) => cellNum(String(r.sent)) },
    { key: 'received', label: 'Received', width: 100, align: 'right', sortValue: (r) => r.received, render: (r) => cellNum(String(r.received)) },
    { key: 'status', label: 'Outstanding', width: 150, align: 'right', sortValue: (r) => r.outstanding || r.lost, render: (r) => (
      r.outstanding > 0 ? <Pill tone="accent" label={`${r.outstanding} on the way`} /> : r.lost > 0 ? <Pill tone="danger" label={`${r.lost} lost`} /> : <Pill tone="success" label="Complete" />
    ) },
  ]

  const statusTone: Tone = progress.status === 'received' ? 'success' : progress.status === 'closed_short' ? 'danger' : 'accent'

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title={transfer.no}
          subtitle={`${locationName(data, transfer.fromId)} → ${locationName(data, transfer.toId)}`}
          right={open ? (
            <>
              <DeskButton label="Close short" tone="danger" onPress={onCloseShort} />
              <DeskButton label="Receive part…" onPress={() => { setGot({}); setReceiving(true) }} />
              <DeskButton label="Receive everything" tone="primary" icon={<Truck size={14} color={c.onPrimary} />} onPress={onReceiveAll} />
            </>
          ) : undefined}
        />
      }
    >
      <KpiStrip>
        <KpiTile label="Status" value={STATUS_LABEL[progress.status]} tone={statusTone} delta={`Sent ${fmtDateTime(transfer.date)}`} />
        <KpiTile label="Outstanding" value={String(progress.outstandingTotal)} tone={progress.outstandingTotal ? 'warning' : 'success'} delta={progress.outstandingTotal ? 'units on the way' : 'Nothing outstanding'} />
      </KpiStrip>

      {progress.status === 'closed_short' ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 10 }}>
          <Notice tone="danger" title="Closed with stock missing" body={`The cost of what never arrived${mine.find((r) => r.lossValue) ? ` (${inr(mine.find((r) => r.lossValue)!.lossValue!)})` : ''} is written off in the books.`} />
        </View>
      ) : null}

      <SplitPane widths={['flex', 320]}>
        <View style={{ flex: 1, margin: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
          <DataTable rows={rows} columns={columns} emptyLabel="No items on this transfer" />
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 14 }}>
          {mine.length ? (
            <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}>
              <T style={[dtext.label, { color: c.inkMute, marginBottom: 6 }]}>Receipts</T>
              {mine.map((r) => <KV key={r.id} k={fmtDateTime(r.date)} v={r.closed ? 'Closed' : `${r.lines.reduce((s, x) => s + x.qty, 0)} units`} />)}
            </View>
          ) : null}

          {transfer.notes ? (
            <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}>
              <T style={[dtext.label, { color: c.inkMute, marginBottom: 6 }]}>Notes</T>
              <T style={dtext.cell}>{transfer.notes}</T>
            </View>
          ) : null}
        </ScrollView>
      </SplitPane>

      <Sheet visible={receiving} onClose={() => setReceiving(false)} title="What arrived?" footer={<DeskButton label="Save receipt" tone="primary" onPress={onReceivePart} />}>
        <View style={{ gap: 12, paddingBottom: 8 }}>
          {progress.lines.filter((l) => l.outstanding > 0).map((l) => (
            <NumberField key={l.variantId} label={`${variantName(data, l.variantId)} (${l.outstanding} on the way)`} value={got[l.variantId] ?? ''} onChange={(v) => setGot({ ...got, [l.variantId]: v })} decimals />
          ))}
        </View>
      </Sheet>
    </DeskPage>
  )
}
