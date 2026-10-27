import React from 'react'
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg'

/** The OneSyncERP mark: two arrows chasing each other in a circle (everything in sync) on a cobalt tile. Swap this file and `assets/` to rebrand. */
export function Logo({ size = 56, flat }: { size?: number; flat?: boolean }) {
  const a = flat ? '#1B3FD1' : '#FFFFFF'
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Defs>
        <LinearGradient id="logoBg" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#4C7CFF" />
          <Stop offset="1" stopColor="#1B3FD1" />
        </LinearGradient>
      </Defs>
      <Rect width="64" height="64" rx="18" fill={flat ? '#FFFFFF' : 'url(#logoBg)'} />
      <Path d="M17.90 26.87 A15 15 0 0 1 45.59 25.66" stroke={a} strokeWidth="6.5" strokeLinecap="round" fill="none" />
      <Path d="M48.76 32.46 L52.39 22.49 L38.80 28.83 Z" fill={a} />
      <Path d="M46.10 37.13 A15 15 0 0 1 18.41 38.34" stroke="#FF8A1F" strokeWidth="6.5" strokeLinecap="round" fill="none" />
      <Path d="M15.24 31.54 L11.61 41.51 L25.20 35.17 Z" fill="#FF8A1F" />
    </Svg>
  )
}
