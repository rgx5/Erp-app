import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { variantLabel } from '@/domain/codes'
import { useList, useStore, useVariantViews } from '@/data/hooks'
import { useApp, useCan } from '@/data/store'
import { ItemPicker } from '@/features/ItemPicker'
import { printHtml } from '@/features/share'
import { allTemplates, findTemplate, labelSheetHtml, type TemplateItem } from '@/modules/catalog/labels'
import { catalogSettings } from '@/modules/catalog/logic'
import { NoAccess } from '@/modules/catalog/ui/common'
import { Button, IconButton } from '@/ui/Button'
import { NumberField, Select } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Card } from '@/ui/primitives'
import { Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Plus, Printer, Trash } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

interface Line { variantId: string; copies: string }

/** Print price labels in one of the label designs: pick the items, how many of each, and print. */
export default function PrintLabels() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('inventory')
  const store = useStore()
  const views = useVariantViews()
  const stored = useList('labelTemplates')
  const settings = useApp((s) => catalogSettings(s.data))
  const [tid, setTid] = useState<string>('')
  const [lines, setLines] = useState<Line[]>([])
  const [picking, setPicking] = useState(false)
  const byId = useMemo(() => new Map(views.map((v) => [v.id, v])), [views])
  const template = findTemplate(stored, tid || settings.labelTemplateId)

  if (!can) return <NoAccess title="Print labels" who="the owner and managers" />

  const items: TemplateItem[] = lines.flatMap((l) => {
    const v = byId.get(l.variantId)
    return v ? [{ name: v.productName, variant: variantLabel(v.size, v.color), sku: v.sku, barcode: v.barcode, price: v.price, mrp: v.mrp, copies: Math.max(1, Number(l.copies) || 1), brand: v.brand, hsn: v.hsn }] : []
  })
  const total = items.reduce((s, i) => s + i.copies, 0)
  const perPage = template.paper === 'sheet' ? template.perRow * Math.max(1, Math.floor(277 / (template.heightMm + 2))) : 1

  return (
    <Screen title="Print labels" subtitle={total ? `${total} labels` : undefined} back
      footer={<Button label={total ? `Print ${total} ${total === 1 ? 'label' : 'labels'}` : 'Add items to print'} size="lg" block disabled={!total} icon={<Printer size={18} color={c.onPrimary} />}
        onPress={() => void printHtml(labelSheetHtml(items, template, store.name))} />}>
      <View style={{ gap: 14, paddingBottom: 16 }}>
        <Select<string> label="Label design" value={template.id} options={allTemplates(stored).map((t) => ({ value: t.id, label: t.name, sub: `${t.widthMm} × ${t.heightMm} mm · ${t.code === 'qr' ? 'QR code' : t.code === 'bars' ? 'barcode' : 'text only'}` }))} onChange={setTid} />
        <Button label="Edit label designs" kind="ghost" size="sm" onPress={() => router.push('/m/catalog/templates')} style={{ alignSelf: 'flex-start' }} />
        <Section title="Items" style={{ marginTop: 0 }}>
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
                  <IconButton label="Remove" tone="ghost" size={36} onPress={() => setLines(lines.filter((x) => x.variantId !== l.variantId))}><Trash size={18} color={c.inkMute} /></IconButton>
                </Card>
              )
            })}
            <Button label="Add item" kind="soft" block icon={<Plus size={18} color={c.primary} />} onPress={() => setPicking(true)} />
            {lines.length ? <Button label="Set every count to the stock on hand" kind="ghost" size="sm" onPress={() => setLines(lines.map((l) => ({ ...l, copies: String(Math.max(1, Math.round(byId.get(l.variantId)?.stock ?? 1))) })))} /> : null}
          </View>
        </Section>
        {total ? <T v="caption" tone="mute">{template.paper === 'sheet' ? `About ${Math.ceil(total / perPage)} A4 ${Math.ceil(total / perPage) === 1 ? 'page' : 'pages'}` : `${total} labels on the roll`}.</T> : null}
      </View>
      <ItemPicker visible={picking} onClose={() => setPicking(false)} onPick={(v) => setLines((cur) => (cur.some((l) => l.variantId === v.id) ? cur : [...cur, { variantId: v.id, copies: '1' }]))} picked={new Set(lines.map((l) => l.variantId))} title="Add item to print" />
    </Screen>
  )
}
