import React, { useRef, useState } from 'react'
import { PanResponder, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { Button } from '@/ui/Button'
import { T } from '@/ui/Text'
import { useTheme } from '@/ui/theme'

export const PAD = { width: 300, height: 140 }

/** A box to sign in with a finger: each stroke is kept as SVG path data (one string per stroke) on a fixed-size pad. */
export function SignaturePad({ strokes, onChange }: { strokes: string[]; onChange: (s: string[]) => void }) {
  const { c, radius } = useTheme()
  const [live, setLive] = useState('')
  const cur = useRef('')
  const all = useRef(strokes)
  all.current = strokes
  const clamp = (n: number, max: number) => Math.max(0, Math.min(max, Math.round(n * 10) / 10))
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => { cur.current = `M ${clamp(e.nativeEvent.locationX, PAD.width)} ${clamp(e.nativeEvent.locationY, PAD.height)}`; setLive(cur.current) },
    onPanResponderMove: (e) => { cur.current += ` L ${clamp(e.nativeEvent.locationX, PAD.width)} ${clamp(e.nativeEvent.locationY, PAD.height)}`; setLive(cur.current) },
    onPanResponderRelease: () => { if (cur.current.includes('L')) onChange([...all.current, cur.current]); cur.current = ''; setLive('') },
  })).current
  return (
    <View style={{ gap: 8 }}>
      <View {...pan.panHandlers} style={{ width: PAD.width, height: PAD.height, alignSelf: 'center', borderRadius: radius.md, borderWidth: 1, borderColor: c.lineStrong, backgroundColor: c.surface, overflow: 'hidden' }}>
        <Svg width={PAD.width} height={PAD.height} pointerEvents="none">
          {[...strokes, live].filter(Boolean).map((d, i) => <Path key={i} d={d} stroke={c.ink} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" fill="none" />)}
        </Svg>
        {!strokes.length && !live ? <T v="caption" tone="mute" style={{ position: 'absolute', left: 14, top: PAD.height / 2 - 9 }} pointerEvents="none">Sign here</T> : null}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'center' }}>
        <Button label="Clear" kind="ghost" size="sm" onPress={() => onChange([])} disabled={!strokes.length} />
      </View>
    </View>
  )
}

/** A saved signature drawn back from its strokes. */
export function SignatureView({ strokes, width = PAD.width, height = PAD.height }: { strokes: string[]; width?: number; height?: number }) {
  const { c, radius } = useTheme()
  return (
    <View style={{ width: 240, aspectRatio: width / height, borderRadius: radius.md, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface, overflow: 'hidden' }}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`}>
        {strokes.map((d, i) => <Path key={i} d={d} stroke={c.ink} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" fill="none" />)}
      </Svg>
    </View>
  )
}
