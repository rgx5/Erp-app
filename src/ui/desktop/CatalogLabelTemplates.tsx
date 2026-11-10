import React, { useState } from 'react'
import { View } from 'react-native'
import { blank, Mock, num, SAMPLE, type Draft } from '@/modules/catalog/ui/LabelMock'
import { useList } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { perform, useApp, useCan } from '@/data/store'
import { LABEL_FIELDS, LABEL_PRESETS, qrPayload, templateProblem } from '@/modules/catalog/labels'
import { catalogSettings } from '@/modules/catalog/logic'
import { deleteLabelTemplate, saveCatalogSettings, saveLabelTemplate } from '@/modules/catalog/ops'
import type { LabelField, LabelTemplate } from '@/modules/catalog/types'
import { Field, NumberField, Segmented } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { Badge, Card, Chip } from '@/ui/primitives'
import { ListRow, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Plus, QrCode } from '@/ui/icons'
import { ask, toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'
import { DeskButton, DeskPage, Toolbar } from './kit'
import { DesktopSettingsPage } from './SettingsPage'

/**
 * The desktop Label designs screen: the same `DesktopSettingsPage` shell every desktop settings screen uses,
 * reusing the mobile `Mock` preview and `ListRow`/`Sheet` pieces from `src/app/m/catalog/templates.tsx` unchanged.
 */
export function DesktopLabelTemplates() {
  const { c } = useTheme()
  const can = useCan('inventory')
  const stored = useList('labelTemplates')
  const shop = useApp((s) => s.data.store?.name ?? '')
  const current = useApp((s) => catalogSettings(s.data).labelTemplateId)
  const [edit, setEdit] = useState<{ id?: string; d: Draft } | null>(null)
  const [w, setW] = useState('')
  const [h, setH] = useState('')
  const [n, setN] = useState('')

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Label designs" />}>
        <View style={{ padding: 20 }}><T tone="mute">Label designs are for the owner and managers.</T></View>
      </DeskPage>
    )
  }

  const open = (id: string | undefined, d: Draft) => { setEdit({ id, d }); setW(String(d.widthMm)); setH(String(d.heightMm)); setN(String(d.perRow)) }
  const d: Draft | null = edit ? { ...edit.d, widthMm: num(w), heightMm: num(h), perRow: edit.d.paper === 'roll' ? 1 : Number(n) } : null
  const problem = d ? templateProblem(d) : null
  const patch = (p: Partial<Draft>) => edit && setEdit({ ...edit, d: { ...edit.d, ...p } })

  function save() {
    if (!d) return
    try { perform((s, ctx) => saveLabelTemplate(s, d, edit?.id, ctx)); setEdit(null) } catch (e) { toast(e instanceof OpError ? e.message : 'Could not save', 'err') }
  }
  async function remove() {
    if (!edit?.id || !(await ask({ title: 'Delete this label design?', confirm: 'Delete', danger: true }))) return
    try { perform((s) => deleteLabelTemplate(s, edit.id!)); setEdit(null) } catch (e) { toast(e instanceof OpError ? e.message : 'Could not delete', 'err') }
  }
  const makeDefault = (id: string) => { try { perform((s, ctx) => saveCatalogSettings(s, { labelTemplateId: id }, ctx)); toast('Now the default', 'ok') } catch (e) { toast(e instanceof OpError ? e.message : 'Could not save', 'err') } }
  const strip = ({ id: _i, createdAt: _c, ...rest }: LabelTemplate): Draft => { void _i; void _c; return rest }

  return (
    <DesktopSettingsPage title="Label designs" subtitle="Sizes, contents and QR labels" right={<DeskButton label="New design" tone="primary" icon={<Plus size={14} />} onPress={() => open(undefined, blank())} />}>
      <Section title="Your designs" style={{ marginTop: 0 }}>
        <Card padded={false}>
          {stored.length ? stored.map((t) => (
            <ListRow key={t.id} icon={<QrCode size={18} color={c.primary} />} title={t.name} subtitle={`${t.widthMm} × ${t.heightMm} mm · ${t.code === 'qr' ? 'QR code' : t.code === 'bars' ? 'barcode' : 'text only'}`} chevron
              badge={current === t.id ? <Badge tone="primary">Default</Badge> : undefined} onPress={() => open(t.id, strip(t))} />
          )) : <T tone="mute" style={{ padding: 16 }}>None yet. Copy a ready-made design below, or start from scratch with +.</T>}
        </Card>
      </Section>
      <Section title="Ready-made" style={{ marginTop: 0 }}>
        <Card padded={false}>
          {LABEL_PRESETS.map((t) => (
            <ListRow key={t.id} title={t.name} subtitle={`${t.paper === 'sheet' ? `A4 sheet, ${t.perRow} across` : 'Label roll'} · ${t.code === 'qr' ? 'QR code' : 'barcode'}`} chevron
              badge={current === t.id ? <Badge tone="primary">Default</Badge> : undefined} onPress={() => open(undefined, { ...strip(t), name: `${t.name.split(' (')[0]} copy` })} />
          ))}
        </Card>
        <T v="caption" tone="mute">Tap one to make your own copy to change.</T>
      </Section>

      <Sheet visible={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit design' : 'New design'} full
        footer={<View style={{ flexDirection: 'row', gap: 10 }}>
          {edit?.id ? <DeskButton label="Delete" tone="danger" onPress={() => void remove()} /> : null}
          <DeskButton label="Save" tone="primary" disabled={!!problem} onPress={save} />
        </View>}>
        {edit && d ? (
          <View style={{ gap: 14, paddingBottom: 12 }}>
            <Mock t={d} store={shop} />
            {problem ? <T v="caption" tone="danger">{problem}</T> : null}
            <Field label="Name" value={edit.d.name} onChangeText={(t) => patch({ name: t })} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}><NumberField label="Width (mm)" value={w} onChange={setW} decimals /></View>
              <View style={{ flex: 1 }}><NumberField label="Height (mm)" value={h} onChange={setH} decimals /></View>
            </View>
            <Segmented value={edit.d.paper} options={[{ value: 'roll', label: 'Label roll' }, { value: 'sheet', label: 'A4 sheet' }]} onChange={(v) => patch({ paper: v, perRow: v === 'roll' ? 1 : Math.max(1, Number(n) || 3) })} />
            {edit.d.paper === 'sheet' ? <NumberField label="Labels across the sheet" value={n} onChange={setN} /> : null}
            <Segmented value={edit.d.code} options={[{ value: 'bars', label: 'Barcode' }, { value: 'qr', label: 'QR code' }, { value: 'none', label: 'Text only' }]} onChange={(v) => patch({ code: v })} />
            {edit.d.code === 'qr' ? <Field label="What the QR code holds" value={edit.d.qrText} onChangeText={(t) => patch({ qrText: t })} hint="{barcode} {sku} {name} {price} are filled in for each label" /> : null}
            {edit.d.code === 'qr' ? <T v="caption" tone="mute">Example: {qrPayload(edit.d, SAMPLE)}</T> : null}
            <View>
              <T v="label" tone="soft" style={{ marginBottom: 8 }}>Show on the label</T>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {LABEL_FIELDS.map((f: { field: LabelField; label: string }) => (
                  <Chip key={f.field} label={f.label} selected={edit.d.fields.includes(f.field)} onPress={() => patch({ fields: edit.d.fields.includes(f.field) ? edit.d.fields.filter((x) => x !== f.field) : [...edit.d.fields, f.field] })} />
                ))}
              </View>
            </View>
            {edit.id ? <DeskButton label={current === edit.id ? 'This is the default design' : 'Use as the default design'} disabled={current === edit.id} onPress={() => makeDefault(edit.id!)} /> : null}
          </View>
        ) : null}
      </Sheet>
    </DesktopSettingsPage>
  )
}
