import React from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { useVisibleReports } from '@/modules/hooks'
import { Screen } from '@/ui/Screen'
import { EmptyState, ListRow, Section } from '@/ui/blocks'
import { Group } from '@/ui/primitives'
import { ChartColumn } from '@/ui/icons'
import { toneColor, useTheme } from '@/ui/theme'

/** Every report from every app in one place, grouped (Sales, Stock, Accounts, People…). */
export default function ReportCentre() {
  const { c } = useTheme()
  const router = useRouter()
  const groups = useVisibleReports()
  return (
    <Screen title="All reports" subtitle="From every app" back>
      <View style={{ paddingBottom: 16 }}>
        <Section title="Sales, GST & profit" style={{ marginTop: 4 }}>
          <Group><ListRow icon={<ChartColumn size={20} color={c.success} />} iconTone="success" title="Main reports" subtitle="Sales, GST, profit, items and staff" onPress={() => router.push('/(tabs)/reports')} /></Group>
        </Section>
        {groups.map((g) => (
          <Section key={g.group} title={g.group} style={{ marginTop: 8 }}>
            <Group>{g.items.map((r) => <ListRow key={r.id} icon={<r.icon size={20} color={toneColor(c, r.tone)} />} iconTone={r.tone} title={r.label} subtitle={r.sub} onPress={() => router.push(r.to as never)} />)}</Group>
          </Section>
        ))}
        {!groups.length ? <EmptyState compact icon={<ChartColumn size={24} color={c.primary} />} title="More reports will appear here" hint="As you turn on more apps, their reports are listed in this page." /> : null}
      </View>
    </Screen>
  )
}
