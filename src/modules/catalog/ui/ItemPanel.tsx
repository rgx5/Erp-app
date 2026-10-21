import React from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { useApp } from '@/data/store'
import { listOf } from '@/data/state'
import type { PanelProps } from '@/modules/registry'
import { Card, Tap } from '@/ui/primitives'
import { Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { ChevronRight, Image as ImageIcon } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { activeFields, formatFieldValue } from '../fields'
import { AttachmentThumb } from './AttachmentThumb'

/** On an item's page: its main photo, how many files it has, and its custom fields. Opens the full editor. */
export function ItemCatalogPanel({ product }: PanelProps['item']) {
  const { c } = useTheme()
  const router = useRouter()
  const files = useApp((s) => s.data.itemAttachments)
  const defs = useApp((s) => s.data.customFields)
  const vals = useApp((s) => s.data.customFieldValues?.[product.id])
  const mine = listOf(files ?? {}).filter((a) => a.productId === product.id)
  const hero = mine.find((a) => a.kind === 'photo' && a.primary) ?? mine.find((a) => a.kind === 'photo')
  const shown = activeFields(listOf(defs ?? {})).filter((d) => vals?.values[d.id] !== undefined)
  return (
    <Section title="Photos & details" style={{ marginTop: 6 }}>
      <Card padded={false}>
        <Tap onPress={() => router.push({ pathname: '/m/catalog/item/[id]', params: { id: product.id } })} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
          {hero ? <AttachmentThumb a={hero} size={52} /> : (
            <View style={{ width: 52, height: 52, borderRadius: 10, backgroundColor: c.sunken, alignItems: 'center', justifyContent: 'center' }}><ImageIcon size={22} color={c.inkMute} /></View>
          )}
          <View style={{ flex: 1 }}>
            <T v="bodyStrong">{mine.length ? `${mine.length} ${mine.length === 1 ? 'photo or file' : 'photos and files'}` : 'No photos yet'}</T>
            <T v="caption" tone="mute">{shown.length ? `${shown.length} custom ${shown.length === 1 ? 'field' : 'fields'} filled` : 'Add photos, files and custom fields'}</T>
          </View>
          <ChevronRight size={16} color={c.inkMute} />
        </Tap>
        {shown.map((d) => (
          <View key={d.id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingHorizontal: 14, paddingVertical: 9, borderTopWidth: 1, borderTopColor: c.line }}>
            <T v="caption" tone="mute">{d.label}</T>
            <T v="caption">{formatFieldValue(d, vals!.values[d.id])}</T>
          </View>
        ))}
      </Card>
    </Section>
  )
}
