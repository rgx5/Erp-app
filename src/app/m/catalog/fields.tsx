import React, { useState } from 'react'
import { View } from 'react-native'
import { useList } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { perform, useCan } from '@/data/store'
import { activeFields, FIELD_TYPE_LABEL } from '@/modules/catalog/fields'
import { deleteCustomField, saveCustomField } from '@/modules/catalog/ops'
import type { CustomFieldDef, CustomFieldType } from '@/modules/catalog/types'
import { NoAccess } from '@/modules/catalog/ui/common'
import { Button, IconButton } from '@/ui/Button'
import { Field, Select, SwitchRow } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Badge, Card } from '@/ui/primitives'
import { EmptyState, ListRow } from '@/ui/blocks'
import { TagInput } from '@/ui/TagInput'
import { T } from '@/ui/Text'
import { Plus, Sliders } from '@/ui/icons'
import { ask, toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

const TYPES = (Object.keys(FIELD_TYPE_LABEL) as CustomFieldType[]).map((t) => ({ value: t, label: FIELD_TYPE_LABEL[t] }))

/** The extra fields this business keeps on its items. */
export default function CustomFields() {
  const { c } = useTheme()
  const can = useCan('inventory')
  const defs = useList('customFields')
  const [edit, setEdit] = useState<CustomFieldDef | 'new' | null>(null)
  const [label, setLabel] = useState('')
  const [type, setType] = useState<CustomFieldType>('text')
  const [options, setOptions] = useState<string[]>([])
  const [required, setRequired] = useState(false)
  const [active, setActive] = useState(true)

  if (!can) return <NoAccess title="Custom fields" who="the owner and managers" />

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
    <Screen title="Custom fields" subtitle="Extra details on every item" back right={<IconButton label="New field" tone="dark" onPress={() => open('new')}><Plus size={22} color={c.bg} /></IconButton>}>
      {!defs.length ? (
        <EmptyState icon={<Sliders size={26} color={c.primary} />} title="No custom fields yet" hint="Warranty months, shelf, country of origin, fabric care — add what your items need, then fill it in on each item or in an import file." action="Add a field" onAction={() => open('new')} />
      ) : (
        <View style={{ paddingBottom: 24, gap: 8 }}>
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
          {edit && edit !== 'new' ? <Button label="Delete" kind="danger" onPress={() => void remove(edit)} /> : null}
          <View style={{ flex: 1 }}><Button label="Save" block onPress={save} /></View>
        </View>}>
        <View style={{ gap: 14, paddingBottom: 12 }}>
          <Field label="Name" value={label} onChangeText={setLabel} placeholder="e.g. Warranty months" />
          <Select<CustomFieldType> label="Kind of value" value={type} options={TYPES} onChange={setType} />
          {type === 'choice' ? <View><T v="label" tone="soft" style={{ marginBottom: 6 }}>Choices</T><TagInput value={options} onChange={setOptions} placeholder="Type a choice and press add" /></View> : null}
          <SwitchRow title="Required" subtitle="Items missing it are flagged" value={required} onChange={setRequired} />
          <SwitchRow title="Shown" subtitle="Hidden fields keep their values but are not asked for" value={active} onChange={setActive} />
        </View>
      </Sheet>
    </Screen>
  )
}
