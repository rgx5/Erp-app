import React, { useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDate } from '@/domain/dates'
import { inr } from '@/domain/money'
import { OpError } from '@/data/ops'
import { perform, useCan } from '@/data/store'
import { expiredValue, expiredWriteOffLines, expiryReport } from '@/modules/warehouse/logic'
import { postWriteOff } from '@/modules/warehouse/ops'
import { useData, whenLabel } from '@/modules/warehouse/ui/common'
import { Button } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { Badge, Chip, Group } from '@/ui/primitives'
import { EmptyState, ListRow, Notice, StatTile } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Hourglass } from '@/ui/icons'
import { ask, toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

const WINDOWS: Array<[number, string]> = [[-1, 'Expired'], [30, '30 days'], [60, '60 days'], [90, '90 days'], [Infinity, 'All dated']]

/** Expiry report: what has expired and what will, with the value at risk; expired stock can be written off in one step. */
export default function Expiry() {
  const { c } = useTheme()
  const router = useRouter()
  const canSee = useCan('stock')
  const canWrite = useCan('warehouse')
  const data = useData()
  const [win, setWin] = useState(30)
  const now = Date.now()
  if (!canSee) return <Screen title="Expiry" back><T tone="mute">The expiry report is for the owner and managers.</T></Screen>
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

  return (
    <Screen title="Expiry" subtitle="Soonest first" back>
      <View style={{ gap: 14, paddingBottom: 20 }}>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <StatTile label="Expired stock" value={inr(expired, 0)} tone="danger" foot={`${lines.length} ${lines.length === 1 ? 'batch' : 'batches'}`} />
          <StatTile label="Showing" value={inr(rows.reduce((s, r) => s + r.value, 0), 0)} tone="warning" foot={`${rows.length} ${rows.length === 1 ? 'batch' : 'batches'}`} />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {WINDOWS.map(([d, l]) => <Chip key={l} label={l} selected={win === d} onPress={() => setWin(d)} />)}
        </View>
        {canWrite && lines.length ? <Notice tone="danger" title="Expired stock is still on the shelf" body="Take it off the books so it is not sold by mistake." action="Write off" onAction={disposeExpired} /> : null}
        {rows.length ? (
          <Group>
            {rows.map((r) => (
              <ListRow key={r.batch.id} title={r.name} subtitle={`Batch ${r.batch.batchNo} · ${r.batch.qty} · ${r.batch.expiry ? fmtDate(r.batch.expiry) : ''}`} value={inr(r.value, 0)}
                badge={<Badge tone={(r.days ?? 1) < 0 ? 'danger' : (r.days ?? 99) <= 30 ? 'warning' : 'default'}>{whenLabel(r.days)}</Badge>} />
            ))}
          </Group>
        ) : <EmptyState icon={<Hourglass size={26} color={c.primary} />} title="Nothing here" hint={win === -1 ? 'No stock has passed its expiry date.' : 'No batches with stock expire in this period.'} />}
        <Button label="Batches" kind="soft" block onPress={() => router.push('/m/warehouse/batches')} />
      </View>
    </Screen>
  )
}
