import React from 'react'
import { View } from 'react-native'
import { INDUSTRIES, type IndustryPack } from '@/industries'
import { useIndustry } from '@/data/hooks'
import { useApp } from '@/data/store'
import { SettingsLocked, useCanSettings } from '@/features/settingsKit'
import { PackGlyph } from '@/features/packIcons'
import { Screen } from '@/ui/Screen'
import { Badge, Card, Tap } from '@/ui/primitives'
import { Notice } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Check } from '@/ui/icons'
import { ask, toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

/** Change the words the app uses for this business. Nothing in the books changes: no prices, stock, tax or history. */
export default function IndustrySettings() {
  const { c } = useTheme()
  const allowed = useCanSettings()
  const current = useIndustry()

  if (!allowed) return <SettingsLocked title="Industry" />

  async function choose(p: IndustryPack) {
    if (p.id === current.id) return
    const ok = await ask({
      title: `Switch to ${p.name}?`,
      message: `The app will say “${p.labels.item}” instead of “${current.labels.item}” and “${p.labels.customer}” instead of “${current.labels.customer}”, and use this industry’s reasons and report wording. Your items, prices, stock, tax settings and bills are not touched.`,
      confirm: 'Switch',
    })
    if (!ok) return
    const ws = useApp.getState().workspace
    if (!ws) return
    await useApp.getState().setWorkspace({ ...ws, industry: p.id })
    toast(`Now set up for ${p.name}`, 'ok')
  }

  return (
    <Screen title="Industry" subtitle="Choose the words that fit your business" back>
      <View style={{ gap: 10, paddingBottom: 12 }}>
        <Notice tone="primary" title="Words only" body="This changes wording and suggestions. It never changes your data, prices or tax." />
        {INDUSTRIES.map((p) => {
          const on = p.id === current.id
          return (
            <Tap key={p.id} onPress={() => choose(p)} accessibilityLabel={`${p.name}${on ? ', current' : ''}`}>
              <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: on ? 2 : 1, borderColor: on ? c.primary : c.line }}>
                <View style={{ width: 46, height: 46, borderRadius: 15, backgroundColor: p.tint + '1F', alignItems: 'center', justifyContent: 'center' }}>
                  <PackGlyph icon={p.icon} size={24} color={p.tint} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <T v="bodyStrong">{p.name}</T>
                  <T v="caption" tone="mute" numberOfLines={2}>{p.labels.items} · {p.labels.customers} · {p.labels.sales}</T>
                </View>
                {on ? <Badge tone="primary" icon={<Check size={12} color={c.primary} />}>Current</Badge> : null}
              </Card>
            </Tap>
          )
        })}
      </View>
    </Screen>
  )
}
