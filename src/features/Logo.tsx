import React from 'react'
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg'

/** The Kosh mark: a bold geometric K on a cobalt tile. (Placeholder brand — swap this file and `assets/` to rebrand.) */
export function Logo({ size = 56, flat }: { size?: number; flat?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Defs>
        <LinearGradient id="logoBg" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#4C7CFF" />
          <Stop offset="1" stopColor="#1B3FD1" />
        </LinearGradient>
      </Defs>
      <Rect width="64" height="64" rx="18" fill={flat ? '#FFFFFF' : 'url(#logoBg)'} />
      <Path d="M22 17 V47" stroke={flat ? '#1B3FD1' : '#FFFFFF'} strokeWidth="7" strokeLinecap="round" />
      <Path d="M41 17 L25 33" stroke={flat ? '#1B3FD1' : '#FFFFFF'} strokeWidth="7" strokeLinecap="round" />
      <Path d="M29 30 L42 47" stroke="#FF8A1F" strokeWidth="7" strokeLinecap="round" />
    </Svg>
  )
}
