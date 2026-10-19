import React, { useMemo, useRef, useState } from 'react'
import { PanResponder, View, type LayoutChangeEvent } from 'react-native'
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Rect, Stop } from 'react-native-svg'
import { T } from './Text'
import { useTheme } from './theme'

/** Rounds a chart ceiling up to a "nice" figure (1/2/2.5/5 × 10ⁿ) so the grid reads cleanly. */
export function niceMax(v: number) {
  if (v <= 0) return 1
  const pow = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / pow
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10
  return step * pow
}

/** A smooth curve through the points that never overshoots a peak (monotone cubic), so a quiet day never dips below zero. */
export function smoothPath(pts: Array<[number, number]>): string {
  const n = pts.length
  if (n === 0) return ''
  if (n === 1) return `M${pts[0][0]},${pts[0][1]}`
  const dx: number[] = [], m: number[] = [], t: number[] = []
  for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0]; m[i] = (pts[i + 1][1] - pts[i][1]) / (dx[i] || 1) }
  t[0] = m[0]; t[n - 1] = m[n - 2]
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i] }
  }
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3
    d += ` C${(pts[i][0] + h).toFixed(1)},${(pts[i][1] + t[i] * h).toFixed(1)} ${(pts[i + 1][0] - h).toFixed(1)},${(pts[i + 1][1] - t[i + 1] * h).toFixed(1)} ${pts[i + 1][0].toFixed(1)},${pts[i + 1][1].toFixed(1)}`
  }
  return d
}

export interface TrendPoint { label: string; value: number; note?: string }

/**
 * Area chart with a touch scrubber: press and drag to read any day. Drawn in SVG with a gradient fill; the labels are
 * real text so they stay crisp and scale with the phone's font settings.
 */
export function AreaChart({ data, height = 190, color, format, axisFormat }: { data: TrendPoint[]; height?: number; color?: string; format: (n: number) => string; axisFormat: (n: number) => string }) {
  const { c, radius, shadow } = useTheme()
  const stroke = color ?? c.primary
  const [w, setW] = useState(0)
  const [active, setActive] = useState<number | null>(null)
  const n = data.length
  const padT = 14, padB = 4
  const max = niceMax(Math.max(...data.map((p) => p.value), 0))
  const plotH = height - padT - padB
  const x = (i: number) => (n <= 1 ? w / 2 : (i / (n - 1)) * (w - 8) + 4)
  const y = (v: number) => padT + plotH - (Math.max(0, v) / max) * plotH
  const pts = useMemo(() => data.map((p, i) => [x(i), y(p.value)] as [number, number]), [data, w, max]) // eslint-disable-line react-hooks/exhaustive-deps
  const line = smoothPath(pts)
  const area = pts.length ? `${line} L${pts[pts.length - 1][0]},${padT + plotH} L${pts[0][0]},${padT + plotH} Z` : ''

  // The responder is created once; `geo` keeps it pointed at the latest width and point count.
  const geo = useRef({ w, n })
  geo.current = { w, n }
  const panResponder = useMemo(() => {
    const at = (px: number) => Math.max(0, Math.min(geo.current.n - 1, Math.round(((px - 4) / Math.max(1, geo.current.w - 8)) * (geo.current.n - 1))))
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true, onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => setActive(at(e.nativeEvent.locationX)),
      onPanResponderMove: (e) => setActive(at(e.nativeEvent.locationX)),
      onPanResponderRelease: () => setActive(null), onPanResponderTerminate: () => setActive(null),
    })
  }, [])

  const shown = active ?? (n ? n - 1 : null)
  const every = n > 21 ? 6 : n > 12 ? 3 : n > 7 ? 2 : 1
  const gid = useRef('g' + Math.random().toString(36).slice(2, 7)).current

  return (
    <View onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}>
      <View style={{ height }} {...panResponder.panHandlers}>
        {w > 0 && n > 0 ? (
          <Svg width={w} height={height}>
            <Defs>
              <LinearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={stroke} stopOpacity={0.28} />
                <Stop offset="1" stopColor={stroke} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            {[0, 0.5, 1].map((g) => <Line key={g} x1={0} x2={w} y1={y(max * g)} y2={y(max * g)} stroke={c.line} strokeWidth={1} strokeDasharray={g === 0 ? undefined : '3 5'} />)}
            <Path d={area} fill={`url(#${gid})`} />
            <Path d={line} stroke={stroke} strokeWidth={2.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            {shown !== null ? (
              <G>
                {active !== null ? <Line x1={pts[shown][0]} x2={pts[shown][0]} y1={padT} y2={padT + plotH} stroke={stroke} strokeWidth={1} strokeDasharray="3 3" opacity={0.6} /> : null}
                <Circle cx={pts[shown][0]} cy={pts[shown][1]} r={7} fill={stroke} opacity={0.18} />
                <Circle cx={pts[shown][0]} cy={pts[shown][1]} r={4.2} fill={c.surface} stroke={stroke} strokeWidth={2.4} />
              </G>
            ) : null}
          </Svg>
        ) : null}
        {w > 0 && shown !== null && data[shown] ? (
          <View pointerEvents="none" style={[{ position: 'absolute', top: 0, left: Math.max(0, Math.min(w - 118, pts[shown][0] - 59)), width: 118, paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.sm + 2, backgroundColor: c.ink, alignItems: 'center', opacity: active !== null ? 1 : 0 }, shadow(2)]}>
            <T v="micro" style={{ color: c.bg, opacity: 0.7 }}>{data[shown].label}</T>
            <T v="num" style={{ color: c.bg, fontSize: 14 }}>{format(data[shown].value)}</T>
            {data[shown].note ? <T v="micro" style={{ color: c.bg, opacity: 0.7 }}>{data[shown].note}</T> : null}
          </View>
        ) : null}
        <T v="micro" tone="mute" style={{ position: 'absolute', left: 0, top: -2 }}>{axisFormat(max)}</T>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, paddingHorizontal: 2 }}>
        {data.map((p, i) => (i % every === 0 || i === n - 1) && !(i === n - 1 && (n - 1) % every !== 0 && (n - 1) % every < every / 2) ? <T key={i} v="micro" tone="mute" numberOfLines={1}>{p.label}</T> : <View key={i} />)}
      </View>
    </View>
  )
}

/** A tiny line with a soft fill and no axes, for tiles. */
export function Sparkline({ data, height = 28, color }: { data: number[]; height?: number; color?: string }) {
  const { c } = useTheme()
  const [w, setW] = useState(0)
  const stroke = color ?? c.primary
  const max = Math.max(...data, 1)
  const pts = data.map((v, i) => [(i / Math.max(1, data.length - 1)) * w, height - 3 - (v / max) * (height - 6)] as [number, number])
  const line = smoothPath(pts)
  const gid = useRef('s' + Math.random().toString(36).slice(2, 7)).current
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ height }}>
      {w > 0 && data.length > 1 ? (
        <Svg width={w} height={height}>
          <Defs><LinearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor={stroke} stopOpacity={0.22} /><Stop offset="1" stopColor={stroke} stopOpacity={0} /></LinearGradient></Defs>
          <Path d={`${line} L${w},${height} L0,${height} Z`} fill={`url(#${gid})`} />
          <Path d={line} stroke={stroke} strokeWidth={2} fill="none" strokeLinecap="round" />
        </Svg>
      ) : null}
    </View>
  )
}

/** Rounded vertical bars (daily takings, hourly traffic). The tallest is highlighted. */
export function BarChart({ data, height = 120, color, format }: { data: Array<{ label: string; value: number }>; height?: number; color?: string; format?: (n: number) => string }) {
  const { c } = useTheme()
  const fill = color ?? c.primary
  const max = Math.max(...data.map((d) => d.value), 1)
  const top = data.reduce((m, d, i) => (d.value > data[m].value ? i : m), 0)
  return (
    <View>
      <View style={{ height, flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
        {data.map((d, i) => (
          <View key={i} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', height }}>
            {i === top && format ? <T v="micro" tone="soft" style={{ marginBottom: 3 }} numberOfLines={1}>{format(d.value)}</T> : null}
            <View style={{ width: '100%', maxWidth: 26, height: Math.max(3, (d.value / max) * (height - 18)), borderRadius: 7, backgroundColor: i === top ? fill : fill + '55' }} />
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
        {data.map((d, i) => <T key={i} v="micro" tone="mute" align="center" style={{ flex: 1 }} numberOfLines={1}>{d.label}</T>)}
      </View>
    </View>
  )
}

/** Donut with a centre label. */
export function Donut({ slices, size = 132, thickness = 16, center }: { slices: Array<{ label: string; value: number; color: string }>; size?: number; thickness?: number; center?: React.ReactNode }) {
  const { c } = useTheme()
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0)
  const r = (size - thickness) / 2
  const circ = 2 * Math.PI * r
  let acc = 0
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <G rotation={-90} origin={`${size / 2}, ${size / 2}`}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={c.sunken} strokeWidth={thickness} fill="none" />
          {total > 0 ? slices.map((s, i) => {
            const len = (Math.max(0, s.value) / total) * circ
            const gap = slices.length > 1 ? Math.min(3, len * 0.1) : 0
            const el = <Circle key={i} cx={size / 2} cy={size / 2} r={r} stroke={s.color} strokeWidth={thickness} fill="none" strokeLinecap="butt" strokeDasharray={`${Math.max(0, len - gap)} ${circ - Math.max(0, len - gap)}`} strokeDashoffset={-acc} />
            acc += len
            return el
          }) : null}
        </G>
      </Svg>
      {center}
    </View>
  )
}

/** Labelled horizontal bars — top sellers, expense categories, staff sales. */
export function HBars({ items, format, color }: { items: Array<{ label: string; value: number; sub?: string; color?: string }>; format: (n: number) => string; color?: string }) {
  const { c } = useTheme()
  const max = Math.max(...items.map((i) => Math.abs(i.value)), 1)
  return (
    <View style={{ gap: 14 }}>
      {items.map((it, i) => (
        <View key={i} style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            <T v="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>{it.label}</T>
            <T v="num" style={{ fontSize: 14 }}>{format(it.value)}</T>
          </View>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: c.sunken, overflow: 'hidden' }}>
            <View style={{ width: `${Math.max(2, (Math.abs(it.value) / max) * 100)}%`, height: 8, borderRadius: 4, backgroundColor: it.color ?? color ?? c.primary }} />
          </View>
          {it.sub ? <T v="caption" tone="mute">{it.sub}</T> : null}
        </View>
      ))}
    </View>
  )
}

export function Legend({ items }: { items: Array<{ label: string; value: string; color: string; pct?: string }> }) {
  return (
    <View style={{ gap: 10, flex: 1 }}>
      {items.map((it, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: it.color }} />
          <T v="bodyStrong" style={{ flex: 1, textTransform: 'capitalize' }} numberOfLines={1}>{it.label}</T>
          <T v="num" style={{ fontSize: 14 }}>{it.value}</T>
          {it.pct ? <T v="micro" tone="mute" style={{ width: 34, textAlign: 'right' }}>{it.pct}</T> : null}
        </View>
      ))}
    </View>
  )
}

export function BarcodeView({ bits, width = 220, height = 56, color = '#000' }: { bits: string; width?: number; height?: number; color?: string }) {
  const unit = width / (bits.length + 22)
  const rects: React.ReactNode[] = []
  let i = 0
  while (i < bits.length) {
    if (bits[i] === '1') {
      let j = i
      while (j < bits.length && bits[j] === '1') j++
      rects.push(<Rect key={i} x={(i + 11) * unit} y={0} width={(j - i) * unit} height={height} fill={color} />)
      i = j
    } else i++
  }
  return <Svg width={width} height={height}>{rects}</Svg>
}
