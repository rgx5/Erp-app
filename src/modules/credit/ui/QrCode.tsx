import React, { useMemo } from 'react'
import { View } from 'react-native'
import Svg, { Path, Rect } from 'react-native-svg'
import { encodeQr, qrPath } from '../qr'

/** A QR code drawn from the text, always dark-on-white (phones scan it best that way, even in dark mode). */
export function QrCode({ value, size = 240 }: { value: string; size?: number }) {
  const m = useMemo(() => { try { return encodeQr(value, 'M') } catch { return null } }, [value])
  if (!m) return <View style={{ width: size, height: size, backgroundColor: '#fff' }} />
  const quiet = 4
  const span = m.length + quiet * 2
  return (
    <View style={{ width: size, height: size, backgroundColor: '#fff', borderRadius: 12, overflow: 'hidden' }}>
      <Svg width={size} height={size} viewBox={`0 0 ${span} ${span}`}>
        <Rect x={0} y={0} width={span} height={span} fill="#fff" />
        <Path d={qrPath(m)} transform={`translate(${quiet} ${quiet})`} fill="#000" />
      </Svg>
    </View>
  )
}
