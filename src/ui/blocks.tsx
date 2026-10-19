import React from 'react'
import { View, type StyleProp, type ViewStyle } from 'react-native'
import { inr, inrShort, pctLabel } from '@/domain/money'
import { T } from './Text'
import { Button } from './Button'
import { Avatar, Badge, Card, IconWell, Tap } from './primitives'
import { ArrowRight, ArrowUpRight, ChevronRight, TrendingDown, TrendingUp } from './icons'
import { toneColor, useTheme, type Tone } from './theme'
import { Sparkline } from './charts'

export function Section({ title, action, onAction, children, style, gap = 10 }: { title: string; action?: string; onAction?: () => void; children?: React.ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return (
    <View style={[{ marginTop: 22 }, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: gap, paddingHorizontal: 2 }}>
        <T v="h2" style={{ flex: 1 }}>{title}</T>
        {action ? (
          <Tap onPress={onAction} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
            <T v="bodyStrong" tone="primary" style={{ fontSize: 13.5 }}>{action}</T>
            <ArrowRight size={14} color="#2B59FF" />
          </Tap>
        ) : null}
      </View>
      {children}
    </View>
  )
}

export function ListRow({ icon, iconTone = 'primary', avatar, title, subtitle, meta, value, valueTone, sub, onPress, chevron, badge, right, danger, dense }: {
  icon?: React.ReactNode; iconTone?: Tone; avatar?: string; title: string; subtitle?: string; meta?: string
  value?: string; valueTone?: Tone; sub?: string; onPress?: () => void; chevron?: boolean; badge?: React.ReactNode; right?: React.ReactNode; danger?: boolean; dense?: boolean
}) {
  const { c } = useTheme()
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: dense ? 10 : 13 }}>
      {avatar !== undefined ? <Avatar name={avatar} size={40} /> : icon ? <IconWell tone={danger ? 'danger' : iconTone}>{icon}</IconWell> : null}
      <View style={{ flex: 1, gap: 1 }}>
        <T v="bodyStrong" tone={danger ? 'danger' : 'default'} numberOfLines={1}>{title}</T>
        {subtitle ? <T v="caption" tone="mute" numberOfLines={1}>{subtitle}</T> : null}
        {meta ? <T v="caption" tone="soft" numberOfLines={1}>{meta}</T> : null}
      </View>
      {badge}
      {value !== undefined ? (
        <View style={{ alignItems: 'flex-end', gap: 1 }}>
          <T v="num" tone={valueTone ?? 'default'} numberOfLines={1}>{value}</T>
          {sub ? <T v="caption" tone="mute" numberOfLines={1}>{sub}</T> : null}
        </View>
      ) : null}
      {right}
      {chevron ?? !!onPress ? <ChevronRight size={18} color={c.inkMute} /> : null}
    </View>
  )
  return onPress ? <Tap onPress={onPress}>{body}</Tap> : body
}

export function EmptyState({ icon, title, hint, action, onAction, compact }: { icon: React.ReactNode; title: string; hint?: string; action?: string; onAction?: () => void; compact?: boolean }) {
  const { c } = useTheme()
  return (
    <View style={{ alignItems: 'center', paddingVertical: compact ? 22 : 44, paddingHorizontal: 28, gap: 6 }}>
      <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: c.primaryTint, alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>{icon}</View>
      <T v="h2" align="center">{title}</T>
      {hint ? <T tone="mute" align="center" style={{ maxWidth: 300 }}>{hint}</T> : null}
      {action ? <View style={{ marginTop: 14 }}><Button label={action} onPress={onAction} size="md" /></View> : null}
    </View>
  )
}

/** A coloured banner for something that needs a look: a warning, a tip, a sync problem. */
export function Notice({ tone = 'warning', icon, title, body, action, onAction }: { tone?: Tone; icon?: React.ReactNode; title: string; body?: string; action?: string; onAction?: () => void }) {
  const { c } = useTheme()
  const fg = toneColor(c, tone)
  const tint = tone === 'warning' ? c.warningTint : tone === 'danger' ? c.dangerTint : tone === 'success' ? c.successTint : tone === 'accent' ? c.accentTint : c.primaryTint
  const inner = (
    <>
      {icon ? <View>{icon}</View> : null}
      <View style={{ flex: 1, gap: 1 }}>
        <T v="bodyStrong" style={{ color: fg }}>{title}</T>
        {body ? <T v="caption" style={{ color: fg, opacity: 0.85 }}>{body}</T> : null}
      </View>
      {action ? <T v="bodyStrong" style={{ color: fg, fontSize: 13.5 }}>{action}</T> : null}
    </>
  )
  const box = { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, backgroundColor: tint } as const
  // Only a notice that does something is a button; a plain one must not look disabled.
  return onAction ? <Tap onPress={onAction} style={box}>{inner}</Tap> : <View style={box}>{inner}</View>
}

export function Delta({ pct, invert, label }: { pct: number | null; invert?: boolean; label?: string }) {
  const { c } = useTheme()
  if (pct === null || !Number.isFinite(pct)) return null
  const up = pct >= 0
  const good = invert ? !up : up
  const fg = Math.abs(pct) < 0.05 ? c.inkMute : good ? c.success : c.danger
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
      {up ? <TrendingUp size={13} color={fg} /> : <TrendingDown size={13} color={fg} />}
      <T v="micro" style={{ color: fg }}>{Math.abs(pct) >= 1000 ? (up ? '+999%+' : '−999%+') : pctLabel(pct)}</T>
      {label ? <T v="micro" tone="mute">{label}</T> : null}
    </View>
  )
}

export function StatTile({ label, value, icon, tone = 'primary', delta, deltaInvert, foot, spark, onPress, style }: {
  label: string; value: string; icon?: React.ReactNode; tone?: Tone; delta?: number | null; deltaInvert?: boolean; foot?: string; spark?: number[]; onPress?: () => void; style?: StyleProp<ViewStyle>
}) {
  const { c } = useTheme()
  return (
    <Card onPress={onPress} style={[{ flex: 1, minHeight: 112, gap: 6 }, style]} padded>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {icon ? <IconWell tone={tone} size={30}>{icon}</IconWell> : null}
        <T v="label" tone="mute" style={{ flex: 1 }} numberOfLines={1}>{label}</T>
      </View>
      <T v="numLg" numberOfLines={1} adjustsFontSizeToFit style={{ marginTop: 2 }}>{value}</T>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {delta !== undefined ? <Delta pct={delta} invert={deltaInvert} /> : null}
        {foot ? <T v="caption" tone="mute" numberOfLines={1} style={{ flex: 1 }}>{foot}</T> : null}
      </View>
      {spark && spark.length > 1 ? <View style={{ marginTop: 2 }}><Sparkline data={spark} height={26} color={toneColor(c, tone)} /></View> : null}
    </Card>
  )
}

/** A key/value line for breakdowns (subtotal, GST, total…). */
export function KV({ k, v, tone, strong, sub, big }: { k: string; v: string; tone?: Tone; strong?: boolean; sub?: string; big?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: big ? 8 : 5, gap: 12 }}>
      <View style={{ flex: 1 }}>
        <T v={strong ? 'bodyStrong' : 'body'} tone={strong ? 'default' : 'soft'}>{k}</T>
        {sub ? <T v="caption" tone="mute">{sub}</T> : null}
      </View>
      <T v={big ? 'numLg' : strong ? 'bodyStrong' : 'num'} tone={tone} style={big ? undefined : { fontSize: 15 }}>{v}</T>
    </View>
  )
}

/** Rupee text. Negative amounts (returns, refunds) read in red. */
export function Money({ v, short, tone, style, big, decimals }: { v: number; short?: boolean; tone?: Tone; style?: StyleProp<import('react-native').TextStyle>; big?: boolean; decimals?: number }) {
  const t: Tone = tone ?? (v < 0 ? 'danger' : 'default')
  return <T v={big ? 'numLg' : 'num'} tone={t} style={style}>{short ? inrShort(v) : inr(v, decimals)}</T>
}

export const LinkArrow = () => <ArrowUpRight size={14} color="#2B59FF" />
export { Badge }
