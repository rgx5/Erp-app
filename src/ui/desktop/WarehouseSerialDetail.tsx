import React from 'react'
import { ScrollView, View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDate, fmtDateTime } from '@/domain/dates'
import type { SerialView } from '@/modules/warehouse/logic'
import type { Serial } from '@/modules/warehouse/types'
import { KV, Notice } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { useTheme, type Tone } from '@/ui/theme'
import { DataTable, DeskButton, DeskPage, KpiStrip, KpiTile, Pill, SplitPane, Toolbar, cellText, dtext, type Column } from './kit'

export interface DesktopSerialDetailProps {
  serial: Serial
  view: SerialView
  canEdit: boolean
  onOpenBill: () => void
  hasBill: boolean
  onTakeBack: () => void
}

type HistoryRow = { id: string; at: number; status: Serial['status']; ref: string }

/**
 * The desktop serial-number screen: a KPI strip for status and warranty, a dense grid of the unit's history in
 * place of the phone's list of badges, and a side panel for where it came from and who bought it. Every value
 * (`view` = `serialView`) and handler is passed down from `src/app/m/warehouse/serials/[id].tsx` exactly as the
 * phone screen computes it.
 */
export function DesktopSerialDetail({ serial: s, view: v, canEdit, onOpenBill, hasBill, onTakeBack }: DesktopSerialDetailProps) {
  const { c } = useTheme()

  const history: HistoryRow[] = [...s.history].reverse().map((h, i) => ({ id: String(i), ...h }))
  const warrantyTone: Tone = v.warranty.kind === 'active' ? 'success' : v.warranty.kind === 'expired' ? 'warning' : 'default'

  const columns: Array<Column<HistoryRow>> = [
    { key: 'status', label: 'Status', width: 140, render: (r) => <Pill label={r.status.replace('_', ' ')} /> },
    { key: 'ref', label: 'Reference', render: (r) => cellText(r.ref) },
    { key: 'at', label: 'When', width: 180, sortValue: (r) => r.at, render: (r) => cellText(fmtDateTime(r.at)) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title={s.serial}
          subtitle={v.name}
          right={
            <>
              {hasBill ? <DeskButton label={`Open bill ${s.billNo}`} onPress={onOpenBill} /> : null}
              {canEdit && s.status === 'sold' ? <DeskButton label="Customer returned this unit" tone="primary" onPress={onTakeBack} /> : null}
            </>
          }
        />
      }
    >
      <KpiStrip>
        <KpiTile label="Status" value={s.status.replace('_', ' ')} />
        <KpiTile
          label="Warranty"
          value={v.warranty.kind === 'none' ? '—' : `${v.warranty.days} days`}
          tone={warrantyTone}
          delta={v.warranty.kind === 'active' ? `Until ${fmtDate(s.warrantyUntil!)}` : v.warranty.kind === 'expired' ? `Ended ${fmtDate(s.warrantyUntil!)}` : 'Not sold yet'}
        />
      </KpiStrip>

      {v.warranty.kind === 'active' ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 10 }}><Notice tone="success" title={`In warranty — ${v.warranty.days} days left`} body={`Until ${fmtDate(s.warrantyUntil!)}`} /></View>
      ) : null}
      {v.warranty.kind === 'expired' ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 10 }}><Notice tone="warning" title="Warranty has ended" body={`Ended ${fmtDate(s.warrantyUntil!)} (${v.warranty.days} days ago)`} /></View>
      ) : null}

      <SplitPane widths={['flex', 320]}>
        <View style={{ flex: 1, margin: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
          <DataTable rows={history} columns={columns} emptyLabel="No history yet" />
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 14 }}>
          <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}>
            <T style={[dtext.label, { color: c.inkMute, marginBottom: 6 }]}>Details</T>
            <KV k="Status" v={s.status.replace('_', ' ')} />
            {s.receivedAt ? <KV k="Received" v={fmtDate(s.receivedAt)} sub={v.supplier} /> : null}
            {s.billNo ? <KV k="Sold on" v={s.billNo} sub={s.soldAt ? fmtDate(s.soldAt) : undefined} /> : null}
            {v.customer ? <KV k="Customer" v={v.customer} /> : null}
            {s.warrantyMonths ? <KV k="Warranty" v={`${s.warrantyMonths} months`} /> : null}
          </View>
        </ScrollView>
      </SplitPane>
    </DeskPage>
  )
}
