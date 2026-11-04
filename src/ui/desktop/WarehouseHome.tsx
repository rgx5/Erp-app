import React, { useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { useRouter } from 'expo-router'
import { inr0 } from '@/domain/money'
import { listOf } from '@/data/state'
import { useCan } from '@/data/store'
import { allModules, type FeatureEntry } from '@/modules/registry'
import { expirySummary, openTransfers, locationSummary } from '@/modules/warehouse/logic'
import { useData } from '@/modules/warehouse/ui/common'
import { T } from '@/ui/Text'
import { toneColor, toneTint, useTheme } from '@/ui/theme'
import { DeskPage, KpiStrip, KpiTile, Toolbar, dtext } from './kit'

/**
 * The desktop Warehouse home: the same few headline numbers as the phone screen's two rows of `StatTile`s, as a
 * `KpiStrip`, followed by the exact feature list (`allModules().find(…).features`, grouped by `section`) as a
 * wrapping card grid instead of a scrolling list of sections — the same "module hub" treatment
 * `DesktopModulePage` gives every other module, just inlined here because this screen's header carries its own
 * KPIs first. Reads its own data directly (`useCan`, `useData`), exactly like `DesktopPurchases`: nothing here is
 * passed down from the phone route, which keeps its body unchanged.
 */
export function DesktopWarehouseHome() {
  const router = useRouter()
  const can = useCan('warehouse')
  const data = useData()

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Warehouse" />}>
        <View style={{ padding: 20 }}><T tone="mute">The warehouse is for the owner and managers.</T></View>
      </DeskPage>
    )
  }

  const ex = expirySummary(data, Date.now())
  const places = locationSummary(data)
  const features = (allModules().find((m) => m.id === 'inventory')?.features ?? []).filter((f) => f.id.startsWith('wh-'))
  const sections = [...new Set(features.map((f) => f.section ?? ''))]

  return (
    <DeskPage toolbar={<Toolbar title="Warehouse" subtitle="Locations, batches, serial numbers, kits" />}>
      <KpiStrip>
        <KpiTile label="Places" value={String(places.length)} delta={`${listOf(data.locations).filter((l) => l.active).length} set up`} onPress={() => router.push('/m/warehouse/locations')} />
        <KpiTile label="In transit" value={String(openTransfers(data).length)} tone="accent" delta="transfers on the way" onPress={() => router.push('/m/warehouse/transfers')} />
        <KpiTile label="Expired" value={String(ex.expired)} tone={ex.expired ? 'danger' : 'default'} delta="batches with stock" onPress={() => router.push('/m/warehouse/batches/expiry')} />
        <KpiTile label="Expiring soon" value={String(ex.soon)} tone={ex.soon ? 'warning' : 'default'} delta={`${inr0(ex.value)} at risk`} onPress={() => router.push('/m/warehouse/batches/expiry')} />
      </KpiStrip>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, gap: 20 }}>
        {sections.map((sec) => (
          <View key={sec} style={{ gap: 10 }}>
            {sec ? <SectionLabel name={sec} /> : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {features.filter((f) => (f.section ?? '') === sec).map((f) => (
                <FeatureCard key={f.id} feature={f} onOpen={(to) => router.push(to as never)} />
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </DeskPage>
  )
}

function SectionLabel({ name }: { name: string }) {
  const { c } = useTheme()
  return <T style={[dtext.label, { color: c.inkMute }]}>{name}</T>
}

function FeatureCard({ feature: f, onOpen }: { feature: FeatureEntry; onOpen: (to: string) => void }) {
  const { c } = useTheme()
  const [hovered, setHovered] = useState(false)
  const Icon = f.icon
  return (
    <Pressable
      onPress={() => onOpen(f.to)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={{
        minWidth: 260, maxWidth: 360, flexGrow: 1, flexBasis: 260,
        flexDirection: 'row', alignItems: 'flex-start', gap: 12,
        padding: 14, backgroundColor: hovered ? c.sunken : c.surface,
        borderWidth: 1, borderColor: hovered ? c.lineStrong : c.line, borderRadius: 8,
      }}
    >
      <View style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: toneTint(c, f.tone), alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={18} color={toneColor(c, f.tone)} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{f.label}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={2}>{f.sub}</T>
      </View>
    </Pressable>
  )
}
