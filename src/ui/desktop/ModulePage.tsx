import React, { useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import type { DataState } from '@/data/state'
import type { FeatureEntry, ModuleDef } from '@/modules/registry'
import { T } from '@/ui/Text'
import { toneColor, toneTint, useTheme } from '@/ui/theme'
import { DeskPage, Pill, Toolbar, dtext } from './kit'

/**
 * The desktop layout for the generic "module hub" page (every app — Purchasing, Accounts, Customers, HR…
 * routes through this one screen). The phone version is a scrolling list of Section/Group/ListRow cards, which on a
 * wide window reads as a stretched list with huge dead space either side. This lays the exact same data (`m.visible`,
 * grouped by `section`, in registration order) out as a dense card grid instead — a section label followed by
 * feature tiles that wrap to the window width, each one a direct `onOpen(f.to)` like the phone row's `onPress`.
 */
export function DesktopModulePage({ m, data, onOpen }: { m: ModuleDef & { visible: FeatureEntry[] }; data: DataState; onOpen: (to: string) => void }) {
  const sections = new Map<string, FeatureEntry[]>()
  for (const f of m.visible) sections.set(f.section ?? 'Features', [...(sections.get(f.section ?? 'Features') ?? []), f])

  return (
    <DeskPage toolbar={<Toolbar title={m.name} subtitle={m.tagline} right={<Pill tone="default" label={`${m.visible.length} ${m.visible.length === 1 ? 'feature' : 'features'}`} />} />}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, gap: 20 }}>
        {[...sections.entries()].map(([name, list]) => (
          <View key={name} style={{ gap: 10 }}>
            <SectionLabel name={name} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {list.map((f) => <FeatureCard key={f.id} feature={f} badge={f.badge?.(data) ?? null} onOpen={onOpen} />)}
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

function FeatureCard({ feature: f, badge, onOpen }: { feature: FeatureEntry; badge: number | null; onOpen: (to: string) => void }) {
  const { c } = useTheme()
  const [hovered, setHovered] = useState(false)

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
        <f.icon size={18} color={toneColor(c, f.tone)} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
          <T style={[dtext.cellStrong, { flex: 1 }]} numberOfLines={1}>{f.label}</T>
          {badge ? <Pill tone="primary" label={String(badge)} /> : null}
        </View>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={2}>{f.sub}</T>
      </View>
    </Pressable>
  )
}
