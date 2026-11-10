import React from 'react'
import { Platform, View } from 'react-native'
import { useRouter } from 'expo-router'
import { activeFields } from '@/modules/catalog/fields'
import { MAX_ATTACHMENTS } from '@/modules/catalog/ops'
import type { CustomFieldDef, CustomFieldValues, ItemAttachment } from '@/modules/catalog/types'
import { needsUpload } from '@/modules/catalog/upload'
import { AttachmentThumb } from '@/modules/catalog/ui/AttachmentThumb'
import type { Product } from '@/domain/types'
import { Field, Select } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { Badge, Tap } from '@/ui/primitives'
import { ListRow } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Camera, Cloud, Image as ImageIcon, Paperclip, Star, Trash } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { DeskButton } from './kit'
import { DesktopSettingsPage } from './SettingsPage'

const kb = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

export interface DesktopItemCatalogProps {
  product: Product
  mine: ItemAttachment[]
  defs: CustomFieldDef[]
  saved: CustomFieldValues | undefined
  draft: Record<string, string>
  setDraft: (v: Record<string, string>) => void
  open: ItemAttachment | null
  setOpen: (v: ItemAttachment | null) => void
  busy: boolean
  online: boolean
  dirty: boolean
  onAttach: (kind: 'photo' | 'file') => void
  onRemove: (a: ItemAttachment) => void
  onUpload: (a: ItemAttachment) => void
  onMakePrimary: (a: ItemAttachment) => void
  onSaveFields: () => void
}

/**
 * The desktop item photos/details screen: the same `DesktopSettingsPage` shell every settings-style screen uses,
 * reusing the mobile `AttachmentThumb`/`ListRow`/`Sheet` pieces from `src/app/m/catalog/item/[id].tsx` unchanged.
 */
export function DesktopItemCatalog(p: DesktopItemCatalogProps) {
  const { c } = useTheme()
  const router = useRouter()
  const fields = activeFields(p.defs)
  const shown = (d: CustomFieldDef) => p.draft[d.id] ?? (p.saved?.values[d.id] === undefined ? '' : d.type === 'yesno' ? (p.saved.values[d.id] ? 'Yes' : 'No') : String(p.saved.values[d.id]))

  return (
    <DesktopSettingsPage title={p.product.name} subtitle={`${p.product.styleCode} · photos & details`} right={p.dirty ? <DeskButton label="Save details" tone="primary" onPress={p.onSaveFields} /> : undefined}>
      <View style={{ gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <T v="label" tone="soft" style={{ flex: 1 }}>PHOTOS AND FILES · {p.mine.length}/{MAX_ATTACHMENTS}</T>
        </View>
        {p.mine.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {p.mine.map((a) => (
              <Tap key={a.id} onPress={() => p.setOpen(a)} style={{ width: 84, gap: 4 }}>
                <AttachmentThumb a={a} />
                <T v="micro" tone="mute" numberOfLines={1}>{a.primary ? 'Main photo' : a.name}</T>
              </Tap>
            ))}
          </View>
        ) : <T tone="mute">Nothing attached yet. Take a photo of the item, or attach a spec sheet or warranty card.</T>}
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {Platform.OS !== 'web' ? <DeskButton label="Take photo" icon={<Camera size={14} color={c.ink} />} onPress={() => router.push({ pathname: '/m/catalog/camera', params: { productId: p.product.id } })} /> : null}
          <DeskButton label="Choose photo" icon={<ImageIcon size={14} color={c.primary} />} disabled={p.busy} onPress={() => p.onAttach('photo')} />
          <DeskButton label="Attach file" icon={<Paperclip size={14} color={c.primary} />} disabled={p.busy} onPress={() => p.onAttach('file')} />
        </View>
        {p.mine.some(needsUpload) ? <T v="caption" tone="mute">{p.online ? 'Files marked “On this phone” can be sent to the server so other phones see them.' : 'Files stay on this phone until it is connected to a server.'}</T> : null}
      </View>

      <View style={{ gap: 14, marginTop: 24 }}>
        <T v="label" tone="soft">CUSTOM FIELDS</T>
        {fields.length ? (
          <View style={{ gap: 14 }}>
            {fields.map((d) => d.type === 'choice' || d.type === 'yesno' ? (
              <Select<string> key={d.id} label={`${d.label}${d.required ? ' *' : ''}`} value={shown(d)} placeholder="Not set"
                options={[{ value: '', label: 'Not set' }, ...(d.type === 'yesno' ? ['Yes', 'No'] : d.options).map((o) => ({ value: o, label: o }))]} onChange={(v) => p.setDraft({ ...p.draft, [d.id]: v })} />
            ) : (
              <Field key={d.id} label={`${d.label}${d.required ? ' *' : ''}`} value={shown(d)} onChangeText={(t) => p.setDraft({ ...p.draft, [d.id]: t })}
                keyboardType={d.type === 'number' ? 'decimal-pad' : 'default'} placeholder={d.type === 'date' ? 'YYYY-MM-DD' : undefined} />
            ))}
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            <T tone="mute">No custom fields yet. Add the ones your items need (warranty months, shelf, country of origin…).</T>
            <DeskButton label="Set up fields" onPress={() => router.push('/m/catalog/fields')} />
          </View>
        )}
      </View>

      <Sheet visible={!!p.open} onClose={() => p.setOpen(null)} title={p.open?.name} subtitle={p.open ? `${p.open.kind === 'photo' ? 'Photo' : 'File'} · ${kb(p.open.size)}` : undefined}>
        {p.open ? (
          <View style={{ gap: 6, paddingBottom: 12 }}>
            {p.open.kind === 'photo' ? <View style={{ alignItems: 'center', paddingBottom: 10 }}><AttachmentThumb a={p.open} size={220} /></View> : null}
            <View style={{ flexDirection: 'row', gap: 8, paddingBottom: 6 }}>
              <Badge tone={p.open.remoteId ? 'success' : 'warning'}>{p.open.remoteId ? 'On the server' : 'On this phone'}</Badge>
              {p.open.primary ? <Badge tone="primary">Main photo</Badge> : null}
            </View>
            {p.open.kind === 'photo' && !p.open.primary ? <ListRow icon={<Star size={18} color={c.primary} />} title="Make main photo" onPress={() => p.onMakePrimary(p.open!)} /> : null}
            {!p.open.remoteId && p.online ? <ListRow icon={<Cloud size={18} color={c.primary} />} title="Upload to the server" subtitle="So other phones can see it" onPress={() => p.onUpload(p.open!)} /> : null}
            <ListRow icon={<Trash size={18} color={c.danger} />} iconTone="danger" title="Remove" danger onPress={() => p.onRemove(p.open!)} />
          </View>
        ) : null}
      </Sheet>
    </DesktopSettingsPage>
  )
}
