import React, { useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { INDUSTRIES, type IndustryPack } from '@/industries'
import { createDemoBusiness } from '@/data/auth'
import { PackGlyph } from '@/features/packIcons'
import { Button } from '@/ui/Button'
import { Sheet } from '@/ui/Sheet'
import { Screen } from '@/ui/Screen'
import { Badge, IconWell, Tap } from '@/ui/primitives'
import { T } from '@/ui/Text'
import { Check, Info } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

/** Choose what kind of business this is. It sets the words, units, tax defaults and categories the whole app uses. */
export default function IndustryPicker() {
  const { mode } = useLocalSearchParams<{ mode?: string }>()
  const demo = mode === 'demo'
  const router = useRouter()
  const { c, radius, shadow } = useTheme()
  const [picked, setPicked] = useState<IndustryPack | null>(null)
  const [busy, setBusy] = useState(false)

  async function go(p: IndustryPack) {
    if (demo) {
      setBusy(true)
      try {
        await createDemoBusiness(p.id)
        router.replace('/')
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Could not build the demo', 'err')
        setBusy(false)
      }
    } else {
      setPicked(null)
      router.push({ pathname: '/onboarding/business', params: { industry: p.id } })
    }
  }

  return (
    <Screen title={demo ? 'Pick a demo business' : 'What kind of business?'} subtitle={demo ? 'Every number is real arithmetic over 45 days of sample trading' : 'This sets your words, units, tax and categories'} back>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 }}>
        {INDUSTRIES.map((p) => (
          <Tap key={p.id} onPress={() => setPicked(p)} style={[{ width: '48%', flexGrow: 1, padding: 16, borderRadius: radius.lg, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, gap: 12, minHeight: 148 }, shadow(1)]}>
            <View style={{ width: 46, height: 46, borderRadius: 15, backgroundColor: p.tint + '1F', alignItems: 'center', justifyContent: 'center' }}>
              <PackGlyph icon={p.icon} size={24} color={p.tint} />
            </View>
            <View style={{ gap: 3 }}>
              <T v="bodyStrong" numberOfLines={2}>{p.name}</T>
              <T v="caption" tone="mute" numberOfLines={3}>{p.tagline}</T>
            </View>
          </Tap>
        ))}
      </View>

      <Sheet visible={!!picked} onClose={() => setPicked(null)} title={picked?.name} subtitle={picked?.tagline}
        footer={picked ? <Button label={demo ? `Open the ${picked.demo.storeName} demo` : 'Continue'} size="lg" block loading={busy} onPress={() => go(picked)} /> : null}>
        {picked ? (
          <View style={{ gap: 14, paddingBottom: 6 }}>
            <View style={{ gap: 10 }}>
              {picked.highlights.map((h) => (
                <View key={h} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                  <IconWell tone="success" size={24}><Check size={14} color={c.success} /></IconWell>
                  <T style={{ flex: 1 }}>{h}</T>
                </View>
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <Badge>{picked.categories.length} categories</Badge>
              <Badge>{picked.tax.inclusive ? 'Tax-inclusive prices' : 'Tax added on top'}</Badge>
              <Badge>{picked.labels.items} · {picked.labels.customers}</Badge>
            </View>
            {picked.caveat ? (
              <View style={{ flexDirection: 'row', gap: 10, padding: 12, borderRadius: 14, backgroundColor: c.warningTint }}>
                <Info size={18} color={c.warning} />
                <T v="caption" style={{ flex: 1, color: c.warning }}>{picked.caveat}</T>
              </View>
            ) : null}
          </View>
        ) : null}
      </Sheet>
    </Screen>
  )
}
