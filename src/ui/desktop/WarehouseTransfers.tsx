import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDayShort } from '@/domain/dates'
import { useList } from '@/data/hooks'
import { useCan } from '@/data/store'
import { linesTotalQty, locationName, STATUS_LABEL, transferIsOpen, transferProgress, type TransferStatus } from '@/modules/warehouse/logic'
import { useData } from '@/modules/warehouse/ui/common'
import { T } from '@/ui/Text'
import { useTheme, type Tone } from '@/ui/theme'
import { Plus } from '@/ui/icons'
import { DataTable, DeskButton, DeskPage, DeskSegmented, KpiStrip, KpiTile, Pill, Toolbar, cellNum, cellText, dtext, type Column } from './kit'

const TONE: Record<TransferStatus, Tone> = { in_transit: 'accent', partial: 'warning', received: 'success', closed_short: 'danger' }

type Row = { id: string; no: string; date: number; fromId: string; toId: string; units: number; status: TransferStatus }

/**
 * The desktop Transfers list: a KPI strip (how many are on the way, how many sent in all), an Open/All toggle in
 * place of the phone's `Chip` pair, and a dense sortable grid instead of a scrolling card list. Reads the exact
 * same `transferProgress`/`transferIsOpen` the phone `transfers/index.tsx` uses for each row's status; nothing
 * here is recomputed differently.
 */
export function DesktopTransfers() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('warehouse')
  const data = useData()
  const transfers = useList('transfers')
  const receipts = useList('transferReceipts')
  const [open, setOpen] = useState(true)

  const all = useMemo(() => transfers.map((t) => ({ t, p: transferProgress(t, receipts) })), [transfers, receipts])
  const openCount = useMemo(() => all.filter((x) => transferIsOpen(x.p)).length, [all])
  const rows: Row[] = useMemo(
    () => all.filter((x) => !open || transferIsOpen(x.p)).map(({ t, p }) => ({ id: t.id, no: t.no, date: t.date, fromId: t.fromId, toId: t.toId, units: linesTotalQty(t.lines), status: p.status })).sort((a, b) => b.date - a.date),
    [all, open],
  )

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Stock transfers" />}>
        <View style={{ padding: 20 }}><T tone="mute">Transfers are for the owner and managers.</T></View>
      </DeskPage>
    )
  }

  const columns: Array<Column<Row>> = [
    { key: 'route', label: 'From → to', sortValue: (r) => `${locationName(data, r.fromId)} ${locationName(data, r.toId)}`, render: (r) => cellText(`${locationName(data, r.fromId)} → ${locationName(data, r.toId)}`, true) },
    { key: 'no', label: 'No.', width: 140, sortValue: (r) => r.no, render: (r) => cellText(r.no) },
    { key: 'date', label: 'Sent', width: 110, sortValue: (r) => r.date, render: (r) => cellText(fmtDayShort(r.date)) },
    { key: 'units', label: 'Units', width: 90, align: 'right', sortValue: (r) => r.units, render: (r) => cellNum(String(r.units)) },
    { key: 'status', label: 'Status', width: 140, sortValue: (r) => STATUS_LABEL[r.status], render: (r) => <Pill tone={TONE[r.status]} label={STATUS_LABEL[r.status]} /> },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title="Stock transfers"
          subtitle={`${transfers.length} sent`}
          right={<DeskButton label="New transfer" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={() => router.push('/m/warehouse/transfers/new')} />}
        />
      }
    >
      <KpiStrip>
        <KpiTile label="On the way" value={String(openCount)} tone={openCount ? 'accent' : 'success'} delta={openCount ? 'transfers in transit' : 'All received'} onPress={() => setOpen(true)} />
        <KpiTile label="Sent in all" value={String(transfers.length)} delta="transfers to date" onPress={() => setOpen(false)} />
      </KpiStrip>

      <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10 }}>
        <DeskSegmented value={open ? 'open' : 'all'} onChange={(v) => setOpen(v === 'open')} options={[{ id: 'open', label: 'On the way' }, { id: 'all', label: 'All' }]} />
      </View>

      <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable
          rows={rows}
          columns={columns}
          onRowPress={(r) => router.push({ pathname: '/m/warehouse/transfers/[id]', params: { id: r.id } })}
          emptyLabel={open ? 'Nothing on the way' : 'No transfers yet'}
        />
      </View>
    </DeskPage>
  )
}
