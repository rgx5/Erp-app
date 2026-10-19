import React, { useMemo, useState } from 'react'
import { FlatList, View } from 'react-native'
import { useRouter } from 'expo-router'
import { variantLabel } from '@/domain/codes'
import { fmtQty, fmtQtyUnit, round3 } from '@/domain/qty'
import { countSheet, suspiciousCounts } from '@/domain/stock'
import type { VariantView } from '@/domain/views'
import { useLabels, useVariantViews } from '@/data/hooks'
import { OpError, postCount } from '@/data/ops'
import { perform, useCan } from '@/data/store'
import { ItemPicker, scanVariants } from '@/features/ItemPicker'
import { useCount } from '@/features/stockCount'
import { Button, IconButton } from '@/ui/Button'
import { Stepper, Segmented } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Badge, Tap } from '@/ui/primitives'
import { EmptyState, Notice } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { ClipboardCheck, Plus, ScanBarcode, Trash } from '@/ui/icons'
import { ask, toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

type Mode = 'count' | 'review'

/** A physical count: scan (or search) what is on the shelf, review the differences, and post them as corrections. Only counted items change. */
export default function Count() {
  const { c } = useTheme()
  const router = useRouter()
  const labels = useLabels()
  const canStock = useCan('stock')
  const views = useVariantViews()
  const counted = useCount((s) => s.counted)
  const order = useCount((s) => s.order)
  const [mode, setMode] = useState<Mode>('count')
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)

  const byId = useMemo(() => new Map(views.map((v) => [v.id, v])), [views])
  const sheet = useMemo(() => countSheet(order, counted, byId), [order, counted, byId])
  const rows = mode === 'review' ? sheet : [...sheet].sort((a, b) => order.indexOf(b.variant.id) - order.indexOf(a.variant.id))
  const diffs = sheet.filter((r) => r.variance !== 0)
  const doubtful = useMemo(() => new Set(suspiciousCounts(sheet).map((r) => r.variant.id)), [sheet])
  const units = round3(sheet.reduce((s, r) => s + r.physical, 0))

  if (!canStock) return <Screen title="Stock count" back><T tone="mute">Counting is for the owner and managers.</T></Screen>

  const label = (v: VariantView) => variantLabel(v.size, v.color)
  const add = (v: VariantView) => {
    if (!v.trackStock) return { ok: false, text: `${v.productName} isn’t counted in stock` }
    const n = useCount.getState().bump(v.id)
    return { ok: true, text: `${v.productName}${label(v) ? ` · ${label(v)}` : ''} — counted ${fmtQty(n)}` }
  }
  const scan = () => scanVariants(add, { title: 'Count stock', hint: 'Each scan adds one to the count', noun: labels.item })

  async function discard() {
    if (!(await ask({ title: 'Discard this count?', message: 'The figures you have counted so far will be thrown away. Stock is not changed.', confirm: 'Discard', danger: true }))) return
    useCount.getState().clear()
  }

  async function post() {
    if (!diffs.length) { toast('Counts match the system — nothing to correct', 'info'); return }
    const over = diffs.filter((r) => r.variance > 0).length
    const short = diffs.filter((r) => r.variance < 0).length
    const warn = doubtful.size ? `\n\n${doubtful.size} ${doubtful.size === 1 ? 'item is' : 'items are'} counted far below the system figure — check that every piece was scanned.` : ''
    if (!(await ask({ title: `Correct ${diffs.length} ${diffs.length === 1 ? 'figure' : 'figures'}?`, message: `${short} short, ${over} over. Each is written to the stock ledger as a count correction. Items you didn’t count stay as they are.${warn}`, confirm: 'Post count' }))) return
    setBusy(true)
    try {
      perform((s, ctx) => postCount(s, diffs.map((r) => ({ variantId: r.variant.id, variance: r.variance })), ctx))
      useCount.getState().clear()
      toast(`Stock corrected — ${diffs.length} ${diffs.length === 1 ? 'item' : 'items'}`, 'ok')
      router.back()
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not post the count', 'err'); setBusy(false) }
  }

  return (
    <Screen title="Stock count" subtitle={sheet.length ? `${sheet.length} counted · ${fmtQty(units)} units` : 'Scan to start'} back scroll={false}
      right={sheet.length ? <IconButton label="Discard count" onPress={discard}><Trash size={19} color={c.danger} /></IconButton> : undefined}
      footer={sheet.length ? <Button label={diffs.length ? `Post ${diffs.length} ${diffs.length === 1 ? 'correction' : 'corrections'}` : 'Counts match — nothing to post'} size="lg" block loading={busy} disabled={!diffs.length} onPress={post} /> : undefined}>
      <View style={{ gap: 12, paddingBottom: 10 }}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}><Button label="Scan" block icon={<ScanBarcode size={19} color={c.onPrimary} />} onPress={scan} /></View>
          <View style={{ flex: 1 }}><Button label={`Add ${labels.item.toLowerCase()}`} kind="soft" block icon={<Plus size={19} color={c.primary} />} onPress={() => setPicking(true)} /></View>
        </View>
        {sheet.length ? <Segmented<Mode> value={mode} onChange={setMode} options={[{ value: 'count', label: 'Counting' }, { value: 'review', label: diffs.length ? `Review · ${diffs.length} differ` : 'Review' }]} /> : null}
        {mode === 'review' && doubtful.size ? <Notice tone="warning" title={`${doubtful.size} counted far below the system`} body="Usually this means not every piece was scanned. Check before posting." /> : null}
      </View>
      <FlatList
        data={rows} keyExtractor={(r) => r.variant.id} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<EmptyState icon={<ClipboardCheck size={26} color={c.primary} />} title="Start counting" hint={`Scan each ${labels.item.toLowerCase()} on the shelf — every scan adds one. Or add one by search and type the quantity. Differences from the system stock show up under Review.`} />}
        renderItem={({ item: r }) => {
          const v = r.variant
          const d = r.variance
          return (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, marginBottom: 8, borderRadius: 18, backgroundColor: c.surface, borderWidth: 1, borderColor: doubtful.has(v.id) ? c.warning : c.line }}>
              <View style={{ flex: 1, gap: 2 }}>
                <T v="bodyStrong" numberOfLines={1}>{v.productName}</T>
                <T v="caption" tone="mute" numberOfLines={1}>{[label(v), v.sku].filter(Boolean).join(' · ')}</T>
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 2 }}>
                  <Badge>System {fmtQtyUnit(v.stock, v)}</Badge>
                  {d === 0 ? <Badge tone="success">Matches</Badge> : <Badge tone={d < 0 ? 'danger' : 'accent'}>{d < 0 ? `${fmtQty(-d)} short` : `${fmtQty(d)} over`}</Badge>}
                </View>
              </View>
              <Stepper compact value={r.physical} onChange={(n) => useCount.getState().set(v.id, n)} rules={v} />
              <Tap onPress={() => useCount.getState().remove(v.id)} hitSlop={8} accessibilityLabel="Remove from count"><Trash size={17} color={c.inkMute} /></Tap>
            </View>
          )
        }}
      />
      <ItemPicker visible={picking} onClose={() => setPicking(false)} trackedOnly title={`Add ${labels.item.toLowerCase()} to count`} subtitle="Each tap counts one — set the exact quantity in the list"
        picked={new Set(order)} onPick={(v) => { const n = useCount.getState().bump(v.id); toast(`${v.productName}${label(v) ? ` · ${label(v)}` : ''}: ${fmtQty(n)}`, 'ok') }} />
    </Screen>
  )
}
