import React from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { useVisibleModules } from '@/modules/hooks'
import { Screen } from '@/ui/Screen'
import { Card, IconWell, Tap } from '@/ui/primitives'
import { T } from '@/ui/Text'
import { toneColor, useTheme } from '@/ui/theme'

/** Every app in the ERP, as a grid. Each opens a page listing its features. */
export default function Apps() {
  const { c } = useTheme()
  const router = useRouter()
  const mods = useVisibleModules()
  return (
    <Screen title="All apps" subtitle="Everything your business can do" back>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingBottom: 12 }}>
        {mods.map((m) => (
          <Tap key={m.id} onPress={() => router.push({ pathname: '/apps/[module]', params: { module: m.id } })} style={{ width: '48%', flexGrow: 1 }}>
            <Card style={{ gap: 12, minHeight: 138 }}>
              <IconWell tone={m.tone} size={46}><m.icon size={24} color={toneColor(c, m.tone)} /></IconWell>
              <View style={{ gap: 2 }}>
                <T v="bodyStrong" numberOfLines={1}>{m.name}</T>
                <T v="caption" tone="mute" numberOfLines={2}>{m.tagline}</T>
              </View>
              <T v="micro" tone="soft">{m.visible.length} {m.visible.length === 1 ? 'feature' : 'features'}</T>
            </Card>
          </Tap>
        ))}
      </View>
    </Screen>
  )
}
