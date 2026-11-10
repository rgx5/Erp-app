import React, { useState } from 'react'
import { View } from 'react-native'
import { useList } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { perform, useCan } from '@/data/store'
import { activeFields, FIELD_TYPE_LABEL } from '@/modules/catalog/fields'
import { deleteCustomField, saveCustomField } from '@/modules/catalog/ops'
import type { CustomFieldDef, CustomFieldType } from '@/modules/catalog/types'
import { Field, Select, SwitchRow } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { Badge, Card } from '@/ui/primitives'
import { ListRow } from '@/ui/blocks'
import { TagInput } from '@/ui/TagInput'
import { T } from '@/ui/Text'
import { Plus } from '@/ui/icons'
import { ask, toast } from '@/ui/overlays'
import { DeskButton, DeskPage, Toolbar } from './kit'
import { DesktopSettingsPage } from './SettingsPage'

const TYPES = (Object.keys(FIELD_TYPE_LABEL) as CustomFieldType[]).map((t) => ({ value: t, label: FIELD_TYPE_LABEL[t] }))

/**
 * The desktop Custom fields screen: the same `DesktopSettingsPage` shell every desktop settings screen uses,
 * reusing the mobile `ListRow`/`Sheet`/`TagInput` pieces unchanged.
 */
export function DesktopCustomFields() {
  const can = useCan('inventory')
  const defs = useList('customFields')
  const [edit, setEdit] = useState<CustomFieldDef | 'new' | null>(null)
  const [label, setLabel] = useState('')
  const [type, setType] = useState<CustomFieldType>('text')
  const [options, setOptions] = useState<string[]>([])
  const [required, setRequired] = useState(false)
  const [active, setActive] = useState(true)

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Custom fields" />}>
        <View style={{ padding: 20 }}><T tone="mute">Custom fields are for the owner and managers.</T></View>
      </DeskPage>
    )
  }

  const open = (d: CustomFieldDef | 'new') => {
    setEdit(d)
    setLabel(d === 'new' ? '' : d.label); setType(d === 'new' ? 'text' : d.type); setOptions(d === 'new' ? [] : d.options)
    setRequired(d === 'new' ? false : d.required); setActive(d === 'new' ? true : d.active)
  }
  function save() {
    try {
      perform((s, ctx) => saveCustomField(s, { label, type, options, required, active }, edit === 'new' || !edit ? undefined : edit.id, ctx))
      setEdit(null)
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not save', 'err') }
  }
  async function remove(d: CustomFieldDef) {
    if (!(await ask({ title: `Delete ${d.label}?`, message: 'The values items have in this field are removed too.', confirm: 'Delete', danger: true }))) return
    try { perform((s, ctx) => deleteCustomField(s, d.id, ctx)); setEdit(null) } catch (e) { toast(e instanceof OpError ? e.message : 'Could not delete', 'err') }
  }

  const sorted = [...activeFields(defs), ...defs.filter((d) => !d.active)]
  return (
    <DesktopSettingsPage title="Custom fields" subtitle="Extra details on every item" right={<DeskButton label="New field" tone="primary" icon={<Plus size={14} />} onPress={() => open('new')} />}>
      {!defs.length ? (
        <T tone="mute">No custom fields yet. Warranty months, shelf, country of origin, fabric care — add what your items need, then fill it in on each item or in an import file.</T>
      ) : (
        <View style={{ gap: 8 }}>
          <Card padded={false}>
            {sorted.map((d) => (
              <ListRow key={d.id} title={d.label} subtitle={`${FIELD_TYPE_LABEL[d.type]}${d.type === 'choice' ? ` · ${d.options.join(', ')}` : ''}`} onPress={() => open(d)} chevron
                badge={d.required ? <Badge tone="warning">Required</Badge> : !d.active ? <Badge>Hidden</Badge> : undefined} />
            ))}
          </Card>
          <T v="caption" tone="mute">In an import file, give the column the same heading as the field and its values are filled in.</T>
        </View>
      )}
      <Sheet visible={!!edit} onClose={() => setEdit(null)} title={edit === 'new' ? 'New field' : 'Edit field'} full
        footer={<View style={{ flexDirection: 'row', gap: 10 }}>
          {edit && edit !== 'new' ? <DeskButton label="Delete" tone="danger" onPress={() => void remove(edit)} /> : null}
          <DeskButton label="Save" tone="primary" onPress={save} />
        </View>}>
        <View style={{ gap: 14, paddingBottom: 12 }}>
          <Field label="Name" value={label} onChangeText={setLabel} placeholder="e.g. Warranty months" />
          <Select<CustomFieldType> label="Kind of value" value={type} options={TYPES} onChange={setType} />
          {type === 'choice' ? <View><T v="label" tone="soft" style={{ marginBottom: 6 }}>Choices</T><TagInput value={options} onChange={setOptions} placeholder="Type a choice and press add" /></View> : null}
          <SwitchRow title="Required" subtitle="Items missing it are flagged" value={required} onChange={setRequired} />
          <SwitchRow title="Shown" subtitle="Hidden fields keep their values but are not asked for" value={active} onChange={setActive} />
        </View>
      </Sheet>
    </DesktopSettingsPage>
  )
}
