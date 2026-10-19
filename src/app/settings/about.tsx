import React from 'react'
import { View } from 'react-native'
import Constants from 'expo-constants'
import { useIndustry } from '@/data/hooks'
import { useApp } from '@/data/store'
import { Logo } from '@/features/Logo'
import { PackGlyph } from '@/features/packIcons'
import { Screen } from '@/ui/Screen'
import { Card, Group } from '@/ui/primitives'
import { ListRow, Notice, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Boxes, ChartColumn, Check, Receipt, ShieldCheck, Truck, Users, Wallet } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

const MODULES = [
  { icon: Receipt, title: 'Billing', sub: 'Fast checkout, GST, returns, held bills, receipts' },
  { icon: Boxes, title: 'Stock', sub: 'Live counts, restock lists, physical counts, ledger' },
  { icon: Truck, title: 'Purchasing', sub: 'Goods received, supplier dues, price-later queue' },
  { icon: Users, title: 'People', sub: 'Customers, loyalty, store credit, staff roles' },
  { icon: Wallet, title: 'Money', sub: 'Expenses, day close, cash drawer' },
  { icon: ChartColumn, title: 'Reports', sub: 'Sales, GST, profit, items, staff — export as CSV' },
] as const

/** Version, the industry set-up in use, and what this app is built on. */
export default function About() {
  const { c } = useTheme()
  const pack = useIndustry()
  const ws = useApp((s) => s.workspace)
  const version = Constants.expoConfig?.version ?? '0.1.0'

  return (
    <Screen title="About" back>
      <View style={{ paddingBottom: 12 }}>
        <View style={{ alignItems: 'center', gap: 6, paddingVertical: 18 }}>
          <Logo size={72} />
          <T v="h1" style={{ marginTop: 8 }}>Kosh ERP</T>
          <T tone="mute">Version {version}</T>
          <T tone="soft" align="center" style={{ maxWidth: 300, marginTop: 4 }}>One app to bill, stock, buy and report — for the shop, counter or kitchen you run.</T>
        </View>

        <Section title="Set up for" style={{ marginTop: 6 }}>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 46, height: 46, borderRadius: 15, backgroundColor: pack.tint + '22', alignItems: 'center', justifyContent: 'center' }}><PackGlyph icon={pack.icon} size={23} color={pack.tint} /></View>
              <View style={{ flex: 1 }}>
                <T v="h2">{pack.name}</T>
                <T v="caption" tone="mute">{pack.tagline}</T>
              </View>
            </View>
            <View style={{ gap: 8, marginTop: 14 }}>
              {pack.highlights.map((h) => (
                <View key={h} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                  <View style={{ paddingTop: 2 }}><Check size={16} color={c.success} /></View>
                  <T style={{ flex: 1 }} tone="soft">{h}</T>
                </View>
              ))}
            </View>
          </Card>
          {pack.caveat ? <View style={{ marginTop: 10 }}><Notice tone="warning" title="Worth knowing" body={pack.caveat} /></View> : null}
          {ws?.demo ? <View style={{ marginTop: 10 }}><Notice tone="primary" title="You are looking at sample data" body="Everything here is made up so you can explore. Start a real business from the welcome screen when you are ready." /></View> : null}
        </Section>

        <Section title="What is inside" style={{ marginTop: 24 }}>
          <Group>
            {MODULES.map((m) => <ListRow key={m.title} icon={<m.icon size={19} color={c.primary} />} title={m.title} subtitle={m.sub} dense />)}
          </Group>
        </Section>

        <Section title="Good to know" style={{ marginTop: 24 }}>
          <Card flat>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <ShieldCheck size={18} color={c.primary} />
              <T style={{ flex: 1 }} tone="soft">Everything works without a connection. A business connected to a server uploads in the background and keeps selling if the network drops.</T>
            </View>
            <T v="caption" tone="mute" style={{ marginTop: 12 }}>GST rates and slabs are starting points for each industry, not tax advice — confirm them with your accountant. The billing and tax engine is shared with the Krishna Collection billing app, so a bill totals to the same paisa in both.</T>
          </Card>
        </Section>

        <T v="caption" tone="mute" align="center" style={{ marginTop: 22 }}>Made with Expo and React Native. Typefaces Manrope and Inter. Icons by Lucide.</T>
      </View>
    </Screen>
  )
}
