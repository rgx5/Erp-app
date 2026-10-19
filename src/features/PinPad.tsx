import React, { useEffect, useRef } from 'react'
import { Animated, View } from 'react-native'
import { T } from '@/ui/Text'
import { Tap } from '@/ui/primitives'
import { Close } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

/** Four dots and a 3×4 keypad. `shake` bumps whenever the last PIN was wrong, to give the dots a quick shake. */
export function PinPad({ value, onChange, length = 4, shake, light }: { value: string; onChange: (v: string) => void; length?: number; shake?: number; light?: boolean }) {
  const { c } = useTheme()
  const x = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (!shake) return
    Animated.sequence([6, -6, 4, -4, 0].map((to) => Animated.timing(x, { toValue: to, duration: 55, useNativeDriver: true }))).start()
  }, [shake, x])
  const ink = light ? '#FFFFFF' : c.ink
  const key = (k: string) => (
    <Tap key={k} onPress={() => { if (k === '⌫') onChange(value.slice(0, -1)); else if (value.length < length) onChange(value + k) }}
      accessibilityLabel={k === '⌫' ? 'Delete' : k}
      style={{ width: 76, height: 62, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: light ? 'rgba(255,255,255,0.1)' : c.surface, borderWidth: 1, borderColor: light ? 'rgba(255,255,255,0.12)' : c.line }}>
      {k === '⌫' ? <Close size={22} color={ink} /> : <T v="h1" style={{ color: ink }} fixed>{k}</T>}
    </Tap>
  )
  return (
    <View style={{ alignItems: 'center', gap: 28 }}>
      <Animated.View style={{ flexDirection: 'row', gap: 18, transform: [{ translateX: x }] }}>
        {Array.from({ length }, (_, i) => (
          <View key={i} style={{ width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: i < value.length ? (light ? '#FFFFFF' : c.primary) : (light ? 'rgba(255,255,255,0.4)' : c.lineStrong), backgroundColor: i < value.length ? (light ? '#FFFFFF' : c.primary) : 'transparent' }} />
        ))}
      </Animated.View>
      <View style={{ gap: 12 }}>
        {[['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['', '0', '⌫']].map((row, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 12 }}>
            {row.map((k) => (k ? key(k) : <View key="sp" style={{ width: 76, height: 62 }} />))}
          </View>
        ))}
      </View>
    </View>
  )
}
