import React, { useEffect, useState } from 'react'
import { View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { unlock } from '@/data/lock'
import { useApp } from '@/data/store'
import { Button } from '@/ui/Button'
import { T } from '@/ui/Text'
import { Fingerprint } from '@/ui/icons'
import { Logo } from './Logo'

/** Covers the app while it is locked; asks the phone to confirm it is really the owner, straight away. */
export function LockScreen() {
  const insets = useSafeAreaInsets()
  const name = useApp((s) => s.workspace?.name)
  const [failed, setFailed] = useState(false)

  const go = async () => { setFailed(!(await unlock(`Unlock ${name ?? 'your business'}`))) }
  useEffect(() => { void go() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <LinearGradient colors={['#080B16', '#0C1747']} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', paddingTop: insets.top, paddingBottom: insets.bottom, padding: 32, gap: 14 }}>
      <Logo size={72} />
      <T v="h1" style={{ color: '#fff', marginTop: 10 }}>{name ?? 'Kosh'}</T>
      <T style={{ color: 'rgba(255,255,255,0.65)' }} align="center">{failed ? 'Could not confirm it’s you.' : 'Your business is locked.'}</T>
      <View style={{ marginTop: 24 }}>
        <Button label="Unlock" kind="primary" size="lg" icon={<Fingerprint size={20} color="#fff" />} onPress={go} />
      </View>
    </LinearGradient>
  )
}
