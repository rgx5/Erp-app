import React, { useEffect, useState } from 'react'
import { View } from 'react-native'
import { biometricsAvailable, unlock } from '@/data/lock'
import { useApp } from '@/data/store'
import { Screen } from '@/ui/Screen'
import { Segmented, SwitchRow } from '@/ui/Inputs'
import { Card } from '@/ui/primitives'
import { Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Contrast, Moon, Sun } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

type ThemePref = 'system' | 'light' | 'dark'

/** Look and feel for this phone, plus the app lock. These stay on the phone — they are not part of the business. */
export default function Appearance() {
  const { c } = useTheme()
  const prefs = useApp((s) => s.prefs)
  const setPrefs = useApp((s) => s.setPrefs)
  const [bio, setBio] = useState<boolean | null>(null)

  useEffect(() => { void biometricsAvailable().then(setBio) }, [])

  async function toggleLock(on: boolean) {
    if (!on) { await setPrefs({ appLock: false }); return }
    // Prove it works before relying on it — otherwise a lock the phone cannot open would lock the owner out.
    if (await unlock('Turn on app lock')) { await setPrefs({ appLock: true }); toast('App lock is on', 'ok') } else toast('Could not confirm — app lock stays off', 'err')
  }

  return (
    <Screen title="Appearance & security" back>
      <View style={{ paddingBottom: 12 }}>
        <Section title="Theme" style={{ marginTop: 6 }}>
          <Segmented<ThemePref> value={prefs.theme} onChange={(theme) => void setPrefs({ theme })} options={[
            { value: 'system', label: 'Auto', icon: <Contrast size={15} color={prefs.theme === 'system' ? c.ink : c.inkSoft} /> },
            { value: 'light', label: 'Light', icon: <Sun size={15} color={prefs.theme === 'light' ? c.ink : c.inkSoft} /> },
            { value: 'dark', label: 'Dark', icon: <Moon size={15} color={prefs.theme === 'dark' ? c.ink : c.inkSoft} /> },
          ]} />
          <T v="caption" tone="mute" style={{ marginTop: 8 }}>{prefs.theme === 'system' ? 'Follows your phone’s light or dark setting.' : prefs.theme === 'dark' ? 'Easier on the eyes in a dim shop or at night.' : 'Bright and paper-like — best in daylight.'} Text size follows your phone’s font setting.</T>
        </Section>

        <Section title="Feel" style={{ marginTop: 24 }}>
          <Card padded={false}>
            <SwitchRow title="Haptic feedback" subtitle="A light tap when you press buttons and scan items" value={prefs.haptics} onChange={(haptics) => void setPrefs({ haptics })} />
          </Card>
        </Section>

        <Section title="Security" style={{ marginTop: 24 }}>
          <Card padded={false}>
            <SwitchRow title="App lock" subtitle={bio === false ? 'Set up a fingerprint, face or screen lock on your phone first' : 'Ask for fingerprint, face or phone PIN when the app opens or after 30 seconds away'} value={prefs.appLock} onChange={(v) => void toggleLock(v)} disabled={bio === false && !prefs.appLock} />
          </Card>
          <T v="caption" tone="mute" style={{ marginTop: 8 }}>Staff PINs choose who is at the counter. App lock protects the business itself if the phone is lent, lost or left on the counter.</T>
        </Section>
      </View>
    </Screen>
  )
}
