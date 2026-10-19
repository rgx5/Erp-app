import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { router } from 'expo-router'
import { variantLabel } from '@/domain/codes'
import { fmtQtyUnit } from '@/domain/qty'
import { buildIndex, parseQuery, searchGroups } from '@/domain/search'
import type { VariantView } from '@/domain/views'
import { useLabels, useVariantViews } from '@/data/hooks'
import { findVariantByCode } from '@/data/lookup'
import { useApp } from '@/data/store'
import { Sheet } from '@/ui/Sheet'
import { IconButton } from '@/ui/Button'
import { SearchBar } from '@/ui/Inputs'
import { Badge, Tap } from '@/ui/primitives'
import { T } from '@/ui/Text'
import { Check, Plus, ScanBarcode } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { openScanner, type ScanResult } from './scanBus'

/**
 * Opens the camera scanner and hands every barcode that matches an item to `onFound`. Whatever it returns becomes the
 * line of feedback on the scanner ("Added Oxford Shirt · M"); return a `{ ok: false }` result to refuse a code.
 */
export function scanVariants(onFound: (v: VariantView) => ScanResult | string | void, opts: { title?: string; hint?: string; noun?: string } = {}) {
  const noun = (opts.noun ?? 'item').toLowerCase()
  openScanner((code) => {
    const v = findVariantByCode(useApp.getState().data, code)
    if (!v) return { ok: false, text: `No ${noun} for ${code}` }
    if (!v.active) return { ok: false, text: `${v.productName} is archived` }
    const r = onFound(v)
    if (r && typeof r === 'object') return r
    return { ok: true, text: r || `${v.productName}${variantLabel(v.size, v.color) ? ` · ${variantLabel(v.size, v.color)}` : ''}` }
  }, { title: opts.title ?? `Scan ${noun}s`, hint: opts.hint })
  router.push('/scan')
}

/**
 * A search-as-you-type picker for variants, used wherever a screen builds a list of items (goods receipts, counts).
 * It stays open so several can be added in a row; `picked` marks the ones already on the list.
 */
export function ItemPicker({ visible, onClose, onPick, picked, title, subtitle, scanTitle, trackedOnly }: {
  visible: boolean
  onClose: () => void
  onPick: (v: VariantView) => void
  picked?: ReadonlySet<string>
  title?: string
  subtitle?: string
  scanTitle?: string
  /** Leave out services and other items that have no stock. */
  trackedOnly?: boolean
}) {
  const { c, radius } = useTheme()
  const labels = useLabels()
  const views = useVariantViews()
  const [q, setQ] = useState('')

  const index = useMemo(() => (visible ? buildIndex(views.filter((v) => !trackedOnly || v.trackStock)).sort((a, b) => a.name.localeCompare(b.name)) : []), [visible, views, trackedOnly])
  const results = useMemo(() => {
    if (!visible) return []
    const { tokens } = parseQuery(q)
    if (!tokens.length) return index.slice(0, 12).map((group) => ({ group, variants: group.variants }))
    return searchGroups(index, tokens, 15)
  }, [visible, index, q])

  function scan() {
    onClose()
    setTimeout(() => scanVariants((v) => { onPick(v); return undefined }, { title: scanTitle, noun: labels.item }), 240)
  }

  return (
    <Sheet visible={visible} onClose={() => { setQ(''); onClose() }} title={title ?? `Add ${labels.item.toLowerCase()}`} subtitle={subtitle} full>
      <View style={{ gap: 14, paddingBottom: 14 }}>
        <SearchBar value={q} onChange={setQ} placeholder="Name, code, brand or barcode" autoFocus
          right={<IconButton label="Scan" onPress={scan} size={48}><ScanBarcode size={22} color={c.ink} /></IconButton>} />
        {!results.length ? (
          <T tone="mute" align="center" style={{ paddingVertical: 28 }}>{q.trim().length < 2 ? 'Start typing, or scan a barcode.' : `No ${labels.items.toLowerCase()} match “${q.trim()}”.`}</T>
        ) : results.map(({ group, variants }) => {
          const single = group.variants.length === 1
          if (single) {
            const v = group.variants[0]
            const on = picked?.has(v.id)
            return (
              <Tap key={group.id} onPress={() => onPick(v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: radius.md, borderWidth: on ? 1.5 : 1, borderColor: on ? c.primary : c.line, backgroundColor: on ? c.primaryTint : c.surface }}>
                <View style={{ flex: 1, gap: 1 }}>
                  <T v="bodyStrong" numberOfLines={1}>{group.name}</T>
                  <T v="caption" tone="mute" numberOfLines={1}>{[group.styleCode, v.trackStock ? `${fmtQtyUnit(v.stock, v)} in stock` : 'Not counted'].filter(Boolean).join(' · ')}</T>
                </View>
                {on ? <Check size={20} color={c.primary} /> : <Plus size={20} color={c.inkMute} />}
              </Tap>
            )
          }
          return (
            <View key={group.id} style={{ gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                <T v="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>{group.name}</T>
                <T v="caption" tone="mute" numberOfLines={1}>{[group.brand, group.styleCode].filter(Boolean).join(' · ')}</T>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {variants.map((v) => {
                  const on = picked?.has(v.id)
                  return (
                    <Tap key={v.id} onPress={() => onPick(v)} style={{ minWidth: 86, paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: on ? 1.5 : 1, borderColor: on ? c.primary : c.lineStrong, backgroundColor: on ? c.primaryTint : c.surface, gap: 1 }}>
                      <T v="bodyStrong" numberOfLines={1}>{variantLabel(v.size, v.color) || 'Standard'}</T>
                      <T v="micro" tone={v.trackStock && v.stock <= v.reorderLevel ? 'warning' : 'mute'}>{v.trackStock ? `${fmtQtyUnit(v.stock, v)} left` : 'Not counted'}</T>
                      {v.price > 0 ? null : <Badge tone="accent">No price</Badge>}
                    </Tap>
                  )
                })}
              </View>
            </View>
          )
        })}
      </View>
    </Sheet>
  )
}
