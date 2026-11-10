import React from 'react'
import { Image } from 'react-native'

/** The OneSyncERP mark — the same artwork `assets/icon.png` and friends are generated from, with its own
 * corners made transparent so it drops onto any background (light or dark) without a white halo. A hand-drawn
 * SVG approximation of this mark used to live here; it never quite matched the source art, so this renders the
 * real artwork directly instead. Swap `assets/logo-mark.png` (and the rest of `assets/`) to rebrand. */
export function Logo({ size = 56 }: { size?: number }) {
  return <Image source={require('../../assets/logo-mark.png')} style={{ width: size, height: size }} />
}
