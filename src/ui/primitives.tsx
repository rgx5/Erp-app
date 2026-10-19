import React, { useEffect, useRef } from 'react'
import { Animated, Easing, Pressable, StyleSheet, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native'
import { T } from './Text'
import { tap } from './feedback'
import { toneColor, toneTint, useTheme, type Tone } from './theme'

/** A pressable with the app's feedback: a gentle press-in and a light haptic tick. */
export function Tap({ onPress, haptic = true, style, children, disabled, ...rest }: Omit<PressableProps, 'style'> & { haptic?: boolean; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={(e) => { if (haptic) tap(); onPress?.(e) }}
      style={({ pressed }) => [style, pressed && !disabled ? { opacity: 0.86, transform: [{ scale: 0.985 }] } : null, disabled ? { opacity: 0.45 } : null]}
      {...rest}
    >
      {children}
    </Pressable>
  )
}

export function Card({ children, style, onPress, padded = true, tone, flat }: {
  children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; padded?: boolean; tone?: Tone; flat?: boolean
}) {
  const { c, radius, shadow } = useTheme()
  const base: ViewStyle = {
    backgroundColor: tone && tone !== 'default' ? toneTint(c, tone) : c.surface, borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: c.line, ...(padded ? { padding: 16 } : null), ...(flat ? null : shadow(1)),
  }
  if (onPress) return <Tap onPress={onPress} style={[base, style]}>{children}</Tap>
  return <View style={[base, style]}>{children}</View>
}

/** A list container: rows separated by hairlines, rounded as one card. */
export function Group({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { c, radius, shadow } = useTheme()
  const kids = React.Children.toArray(children).filter(Boolean)
  return (
    <View style={[{ backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: c.line, overflow: 'hidden' }, shadow(1), style]}>
      {kids.map((k, i) => (
        <View key={i}>
          {k}
          {i < kids.length - 1 ? <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.line, marginLeft: 16 }} /> : null}
        </View>
      ))}
    </View>
  )
}

export function Divider({ inset = 0 }: { inset?: number }) {
  const { c } = useTheme()
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.line, marginLeft: inset }} />
}

export function Badge({ children, tone = 'default', icon, solid }: { children: React.ReactNode; tone?: Tone; icon?: React.ReactNode; solid?: boolean }) {
  const { c } = useTheme()
  const fg = solid ? c.onPrimary : tone === 'default' ? c.inkSoft : toneColor(c, tone)
  const bg = solid ? toneColor(c, tone === 'default' ? 'primary' : tone) : toneTint(c, tone)
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: bg, alignSelf: 'flex-start' }}>
      {icon}
      <T v="micro" style={{ color: fg }} numberOfLines={1}>{children}</T>
    </View>
  )
}

export function Chip({ label, selected, onPress, icon, count, tone }: { label: string; selected?: boolean; onPress?: () => void; icon?: React.ReactNode; count?: number; tone?: Tone }) {
  const { c } = useTheme()
  const bg = selected ? c.ink : c.surface
  const fg = selected ? c.bg : tone ? toneColor(c, tone) : c.inkSoft
  return (
    <Tap onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 36, borderRadius: 999, backgroundColor: bg, borderWidth: StyleSheet.hairlineWidth, borderColor: selected ? c.ink : c.lineStrong }}>
      {icon}
      <T v="bodyStrong" style={{ color: fg, fontSize: 13.5 }} numberOfLines={1}>{label}</T>
      {count !== undefined ? <View style={{ minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? c.bg : c.sunken }}><T v="micro" style={{ color: selected ? c.ink : c.inkSoft }}>{count}</T></View> : null}
    </Tap>
  )
}

const HUES = ['#2B59FF', '#0E9F6E', '#FF8A1F', '#8B5CF6', '#E03E44', '#0891B2', '#D6409F', '#7C8A00']
export function Avatar({ name, size = 40, tone }: { name: string; size?: number; tone?: Tone }) {
  const { c } = useTheme()
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const hue = HUES[h % HUES.length]
  const initials = name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'
  const bg = tone ? toneTint(c, tone) : hue + '22'
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <T v="bodyStrong" style={{ color: tone ? toneColor(c, tone) : hue, fontSize: size * 0.36 }} fixed>{initials}</T>
    </View>
  )
}

/** An icon sitting in a softly tinted rounded square — the leading element of most rows. */
export function IconWell({ children, tone = 'primary', size = 40 }: { children: React.ReactNode; tone?: Tone; size?: number }) {
  const { c } = useTheme()
  return <View style={{ width: size, height: size, borderRadius: size * 0.32, backgroundColor: toneTint(c, tone), alignItems: 'center', justifyContent: 'center' }}>{children}</View>
}

export function ProgressBar({ value, tone = 'primary', height = 6 }: { value: number; tone?: Tone; height?: number }) {
  const { c } = useTheme()
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: c.sunken, overflow: 'hidden' }}>
      <View style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, height, borderRadius: height / 2, backgroundColor: toneColor(c, tone) }} />
    </View>
  )
}

export function Skeleton({ height = 16, width = '100%', radius: r = 8, style }: { height?: number; width?: number | `${number}%`; radius?: number; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme()
  const o = useRef(new Animated.Value(0.5)).current
  useEffect(() => {
    const a = Animated.loop(Animated.sequence([
      Animated.timing(o, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(o, { toValue: 0.5, duration: 800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]))
    a.start()
    return () => a.stop()
  }, [o])
  return <Animated.View style={[{ height, width, borderRadius: r, backgroundColor: c.sunken, opacity: o }, style]} />
}

export const Spacer = ({ h = 16, w }: { h?: number; w?: number }) => <View style={{ height: h, width: w }} />
export const Row = ({ children, gap = 8, style, align = 'center' }: { children: React.ReactNode; gap?: number; style?: StyleProp<ViewStyle>; align?: ViewStyle['alignItems'] }) =>
  <View style={[{ flexDirection: 'row', alignItems: align, gap }, style]}>{children}</View>
