import React, { useMemo, useState } from 'react'
import { Platform, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useList } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { perform, useApp, useCan } from '@/data/store'
import { activeFields } from '@/modules/catalog/fields'
import { addAttachment, MAX_ATTACHMENTS, removeAttachment, setCustomValues, setPrimaryPhoto } from '@/modules/catalog/ops'
import type { CustomFieldDef, ItemAttachment } from '@/modules/catalog/types'
import { needsUpload } from '@/modules/catalog/upload'
import { AttachmentThumb } from '@/modules/catalog/ui/AttachmentThumb'
import { NoAccess } from '@/modules/catalog/ui/common'
import { dropFile, keepFile, pickFile, uploadOne, uploadTarget } from '@/modules/catalog/ui/files'
import { Button } from '@/ui/Button'
import { Field, Select } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Badge, Card, Tap } from '@/ui/primitives'
import { ListRow, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Camera, Cloud, Image as ImageIcon, Paperclip, Star, Trash } from '@/ui/icons'
import { ask, toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

const kb = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

/** One item's photos, files and custom fields. */
export default function ItemCatalog() {
  const { c } = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const can = useCan('inventory')
  const product = useApp((s) => s.data.products[id])
  const files = useList('itemAttachments')
  const defs = useList('customFields')
  const saved = useApp((s) => s.data.customFieldValues?.[id])
  const mine = useMemo(() => files.filter((a) => a.productId === id).sort((a, b) => Number(!!b.primary) - Number(!!a.primary) || a.addedAt - b.addedAt), [files, id])
  const fields = useMemo(() => activeFields(defs), [defs])
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [open, setOpen] = useState<ItemAttachment | null>(null)
  const [busy, setBusy] = useState(false)
  const online = !!uploadTarget()

  if (!can) return <NoAccess title="Photos & details" who="the owner and managers" />
  if (!product) return <Screen title="Photos & details" back><T tone="mute">This item no longer exists.</T></Screen>

  const shown = (d: CustomFieldDef) => draft[d.id] ?? (saved?.values[d.id] === undefined ? '' : d.type === 'yesno' ? (saved.values[d.id] ? 'Yes' : 'No') : String(saved.values[d.id]))
  const dirty = Object.keys(draft).length > 0

  async function attach(kind: 'photo' | 'file') {
    setBusy(true)
    try {
      const f = await pickFile(kind === 'photo' ? 'image/*' : '*/*')
      if (!f) return
      const uri = await keepFile(f.uri, f.name)
      perform((s, ctx) => addAttachment(s, { productId: id, kind, name: f.name, uri, mime: f.mime, size: f.size }, ctx))
      toast(kind === 'photo' ? 'Photo added' : 'File added', 'ok')
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not add the file', 'err') } finally { setBusy(false) }
  }

  async function remove(a: ItemAttachment) {
    if (!(await ask({ title: `Remove ${a.name}?`, message: a.remoteId ? 'It stays on the server but is no longer shown on this item.' : 'The copy on this phone is deleted.', confirm: 'Remove', danger: true }))) return
    try { const r = perform((s, ctx) => removeAttachment(s, a.id, ctx)); dropFile(r.removed.uri); setOpen(null) } catch (e) { toast(e instanceof OpError ? e.message : 'Could not remove', 'err') }
  }

  async function upload(a: ItemAttachment) {
    setBusy(true)
    const err = await uploadOne(a)
    setBusy(false)
    if (err) toast(err, 'err'); else { toast('Uploaded', 'ok'); setOpen(null) }
  }

  function saveFields() {
    try {
      perform((s, ctx) => setCustomValues(s, id, draft, ctx))
      setDraft({}); toast('Saved', 'ok')
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not save', 'err') }
  }

  return (
    <Screen title={product.name} subtitle={`${product.styleCode} · photos & details`} back
      footer={dirty ? <Button label="Save details" size="lg" block onPress={saveFields} /> : undefined}>
      <View style={{ gap: 14, paddingBottom: 20 }}>
        <Section title={`Photos and files · ${mine.length}/${MAX_ATTACHMENTS}`} style={{ marginTop: 0 }}>
          <Card style={{ gap: 14 }}>
            {mine.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                {mine.map((a) => (
                  <Tap key={a.id} onPress={() => setOpen(a)} style={{ width: 84, gap: 4 }}>
                    <AttachmentThumb a={a} />
                    <T v="micro" tone="mute" numberOfLines={1}>{a.primary ? 'Main photo' : a.name}</T>
                  </Tap>
                ))}
              </View>
            ) : <T tone="mute">Nothing attached yet. Take a photo of the item, or attach a spec sheet or warranty card.</T>}
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {Platform.OS !== 'web' ? <Button label="Take photo" size="sm" icon={<Camera size={15} color={c.bg} />} onPress={() => router.push({ pathname: '/m/catalog/camera', params: { productId: id } })} /> : null}
              <Button label="Choose photo" size="sm" kind="soft" icon={<ImageIcon size={15} color={c.primary} />} loading={busy} onPress={() => void attach('photo')} />
              <Button label="Attach file" size="sm" kind="soft" icon={<Paperclip size={15} color={c.primary} />} loading={busy} onPress={() => void attach('file')} />
            </View>
            {mine.some(needsUpload) ? <T v="caption" tone="mute">{online ? 'Files marked “On this phone” can be sent to the server so other phones see them.' : 'Files stay on this phone until it is connected to a server.'}</T> : null}
          </Card>
        </Section>

        <Section title="Custom fields" style={{ marginTop: 6 }}>
          {fields.length ? (
            <Card style={{ gap: 14 }}>
              {fields.map((d) => d.type === 'choice' || d.type === 'yesno' ? (
                <Select<string> key={d.id} label={`${d.label}${d.required ? ' *' : ''}`} value={shown(d)} placeholder="Not set"
                  options={[{ value: '', label: 'Not set' }, ...(d.type === 'yesno' ? ['Yes', 'No'] : d.options).map((o) => ({ value: o, label: o }))]} onChange={(v) => setDraft({ ...draft, [d.id]: v })} />
              ) : (
                <Field key={d.id} label={`${d.label}${d.required ? ' *' : ''}`} value={shown(d)} onChangeText={(t) => setDraft({ ...draft, [d.id]: t })}
                  keyboardType={d.type === 'number' ? 'decimal-pad' : 'default'} placeholder={d.type === 'date' ? 'YYYY-MM-DD' : undefined} />
              ))}
            </Card>
          ) : (
            <Card><T tone="mute">No custom fields yet. Add the ones your items need (warranty months, shelf, country of origin…).</T>
              <Button label="Set up fields" kind="soft" size="sm" style={{ marginTop: 10, alignSelf: 'flex-start' }} onPress={() => router.push('/m/catalog/fields')} /></Card>
          )}
        </Section>
      </View>

      <Sheet visible={!!open} onClose={() => setOpen(null)} title={open?.name} subtitle={open ? `${open.kind === 'photo' ? 'Photo' : 'File'} · ${kb(open.size)}` : undefined}>
        {open ? (
          <View style={{ gap: 6, paddingBottom: 12 }}>
            {open.kind === 'photo' ? <View style={{ alignItems: 'center', paddingBottom: 10 }}><AttachmentThumb a={open} size={220} /></View> : null}
            <View style={{ flexDirection: 'row', gap: 8, paddingBottom: 6 }}>
              <Badge tone={open.remoteId ? 'success' : 'warning'}>{open.remoteId ? 'On the server' : 'On this phone'}</Badge>
              {open.primary ? <Badge tone="primary">Main photo</Badge> : null}
            </View>
            {open.kind === 'photo' && !open.primary ? <ListRow icon={<Star size={18} color={c.primary} />} title="Make main photo" onPress={() => { perform((s) => setPrimaryPhoto(s, open.id)); setOpen(null) }} /> : null}
            {!open.remoteId && online ? <ListRow icon={<Cloud size={18} color={c.primary} />} title="Upload to the server" subtitle="So other phones can see it" onPress={() => void upload(open)} /> : null}
            <ListRow icon={<Trash size={18} color={c.danger} />} iconTone="danger" title="Remove" danger onPress={() => void remove(open)} />
          </View>
        ) : null}
      </Sheet>
    </Screen>
  )
}

