import React, { useMemo, useState } from 'react'
import { ScrollView, View } from 'react-native'
import { useRouter } from 'expo-router'
import { variantLabel } from '@/domain/codes'
import { useList, useStore, useVariantViews } from '@/data/hooks'
import { useApp, useCan } from '@/data/store'
import { ItemPicker } from '@/features/ItemPicker'
import { printHtml } from '@/features/share'
import { allTemplates, findTemplate, labelSheetHtml, type TemplateItem } from '@/modules/catalog/labels'
import { catalogSettings } from '@/modules/catalog/logic'
import { NumberField, Select } from '@/ui/Inputs'
import { Card } from '@/ui/primitives'
import { Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Plus, Printer, Trash } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { DeskButton, DeskPage, Toolbar } from './kit'

interface Line { variantId: string; copies: string }

/**
 * The desktop Print labels screen: a `DeskPage`/`Toolbar` shell around the exact form
 * `src/app/m/catalog/labels.tsx` builds, centred in a readable column, with line items kept as editable mobile
 * `Card`s (same pattern as `DesktopNewPurchase`'s line items). This file is self-contained like the other desktop
 * list/utility screens — it calls the same `useVariantViews`/`labelSheetHtml` the phone screen does.
 */
export function DesktopPrintLabels() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('inventory')
  const store = useStore()
  const views = useVariantViews()
  const stored = useList('labelTemplates')
  const settings = useApp((s) => catalogSettings(s.data))
  const [tid, setTid] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const byId = useMemo(() => new Map(views.map((v) => [v.id, v])), [views])
  const template = findTemplate(stored, tid || settings.labelTemplateId)

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Print labels" />}>
        <View style={{ padding: 20 }}><T tone="mute">Print labels is for the owner and managers.</T></View>
      </DeskPage>
    )
  }

  const items: TemplateItem[] = lines.flatMap((l) => {
    const v = byId.get(l.variantId)
    return v ? [{ name: v.productName, variant: variantLabel(v.size, v.color), sku: v.sku, barcode: v.barcode, price: v.price, mrp: v.mrp, copies: Math.max(1, Number(l.copies) || 1), brand: v.brand, hsn: v.hsn }] : []
  })
  const total = items.reduce((s, i) => s + i.copies, 0)

  return (
    <DeskPage
      toolbar={<Toolbar title="Print labels" subtitle={total ? `${total} labels` : 'Choose items to print'} right={<DeskButton label={total ? `Print ${total} ${total === 1 ? 'label' : 'labels'}` : 'Print'} tone="primary" disabled={!total} icon={<Printer size={14} color={c.onPrimary} />} onPress={() => void printHtml(labelSheetHtml(items, template, store.name))} />} />}
    >
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ alignItems: 'center', padding: 28 }}>
        <View style={{ width: '100%', maxWidth: 680, gap: 14 }}>
          <Select<string> label="Label design" value={template.id} options={allTemplates(stored).map((t) => ({ value: t.id, label: t.name, sub: `${t.widthMm} × ${t.heightMm} mm · ${t.code === 'qr' ? 'QR code' : t.code === 'bars' ? 'barcode' : 'text only'}` }))} onChange={setTid} />
          <DeskButton label="Edit label designs" onPress={() => router.push('/m/catalog/templates')} />
          <Section title="Items" style={{ marginTop: 0 }}>
            <ItemLines lines={lines} setLines={setLines} byId={byId} />
          </Section>
        </View>
      </ScrollView>
    </DeskPage>
  )
}

function ItemLines({ lines, setLines, byId }: { lines: Line[]; setLines: React.Dispatch<React.SetStateAction<Line[]>>; byId: Map<string, ReturnType<typeof useVariantViews>[number]> }) {
  const { c } = useTheme()
  const [picking, setPicking] = useState(false)
  return (
    <View style={{ gap: 10 }}>
      {lines.map((l) => {
        const v = byId.get(l.variantId)
        if (!v) return null
        return (
          <Card key={l.variantId} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <T v="bodyStrong" numberOfLines={1}>{v.productName}</T>
              <T v="caption" tone="mute" numberOfLines={1}>{[variantLabel(v.size, v.color), v.sku].filter(Boolean).join(' · ')}</T>
            </View>
            <View style={{ width: 84 }}><NumberField value={l.copies} onChange={(t) => setLines(lines.map((x) => (x.variantId === l.variantId ? { ...x, copies: t } : x)))} /></View>
            <DeskButton label="Remove" icon={<Trash size={14} color={c.inkMute} />} onPress={() => setLines(lines.filter((x) => x.variantId !== l.variantId))} />
          </Card>
        )
      })}
      <DeskButton label="Add item" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={() => setPicking(true)} />
      {lines.length ? <DeskButton label="Set every count to the stock on hand" onPress={() => setLines(lines.map((l) => ({ ...l, copies: String(Math.max(1, Math.round(byId.get(l.variantId)?.stock ?? 1))) })))} /> : null}
      <ItemPicker visible={picking} onClose={() => setPicking(false)} onPick={(v) => setLines((cur) => (cur.some((l) => l.variantId === v.id) ? cur : [...cur, { variantId: v.id, copies: '1' }]))} picked={new Set(lines.map((l) => l.variantId))} title="Add item to print" />
    </View>
  )
}
