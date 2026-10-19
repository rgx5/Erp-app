import React from 'react'
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { T } from './Text'
import { Tap } from './primitives'
import { useTheme } from './theme'

export type ButtonKind = 'primary' | 'dark' | 'soft' | 'outline' | 'ghost' | 'danger' | 'success'

export function Button({ label, onPress, kind = 'primary', size = 'md', icon, iconRight, loading, disabled, block, style, haptic = true }: {
  label: string
  onPress?: () => void
  kind?: ButtonKind
  size?: 'sm' | 'md' | 'lg'
  icon?: React.ReactNode
  iconRight?: React.ReactNode
  loading?: boolean
  disabled?: boolean
  block?: boolean
  style?: StyleProp<ViewStyle>
  haptic?: boolean
}) {
  const { c } = useTheme()
  const h = size === 'sm' ? 38 : size === 'lg' ? 56 : 50
  const palette: Record<ButtonKind, { bg: string; fg: string; border?: string }> = {
    primary: { bg: c.primary, fg: c.onPrimary },
    dark: { bg: c.ink, fg: c.bg },
    soft: { bg: c.primaryTint, fg: c.primary },
    outline: { bg: 'transparent', fg: c.ink, border: c.lineStrong },
    ghost: { bg: 'transparent', fg: c.primary },
    danger: { bg: c.dangerTint, fg: c.danger },
    success: { bg: c.success, fg: '#FFFFFF' },
  }
  const p = palette[kind]
  const inner = (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: h, paddingHorizontal: size === 'sm' ? 14 : 20 }}>
      {loading ? <ActivityIndicator color={p.fg} size="small" /> : icon}
      <T v="bodyStrong" style={{ color: p.fg, fontSize: size === 'sm' ? 13.5 : size === 'lg' ? 17 : 15.5 }} numberOfLines={1}>{label}</T>
      {!loading ? iconRight : null}
    </View>
  )
  return (
    <Tap
      onPress={loading || disabled ? undefined : onPress}
      disabled={disabled}
      haptic={haptic}
      style={[{ borderRadius: h / 2.6, overflow: 'hidden', backgroundColor: p.bg, ...(p.border ? { borderWidth: StyleSheet.hairlineWidth * 2, borderColor: p.border } : null), ...(block ? { alignSelf: 'stretch' } : { alignSelf: 'flex-start' }) }, style]}
    >
      {kind === 'primary' ? (
        <LinearGradient colors={[c.primary, c.primaryPressed]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>{inner}</LinearGradient>
      ) : inner}
    </Tap>
  )
}

export function IconButton({ children, onPress, size = 42, tone = 'surface', label }: { children: React.ReactNode; onPress?: () => void; size?: number; tone?: 'surface' | 'ghost' | 'primary' | 'dark'; label: string }) {
  const { c, shadow } = useTheme()
  const bg = tone === 'surface' ? c.surface : tone === 'primary' ? c.primaryTint : tone === 'dark' ? c.ink : 'transparent'
  return (
    <Tap onPress={onPress} accessibilityLabel={label} hitSlop={6}
      style={[{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: bg, borderWidth: tone === 'surface' ? StyleSheet.hairlineWidth : 0, borderColor: c.line }, tone === 'surface' ? shadow(1) : null]}>
      {children}
    </Tap>
  )
}
