import React, { createContext, useContext, useMemo } from 'react'
import { Platform, useColorScheme, type TextStyle, type ViewStyle } from 'react-native'
import { useApp } from '@/data/store'

/**
 * OneSync design language: a calm warm-paper canvas, ink-black text and one confident cobalt — with a saffron highlight
 * used sparingly for what needs a look. Numbers are the hero of an ERP, so they get the display face (Manrope,
 * tabular figures) and everything else reads in Inter.
 */

export interface Palette {
  bg: string; surface: string; surfaceAlt: string; sunken: string
  line: string; lineStrong: string
  ink: string; inkSoft: string; inkMute: string
  primary: string; primaryPressed: string; primaryTint: string; onPrimary: string
  accent: string; accentTint: string
  success: string; successTint: string
  warning: string; warningTint: string
  danger: string; dangerTint: string
  overlay: string
  hero: [string, string]
  heroInk: string
  /** Categorical series colours for charts (also told apart by labels, never by colour alone). */
  series: string[]
  isDark: boolean
}

export const light: Palette = {
  bg: '#F4F3EF', surface: '#FFFFFF', surfaceAlt: '#FAF9F6', sunken: '#EEECE6',
  line: '#E9E6DE', lineStrong: '#D5D1C5',
  ink: '#0E1220', inkSoft: '#4A5266', inkMute: '#858CA0',
  primary: '#2B59FF', primaryPressed: '#1B3FD1', primaryTint: '#E9EEFF', onPrimary: '#FFFFFF',
  accent: '#FF8A1F', accentTint: '#FFF0DF',
  success: '#0E9F6E', successTint: '#E1F5EC',
  warning: '#B86E00', warningTint: '#FFF2D6',
  danger: '#E03E44', dangerTint: '#FCE8E9',
  overlay: 'rgba(14,18,32,0.48)',
  hero: ['#0C1747', '#2B59FF'], heroInk: '#FFFFFF',
  series: ['#2B59FF', '#0E9F6E', '#FF8A1F', '#8B5CF6', '#E03E44', '#0891B2'],
  isDark: false,
}

export const dark: Palette = {
  bg: '#0A0D14', surface: '#131824', surfaceAlt: '#171D2B', sunken: '#0E121B',
  line: '#232A3A', lineStrong: '#323B50',
  ink: '#F1F3F9', inkSoft: '#B4BBCC', inkMute: '#7B849A',
  primary: '#6E92FF', primaryPressed: '#8CA9FF', primaryTint: '#16224D', onPrimary: '#0A0D14',
  accent: '#FFA14D', accentTint: '#3A2410',
  success: '#34D399', successTint: '#0F2E24',
  warning: '#F5B544', warningTint: '#33270E',
  danger: '#FF6B70', dangerTint: '#3A1518',
  overlay: 'rgba(0,0,0,0.62)',
  hero: ['#101B50', '#2749D6'], heroInk: '#FFFFFF',
  series: ['#6E92FF', '#34D399', '#FFA14D', '#A78BFA', '#FF6B70', '#22D3EE'],
  isDark: true,
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const
export const radius = { sm: 10, md: 14, lg: 20, xl: 26, pill: 999 } as const

/** Font family names as registered by the root layout (see app/_layout.tsx). */
export const fonts = {
  body: 'Inter_400Regular', bodyMedium: 'Inter_500Medium', bodySemi: 'Inter_600SemiBold',
  display: 'Manrope_700Bold', displayMedium: 'Manrope_600SemiBold', displayHeavy: 'Manrope_800ExtraBold',
} as const

export type Variant = 'display' | 'h1' | 'h2' | 'title' | 'body' | 'bodyStrong' | 'caption' | 'micro' | 'num' | 'numLg' | 'label'

const tnum: TextStyle['fontVariant'] = ['tabular-nums']

export const typography: Record<Variant, TextStyle> = {
  display: { fontFamily: fonts.displayHeavy, fontSize: 34, lineHeight: 40, letterSpacing: -0.8, fontVariant: tnum },
  h1: { fontFamily: fonts.display, fontSize: 26, lineHeight: 32, letterSpacing: -0.5 },
  h2: { fontFamily: fonts.display, fontSize: 19, lineHeight: 25, letterSpacing: -0.2 },
  title: { fontFamily: fonts.bodySemi, fontSize: 16, lineHeight: 22 },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22 },
  bodyStrong: { fontFamily: fonts.bodySemi, fontSize: 15, lineHeight: 22 },
  caption: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18 },
  micro: { fontFamily: fonts.bodyMedium, fontSize: 11, lineHeight: 14, letterSpacing: 0.3 },
  label: { fontFamily: fonts.bodyMedium, fontSize: 12, lineHeight: 16, letterSpacing: 0.4 },
  num: { fontFamily: fonts.displayMedium, fontSize: 15, lineHeight: 22, fontVariant: tnum },
  numLg: { fontFamily: fonts.display, fontSize: 22, lineHeight: 28, letterSpacing: -0.4, fontVariant: tnum },
}

export interface Theme {
  c: Palette
  space: typeof space
  radius: typeof radius
  /** A soft elevation that reads on paper in light mode and disappears in dark (borders do the work there). */
  shadow: (level?: 1 | 2 | 3) => ViewStyle
}

function makeShadow(p: Palette): Theme['shadow'] {
  return (level = 1) => {
    if (p.isDark) return {}
    const o = [0, 0.05, 0.08, 0.12][level]
    return Platform.select<ViewStyle>({
      ios: { shadowColor: '#0E1220', shadowOpacity: o, shadowRadius: [0, 6, 14, 26][level], shadowOffset: { width: 0, height: [0, 2, 6, 12][level] } },
      android: { elevation: [0, 1, 3, 8][level], shadowColor: '#0E1220' },
      default: { boxShadow: `0 ${[0, 2, 6, 12][level]}px ${[0, 8, 20, 40][level]}px rgba(14,18,32,${o})` } as ViewStyle,
    }) ?? {}
  }
}

const Ctx = createContext<Theme>({ c: light, space, radius, shadow: makeShadow(light) })

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme()
  const pref = useApp((s) => s.prefs.theme)
  const scheme = pref === 'system' ? (system ?? 'light') : pref
  const theme = useMemo<Theme>(() => {
    const c = scheme === 'dark' ? dark : light
    return { c, space, radius, shadow: makeShadow(c) }
  }, [scheme])
  return <Ctx.Provider value={theme}>{children}</Ctx.Provider>
}

export const useTheme = () => useContext(Ctx)

/** A colour name a component can take instead of a raw hex: resolved against the active palette. */
export type Tone = 'default' | 'soft' | 'mute' | 'primary' | 'success' | 'warning' | 'danger' | 'accent' | 'onPrimary' | 'hero'

export function toneColor(c: Palette, tone: Tone): string {
  switch (tone) {
    case 'soft': return c.inkSoft
    case 'mute': return c.inkMute
    case 'primary': return c.primary
    case 'success': return c.success
    case 'warning': return c.warning
    case 'danger': return c.danger
    case 'accent': return c.accent
    case 'onPrimary': return c.onPrimary
    case 'hero': return c.heroInk
    default: return c.ink
  }
}

/** Soft tinted background that goes with a tone (badges, icon wells). */
export function toneTint(c: Palette, tone: Tone): string {
  switch (tone) {
    case 'primary': return c.primaryTint
    case 'success': return c.successTint
    case 'warning': return c.warningTint
    case 'danger': return c.dangerTint
    case 'accent': return c.accentTint
    default: return c.sunken
  }
}
