import React from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useApp } from '@/data/store'
import { useVisibleModules } from '@/modules/hooks'
import { Screen } from '@/ui/Screen'
import { EmptyState, ListRow, Section } from '@/ui/blocks'
import { Badge, Group } from '@/ui/primitives'
import { T } from '@/ui/Text'
import { Layers } from '@/ui/icons'
import { toneColor, useTheme } from '@/ui/theme'

/** One app's page: its features, grouped by section. Modules fill this by registering features — they never write this screen. */
export default function ModulePage() {
  const { c } = useTheme()
  const router = useRouter()
  const { module: id } = useLocalSearchParams<{ module: string }>()
  const mods = useVisibleModules()
  const data = useApp((s) => s.data)
  const m = mods.find((x) => x.id === id)
  if (!m) return <Screen title="Not available" back><EmptyState icon={<Layers size={26} color={c.primary} />} title="This app is not available here" hint="Your role, industry or server may not include it." /></Screen>

  const sections = new Map<string, typeof m.visible>()
  for (const f of m.visible) sections.set(f.section ?? 'Features', [...(sections.get(f.section ?? 'Features') ?? []), f])

  return (
    <Screen title={m.name} subtitle={m.tagline} back>
      <View style={{ paddingBottom: 16 }}>
        {[...sections.entries()].map(([name, list]) => (
          <Section key={name} title={name} style={{ marginTop: 8 }}>
            <Group>
              {list.map((f) => {
                const n = f.badge?.(data)
                return (
                  <ListRow key={f.id} icon={<f.icon size={20} color={toneColor(c, f.tone)} />} iconTone={f.tone} title={f.label} subtitle={f.sub} badge={n ? <Badge tone="primary">{n}</Badge> : undefined}
                    onPress={() => router.push(f.to as never)} />
                )
              })}
            </Group>
          </Section>
        ))}
        <T v="caption" tone="mute" style={{ marginTop: 18 }}>{m.visible.length} {m.visible.length === 1 ? 'feature' : 'features'}</T>
      </View>
    </Screen>
  )
}
