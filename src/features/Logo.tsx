import React from 'react'
import Svg, { Path, Rect } from 'react-native-svg'

/** The OneSyncERP mark: a near-complete refresh arrow on a cobalt tile, with one orange accent square standing in
 * for the rest of the ring — everything in sync, one piece highlighted. Swap this file and `assets/` to rebrand. */
export function Logo({ size = 56, flat }: { size?: number; flat?: boolean }) {
  const ring = flat ? '#1B3FD1' : '#FFFFFF'
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Rect width="64" height="64" rx="18" fill={flat ? '#FFFFFF' : '#0049F9'} />
      <Path d="M16.5 24.5 A16 16 0 1 1 15.8 40.3" stroke={ring} strokeWidth="7" strokeLinecap="round" fill="none" />
      <Path d="M38 16 L50 25 L37.5 32.5 Z" fill={ring} />
      <Rect x="44.5" y="27.5" width="11" height="11" rx="3.2" fill="#FC9A1E" />
    </Svg>
  )
}
