import React, { useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDate } from '@/domain/dates'
import { inr } from '@/domain/money'
import { OpError } from '@/data/ops'
import { perform, useCan } from '@/data/store'
import { expiredValue, expiredWriteOffLines, expiryReport, type ExpiryRow } from '@/modules/warehouse/logic'
import { postWriteOff } from '@/modules/warehouse/ops'
import { useData, whenLabel } from '@/modules/warehouse/ui/common'
import { T } from '@/ui/Text'
import { useTheme } from '@/ui/theme'
import { ask, toast } from '@/ui/overlays'
import { DataTable, DeskButton, DeskPage, DeskSegmented, KpiStrip, KpiTile, Pill, Toolbar, cellNum, cellText, type Column } from './kit'

const WINDOWS: Array<[number, string]> = [[-1, 'Expired'], [30, '30 days'], [60, '60 days'], [90, '90 days'], [Infinity, 'All dated']]

/**
 * The desktop Expiry report: a KPI strip for the value at risk, a window toggle in place of the phone's `Chip`
 * row, and a dense grid instead of a card list. Reads the exact same `expiryReport`/`expiredValue` the phone
 * screen computes; "write off" posts through `postWriteOff` exactly as the phone screen does.
 */
export function DesktopExpiry() {
  const { c } = useTheme()
  const router = useRouter()
  const canSee = useCan('stock')
  const canWrite = useCan('warehouse')
  const data = useData()
  const [win, setWin] = useState(30)
  const now = Date.now()

  if (!canSee) {
    return (
      <DeskPage toolbar={<Toolbar title="Expiry" />}>
        <View style={{ padding: 20 }}><T tone="mute">The expiry report is for the owner and managers.</T></View>
      </DeskPage>
    )
  }

  const rows = expiryReport(data, now, win)
  const expired = expiredValue(expiryReport(data, now, Infinity))
  const lines = expiredWriteOffLines(data, now)

  async function disposeExpired() {
    if (!(await ask({ title: 'Write off all expired stock?', message: `${lines.length} batches will be taken off the shelf at cost (${inr(expired)}).`, confirm: 'Write off', danger: true }))) return
    try {
      const r = perform((s, ctx) => postWriteOff(s, { reason: 'expiry', lines, notes: 'Expired stock disposed' }, ctx))
      toast(`${r.writeOff.no} posted`, 'ok')
      router.push({ pathname: '/m/warehouse/writeoffs/[id]', params: { id: r.writeOff.id } })
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not write off', 'err') }
  }

  const columns: Array<Column<ExpiryRow & { id: string }>> = [
    { key: 'name', label: 'Item', sortValue: (r) => r.name, render: (r) => cellText(r.name, true) },
    { key: 'batch', label: 'Batch', width: 140, sortValue: (r) => r.batch.batchNo, render: (r) => cellText(r.batch.batchNo) },
    { key: 'qty', label: 'Qty', width: 90, align: 'right', sortValue: (r) => r.batch.qty, render: (r) => cellNum(String(r.batch.qty)) },
    { key: 'expiry', label: 'Expires', width: 130, sortValue: (r) => r.batch.expiry ?? Infinity, render: (r) => cellText(r.batch.expiry ? fmtDate(r.batch.expiry) : '—') },
    { key: 'when', label: 'When', width: 110, sortValue: (r) => r.days ?? Infinity, render: (r) => <Pill tone={(r.days ?? 1) < 0 ? 'danger' : (r.days ?? 99) <= 30 ? 'warning' : 'default'} label={whenLabel(r.days)} /> },
    { key: 'value', label: 'Value', width: 110, align: 'right', sortValue: (r) => r.value, render: (r) => cellNum(inr(r.value, 0), true) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title="Expiry"
          subtitle="Soonest first"
          right={
            <>
              <DeskButton label="Batches" onPress={() => router.push('/m/warehouse/batches')} />
              {canWrite && lines.length ? <DeskButton label="Write off expired" tone="danger" onPress={disposeExpired} /> : null}
            </>
          }
        />
      }
    >
      <KpiStrip>
        <KpiTile label="Expired stock" value={inr(expired, 0)} tone={expired ? 'danger' : 'default'} delta={`${lines.length} ${lines.length === 1 ? 'batch' : 'batches'}`} onPress={() => setWin(-1)} />
        <KpiTile label="Showing" value={inr(rows.reduce((s, r) => s + r.value, 0), 0)} tone="warning" delta={`${rows.length} ${rows.length === 1 ? 'batch' : 'batches'}`} />
      </KpiStrip>

      <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10 }}>
        <DeskSegmented value={String(win)} onChange={(v) => setWin(Number(v))} options={WINDOWS.map(([d, l]) => ({ id: String(d), label: l }))} />
      </View>

      <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable
          rows={rows.map((r) => ({ ...r, id: r.batch.id }))}
          columns={columns}
          emptyLabel={win === -1 ? 'No stock has passed its expiry date.' : 'No batches with stock expire in this period.'}
        />
      </View>
    </DeskPage>
  )
}
