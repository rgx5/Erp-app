import React from 'react'
import { ScrollView, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { INDUSTRIES } from '@/industries'
import { PackGlyph } from '@/features/packIcons'
import { Logo } from '@/features/Logo'
import { Tap } from '@/ui/primitives'
import { T } from '@/ui/Text'
import { ArrowRight, Cloud, Sparkles, WifiOff } from '@/ui/icons'

/** First launch. Three honest doors: connect a real business, explore a demo, or start fresh — all of which work offline. */
export default function Welcome() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  return (
    <LinearGradient colors={['#070A14', '#0B1440', '#1B3FD1']} locations={[0, 0.55, 1]} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 24, paddingTop: insets.top + 28, paddingBottom: insets.bottom + 24 }} showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Logo size={44} />
          <T v="h2" style={{ color: '#fff', letterSpacing: 0.4 }}>OneSyncERP</T>
        </View>

        <View style={{ marginTop: 44, gap: 14 }}>
          <T v="display" style={{ color: '#fff', fontSize: 38, lineHeight: 44 }}>Run your whole business from your pocket.</T>
          <T style={{ color: 'rgba(255,255,255,0.72)', fontSize: 16, lineHeight: 24, maxWidth: 340 }}>Billing, stock, purchases, customers, expenses and reports — for any kind of shop, kitchen or service.</T>
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 26 }}>
          {INDUSTRIES.map((p) => (
            <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' }}>
              <PackGlyph icon={p.icon} size={14} color="#fff" />
              <T v="micro" style={{ color: '#fff', fontSize: 12 }}>{p.name.split(' & ')[0]}</T>
            </View>
          ))}
        </View>

        <View style={{ flex: 1, minHeight: 40 }} />

        <View style={{ gap: 12, marginTop: 28 }}>
          <Tap onPress={() => router.push('/onboarding/connect')} style={{ height: 60, borderRadius: 20, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, gap: 12 }}>
            <Cloud size={22} color="#1B3FD1" />
            <View style={{ flex: 1 }}>
              <T v="bodyStrong" style={{ color: '#0B1440' }}>Connect my business</T>
              <T v="caption" style={{ color: '#5B6483' }}>Sign in to your OneSync server</T>
            </View>
            <ArrowRight size={20} color="#1B3FD1" />
          </Tap>
          <Tap onPress={() => router.push({ pathname: '/onboarding/industry', params: { mode: 'demo' } })} style={{ height: 60, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, gap: 12 }}>
            <Sparkles size={22} color="#FFB36B" />
            <View style={{ flex: 1 }}>
              <T v="bodyStrong" style={{ color: '#fff' }}>Explore a demo</T>
              <T v="caption" style={{ color: 'rgba(255,255,255,0.65)' }}>A fully stocked sample business</T>
            </View>
            <ArrowRight size={20} color="#fff" />
          </Tap>
          <Tap onPress={() => router.push({ pathname: '/onboarding/industry', params: { mode: 'new' } })} style={{ height: 52, alignItems: 'center', justifyContent: 'center' }}>
            <T v="bodyStrong" style={{ color: 'rgba(255,255,255,0.9)' }}>Start a new business on this phone</T>
          </Tap>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 10 }}>
          <WifiOff size={14} color="rgba(255,255,255,0.55)" />
          <T v="caption" style={{ color: 'rgba(255,255,255,0.55)' }}>Works offline · Your data stays yours</T>
        </View>
      </ScrollView>
    </LinearGradient>
  )
}
