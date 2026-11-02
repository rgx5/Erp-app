import React, { useMemo, useState } from 'react'
import { Pressable, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native'
import { T } from '@/ui/Text'
import { toneColor, toneTint, useTheme, type Tone } from '@/ui/theme'
import { fonts } from '@/ui/theme'

/**
 * The desktop design language: "dense data-grid classic" — Tally, Zoho Books, QuickBooks Desktop. Same brand colours
 * and type faces as the phone app (`src/ui/theme.tsx`), but a tighter scale built for someone at a keyboard and a
 * mouse, staring at it for eight hours — compact rows, real tables, numbers that line up, shortcuts that are visible
 * rather than hidden. The phone app never imports this; it is used only from the desktop-width branch of a screen
 * (`useBreakpoint().isDesktop`), so phone and web-at-phone-width are completely unaffected.
 */

// ───────────────────────────── scale ─────────────────────────────

/** A dense table's row height; the number this app is built around (see `Row`). */
export const ROW_H = 34
export const ROW_H_COMPACT = 28

export const dtext = {
  tiny: { fontFamily: fonts.body, fontSize: 11, lineHeight: 14 },
  label: { fontFamily: fonts.bodyMedium, fontSize: 11, lineHeight: 14, letterSpacing: 0.4, textTransform: 'uppercase' as const },
  cell: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 17 },
  cellStrong: { fontFamily: fonts.bodySemi, fontSize: 12.5, lineHeight: 17 },
  num: { fontFamily: fonts.displayMedium, fontSize: 12.5, lineHeight: 17, fontVariant: ['tabular-nums'] as const },
  numStrong: { fontFamily: fonts.display, fontSize: 13.5, lineHeight: 18, fontVariant: ['tabular-nums'] as const },
  title: { fontFamily: fonts.display, fontSize: 18, lineHeight: 23, letterSpacing: -0.3 },
  kpi: { fontFamily: fonts.display, fontSize: 24, lineHeight: 29, letterSpacing: -0.4, fontVariant: ['tabular-nums'] as const },
}

// ───────────────────────────── layout shells ─────────────────────────────

/** The page frame every dense desktop screen uses: a slim toolbar, then a full-bleed body (no phone-style
 * safe-area padding or scroll-by-default — a table manages its own scrolling). */
export function DeskPage({ toolbar, children, style }: { toolbar?: React.ReactNode; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme()
  return (
    <View style={[{ flex: 1, backgroundColor: c.bg }, style]}>
      {toolbar}
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  )
}

/** A slim top bar: title + optional subtitle on the left, filters/actions on the right. Every desktop screen's
 * header is one of these — never the phone `Screen`'s tall header. */
export function Toolbar({ title, subtitle, left, right }: { title: string; subtitle?: string; left?: React.ReactNode; right?: React.ReactNode }) {
  const { c } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, height: 56, borderBottomWidth: 1, borderBottomColor: c.line, backgroundColor: c.surface }}>
      <View style={{ gap: 1 }}>
        <T style={dtext.title}>{title}</T>
        {subtitle ? <T style={[dtext.tiny, { color: c.inkMute }]}>{subtitle}</T> : null}
      </View>
      {left ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>{left}</View> : null}
      <View style={{ flex: 1 }} />
      {right ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>{right}</View> : null}
    </View>
  )
}

/** Two (or three) resizable-looking panes side by side — a list and its detail, a search pane and a cart. Widths are
 * fixed per screen (not drag-resizable; that is real complexity for little payoff in a first pass). */
export function SplitPane({ children, widths }: { children: React.ReactNode[]; widths?: Array<number | 'flex'> }) {
  const { c } = useTheme()
  return (
    <View style={{ flex: 1, flexDirection: 'row' }}>
      {React.Children.map(children, (child, i) => {
        const w = widths?.[i] ?? 'flex'
        return (
          <View style={[w === 'flex' ? { flex: 1 } : { width: w }, i > 0 ? { borderLeftWidth: 1, borderLeftColor: c.line } : null, { backgroundColor: i % 2 ? c.bg : c.surface }]}>
            {child}
          </View>
        )
      })}
    </View>
  )
}

// ───────────────────────────── KPI strip ─────────────────────────────

export function KpiTile({ label, value, delta, tone = 'default', onPress }: { label: string; value: string; delta?: string; tone?: Tone; onPress?: () => void }) {
  const { c } = useTheme()
  const Wrap = onPress ? Pressable : View
  return (
    <Wrap onPress={onPress} style={{ flex: 1, minWidth: 148, paddingVertical: 14, paddingHorizontal: 16, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, gap: 4 }}>
      <T style={[dtext.label, { color: c.inkMute }]}>{label}</T>
      <T style={[dtext.kpi, { color: toneColor(c, tone === 'default' ? 'default' : tone) }]}>{value}</T>
      {delta ? <T style={[dtext.tiny, { color: c.inkMute }]}>{delta}</T> : null}
    </Wrap>
  )
}

export function KpiStrip({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 4, flexWrap: 'wrap' }}>{children}</View>
}

// ───────────────────────────── data table ─────────────────────────────

export interface Column<T> {
  key: string
  label: string
  width?: number | 'flex'
  align?: 'left' | 'right' | 'center'
  render: (row: T) => React.ReactNode
  /** A column a click can sort by; `sortValue` is what gets compared. Omit for a column that cannot be sorted. */
  sortValue?: (row: T) => string | number
}

/** A dense, sortable table — the workhorse of the desktop app. Zebra-striped rows at `ROW_H`, a sticky-feeling
 * header, numeric columns right-aligned with tabular figures. No virtualisation in this first pass: fine into the
 * low thousands of rows, which covers every report here; a screen with more should pass it a pre-filtered page. */
export function DataTable<T extends { id: string }>({ columns, rows, onRowPress, rowTone, compact, footer, emptyLabel = 'Nothing here yet' }: {
  columns: Array<Column<T>>
  rows: T[]
  onRowPress?: (row: T) => void
  /** A row can be tinted (e.g. a negative balance in red) without a whole custom renderer. */
  rowTone?: (row: T) => Tone | undefined
  compact?: boolean
  /** A totals row pinned under the header, above the scrolling body. */
  footer?: React.ReactNode
  emptyLabel?: string
}) {
  const { c } = useTheme()
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null)
  const h = compact ? ROW_H_COMPACT : ROW_H

  const sorted = useMemo(() => {
    if (!sort) return rows
    const col = columns.find((x) => x.key === sort.key)
    if (!col?.sortValue) return rows
    return [...rows].sort((a, b) => {
      const av = col.sortValue!(a), bv = col.sortValue!(b)
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv))
      return cmp * sort.dir
    })
  }, [rows, sort, columns])

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', height: 30, borderBottomWidth: 1, borderBottomColor: c.lineStrong, backgroundColor: c.sunken }}>
        {columns.map((col) => {
          const active = sort?.key === col.key
          return (
            <Pressable
              key={col.key}
              disabled={!col.sortValue}
              onPress={() => setSort(active ? { key: col.key, dir: sort!.dir === 1 ? -1 : 1 } : { key: col.key, dir: 1 })}
              style={[
                { justifyContent: 'center', paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 3 },
                col.width === 'flex' || col.width === undefined ? { flex: 1 } : { width: col.width },
                col.align === 'right' ? { justifyContent: 'flex-end' } : col.align === 'center' ? { justifyContent: 'center' } : null,
              ]}
            >
              <T style={[dtext.label, { color: active ? c.ink : c.inkMute }]} numberOfLines={1}>{col.label}</T>
              {active ? <T style={[dtext.tiny, { color: c.ink }]}>{sort!.dir === 1 ? '▲' : '▼'}</T> : null}
            </Pressable>
          )
        })}
      </View>
      {footer}
      {rows.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 40 }}>
          <T style={[dtext.cell, { color: c.inkMute }]}>{emptyLabel}</T>
        </View>
      ) : (
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator>
          {sorted.map((row, i) => (
            <DataRow key={row.id} row={row} columns={columns} height={h} zebra={i % 2 === 1} tone={rowTone?.(row)} onPress={onRowPress} />
          ))}
        </ScrollView>
      )}
    </View>
  )
}

/** One row of `DataTable`. A plain `View`'s `style` cannot be a function (unlike `Pressable`'s render-prop form), so
 * a row with no `onPress` must get a plain object either way — this computes the same base style for both, and
 * tracks hover itself (via `onHoverIn`/`onHoverOut`, which react-native-web supports) rather than relying on
 * `Pressable`'s hover-only render prop, so the two cases share one code path instead of silently diverging. */
function DataRow<T>({ row, columns, height, zebra, tone, onPress }: {
  row: T; columns: Array<Column<T>>; height: number; zebra: boolean; tone?: Tone; onPress?: (row: T) => void
}) {
  const { c } = useTheme()
  const [hovered, setHovered] = useState(false)
  const base: ViewStyle = { flexDirection: 'row', height, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: c.line, backgroundColor: tone ? toneTint(c, tone) : zebra ? c.surfaceAlt : 'transparent' }
  const style = [base, hovered && onPress ? { backgroundColor: c.primaryTint } : null]
  const cells = columns.map((col) => (
    <View key={col.key} style={[{ paddingHorizontal: 10, justifyContent: 'center' }, col.width === 'flex' || col.width === undefined ? { flex: 1 } : { width: col.width }, col.align === 'right' ? { alignItems: 'flex-end' } : col.align === 'center' ? { alignItems: 'center' } : null]}>
      {col.render(row)}
    </View>
  ))
  if (!onPress) return <View style={style}>{cells}</View>
  return (
    <Pressable style={style} onPress={() => onPress(row)} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}>
      {cells}
    </Pressable>
  )
}

/** A plain cell renderer for the common case: a left-aligned label, or a right-aligned number. */
export const cellText = (v: string | number, strong = false) => <T style={strong ? dtext.cellStrong : dtext.cell} numberOfLines={1}>{v}</T>
export const cellNum = (v: string, strong = false) => <T style={strong ? dtext.numStrong : dtext.num}>{v}</T>

// ───────────────────────────── buttons, keys, chips ─────────────────────────────

/** A small pill showing a keyboard shortcut, next to the action it triggers — visible, not hidden, the way a
 * desktop app earns the "keyboard-first" the phone app never could. */
export function KeyHint({ k }: { k: string }) {
  const { c } = useTheme()
  return (
    <View style={{ borderWidth: 1, borderColor: c.lineStrong, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1, backgroundColor: c.sunken }}>
      <T style={[dtext.tiny, { color: c.inkMute, fontFamily: fonts.bodyMedium }]}>{k}</T>
    </View>
  )
}

/** A dense button for a toolbar — the phone app's `Button` is too tall and too padded for a row of them in a bar. */
export function DeskButton({ label, onPress, tone = 'default', icon, hint, disabled }: {
  label: string; onPress: () => void; tone?: Tone; icon?: React.ReactNode; hint?: string; disabled?: boolean
}) {
  const { c } = useTheme()
  const bg = tone === 'primary' ? c.primary : tone === 'danger' ? c.dangerTint : c.surface
  const fg = tone === 'primary' ? c.onPrimary : tone === 'danger' ? c.danger : c.ink
  return (
    <Pressable onPress={onPress} disabled={disabled} style={{ opacity: disabled ? 0.5 : 1, flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, paddingHorizontal: 12, borderRadius: 6, backgroundColor: bg, borderWidth: tone === 'default' ? 1 : 0, borderColor: c.lineStrong }}>
      {icon}
      <T style={[dtext.cellStrong, { color: fg }]}>{label}</T>
      {hint ? <KeyHint k={hint} /> : null}
    </Pressable>
  )
}

/** A compact segmented filter for a toolbar (date range, status…). */
export function DeskSegmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: Array<{ id: T; label: string }> }) {
  const { c } = useTheme()
  return (
    <View style={{ flexDirection: 'row', height: 30, borderRadius: 6, borderWidth: 1, borderColor: c.lineStrong, overflow: 'hidden' }}>
      {options.map((o, i) => {
        const active = o.id === value
        return (
          <Pressable key={o.id} onPress={() => onChange(o.id)} style={[{ paddingHorizontal: 11, justifyContent: 'center', backgroundColor: active ? c.primary : c.surface }, i > 0 ? { borderLeftWidth: 1, borderLeftColor: c.lineStrong } : null]}>
            <T style={[dtext.cellStrong, { color: active ? c.onPrimary : c.inkSoft }]}>{o.label}</T>
          </Pressable>
        )
      })}
    </View>
  )
}

export function Pill({ label, tone = 'default' }: { label: string; tone?: Tone }) {
  const { c } = useTheme()
  return (
    <View style={{ alignSelf: 'flex-start', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 4, backgroundColor: toneTint(c, tone) }}>
      <T style={[dtext.tiny, { color: toneColor(c, tone), fontFamily: fonts.bodyMedium }]}>{label}</T>
    </View>
  )
}
