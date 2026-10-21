import React, { useMemo } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { csvFileName } from '@/domain/csv'
import { fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useApp, useCan } from '@/data/store'
import { shareFile } from '@/features/shareFile'
import { dueList, type DueItem, type DueWhen } from '@/modules/purchasing/payables'
import { dueCsv } from '@/modules/purchasing/reports'
import { settingsOf } from '@/modules/purchasing/approvals'
import { Button } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { Badge, Card } from '@/ui/primitives'
import { EmptyState, ListRow, Section } from '@/ui/blocks'
import { Calendar, Download } from '@/ui/icons'
import { T } from '@/ui/Text'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

const TITLE: Record<DueWhen, string> = { overdue: 'Overdue', soon: 'Due soon', later: 'Coming up' }

/** Payment reminders: every bill to pay, soonest first — late ones, those falling due in the warning window, and the rest. */
export default function DueReminders() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('purchases')
  const data = useApp((s) => s.data)
  const now = Date.now()
  const items = useMemo(() => dueList(data, now), [data, now])
  const days = settingsOf(data).remindDays

  if (!can) return <Screen title="What to pay" back><T tone="mute">Payables are for the owner and managers.</T></Screen>
  const groups = (['overdue', 'soon', 'later'] as DueWhen[]).map((w) => ({ w, rows: items.filter((i) => i.when === w) })).filter((g) => g.rows.length)

  return (
    <Screen title="What to pay" subtitle={`Warning ${days} days ahead`} back
      right={items.length ? <Button label="CSV" kind="soft" size="sm" icon={<Download size={15} color={c.primary} />} onPress={() => void shareFile(csvFileName('payments due'), dueCsv(data, now)).catch(() => toast('Could not export', 'err'))} /> : undefined}>
      <View style={{ gap: 12, paddingBottom: 24 }}>
        {!items.length ? <EmptyState icon={<Calendar size={26} color={c.primary} />} title="Nothing to pay" hint="Bills you owe to suppliers appear here with their due dates. Change the days of warning in Purchasing settings." /> : null}
        {groups.map((g) => (
          <Section key={g.w} title={`${TITLE[g.w]} · ${g.rows.length}`}>
            <Card padded={false}>
              {g.rows.map((d: DueItem) => (
                <ListRow key={d.ref} avatar={data.suppliers[d.supplierId]?.name ?? 'Supplier'} title={data.suppliers[d.supplierId]?.name ?? 'Supplier'} subtitle={`${d.no} · due ${fmtDayShort(d.dueDate)}`}
                  value={inr(d.owed, 0)} badge={d.when === 'overdue' ? <Badge tone="danger">{d.days}d late</Badge> : d.when === 'soon' ? <Badge tone="warning">Soon</Badge> : undefined}
                  onPress={() => router.push({ pathname: '/m/purchasing/payables/pay', params: { supplierId: d.supplierId, amount: String(d.owed) } })} />
              ))}
            </Card>
          </Section>
        ))}
        {items.length ? <T v="caption" tone="mute">Tap a bill to pay that supplier.</T> : null}
      </View>
    </Screen>
  )
}
