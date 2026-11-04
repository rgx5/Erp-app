import React from 'react'
import { ScrollView, View } from 'react-native'
import { useRouter } from 'expo-router'
import { INDUSTRIES } from '@/industries'
import { PackGlyph } from '@/features/packIcons'
import { Logo } from '@/features/Logo'
import { Tap } from '@/ui/primitives'
import { T } from '@/ui/Text'
import { useTheme, fonts } from '@/ui/theme'
import { ArrowRight, Check, Cloud, Lock, ShieldCheck, Sparkles, TrendingUp, WifiOff } from '@/ui/icons'

const HIGHLIGHTS = [
  { icon: TrendingUp, text: 'Sales, stock, purchases and GST reports in one ledger' },
  { icon: ShieldCheck, text: 'GST-compliant billing with HSN, e-way and tax-slab support out of the box' },
  { icon: WifiOff, text: 'Works fully offline — every counter keeps billing through an outage' },
  { icon: Lock, text: 'Your data stays yours: no vendor lock-in, no forced cloud upload' },
]

/**
 * Desktop launcher — the "pick a workspace" screen an enterprise desktop ERP opens with (QuickBooks Desktop,
 * Tally, Zoho Books), not the phone's full-bleed splash stretched wide. A fixed brand panel on the left carries
 * the pitch and trust signals; a centred card on the right holds the three entry points, so the eye lands on one
 * clear next action instead of hunting across a mostly-empty window.
 */
export function DesktopWelcome() {
  const { c } = useTheme()
  const router = useRouter()
  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: c.bg }}>
      <BrandPanel />
      <ScrollView contentContainerStyle={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 48 }}>
        <View style={{ width: '100%', maxWidth: 420, gap: 28 }}>
          <View style={{ gap: 6 }}>
            <T style={{ fontFamily: fonts.display, fontSize: 26, lineHeight: 32, letterSpacing: -0.3, color: c.ink }}>Welcome to OneSyncERP</T>
            <T style={{ fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: c.inkMute }}>Choose how you want to get started on this machine.</T>
          </View>

          <View style={{ gap: 10 }}>
            <EntryCard
              icon={<Cloud size={20} color={c.primary} />}
              iconBg={c.primaryTint}
              title="Connect my business"
              subtitle="Sign in to your OneSync server"
              primary
              onPress={() => router.push('/onboarding/connect')}
            />
            <EntryCard
              icon={<Sparkles size={20} color="#B4690E" />}
              iconBg="#FBEBD6"
              title="Explore a demo"
              subtitle="A fully stocked sample business — no sign-up"
              onPress={() => router.push({ pathname: '/onboarding/industry', params: { mode: 'demo' } })}
            />
            <EntryCard
              icon={<ArrowRight size={20} color={c.inkSoft} />}
              iconBg={c.sunken}
              title="Start a new business"
              subtitle="Set up a fresh workspace on this computer"
              onPress={() => router.push({ pathname: '/onboarding/industry', params: { mode: 'new' } })}
            />
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 4 }}>
            <WifiOff size={14} color={c.inkMute} />
            <T style={{ fontFamily: fonts.body, fontSize: 12.5, color: c.inkMute }}>Works offline · Your data stays yours</T>
          </View>
        </View>
      </ScrollView>
    </View>
  )
}

function EntryCard({ icon, iconBg, title, subtitle, onPress, primary }: {
  icon: React.ReactNode; iconBg: string; title: string; subtitle: string; onPress: () => void; primary?: boolean
}) {
  const { c, radius } = useTheme()
  return (
    <Tap
      onPress={onPress}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: radius.md,
        backgroundColor: c.surface, borderWidth: 1, borderColor: primary ? c.primary : c.line,
      }}
    >
      <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: iconBg, alignItems: 'center', justifyContent: 'center' }}>{icon}</View>
      <View style={{ flex: 1, gap: 2 }}>
        <T v="bodyStrong" style={{ color: c.ink }}>{title}</T>
        <T v="caption" style={{ color: c.inkMute }}>{subtitle}</T>
      </View>
      <ArrowRight size={18} color={c.inkMute} />
    </Tap>
  )
}

function BrandPanel() {
  return (
    <View style={{ width: 440, backgroundColor: '#070A14', padding: 48, justifyContent: 'space-between' }}>
      <View style={{ gap: 44 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Logo size={40} />
          <T style={{ fontFamily: fonts.display, fontSize: 19, letterSpacing: 0.2, color: '#fff' }}>OneSyncERP</T>
        </View>

        <View style={{ gap: 14 }}>
          <T style={{ fontFamily: fonts.display, fontSize: 34, lineHeight: 40, letterSpacing: -0.5, color: '#fff' }}>Run your whole business on one ledger.</T>
          <T style={{ fontFamily: fonts.body, fontSize: 14.5, lineHeight: 22, color: 'rgba(255,255,255,0.64)', maxWidth: 320 }}>
            Billing, stock, purchases, customers, expenses and reports — built for any kind of shop, kitchen or service.
          </T>
        </View>

        <View style={{ gap: 14 }}>
          {HIGHLIGHTS.map((h) => (
            <View key={h.text} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 11 }}>
              <View style={{ width: 22, height: 22, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
                <h.icon size={12.5} color="#8FA6FF" />
              </View>
              <T style={{ flex: 1, fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, color: 'rgba(255,255,255,0.78)' }}>{h.text}</T>
            </View>
          ))}
        </View>

        <View style={{ gap: 8 }}>
          <T style={{ fontFamily: fonts.bodyMedium, fontSize: 10.5, lineHeight: 14, letterSpacing: 0.5, textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)' }}>Built for</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
            {INDUSTRIES.map((p) => (
              <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                <PackGlyph icon={p.icon} size={11} color="rgba(255,255,255,0.8)" />
                <T style={{ fontFamily: fonts.body, fontSize: 11, color: 'rgba(255,255,255,0.75)' }}>{p.name.split(' & ')[0]}</T>
              </View>
            ))}
          </View>
        </View>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <Check size={13} color="#4C7CFF" />
        <T style={{ fontFamily: fonts.body, fontSize: 11.5, color: 'rgba(255,255,255,0.45)' }}>Trusted by retailers across India</T>
      </View>
    </View>
  )
}
