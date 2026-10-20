import React, { useEffect, useState } from 'react'
import { View } from 'react-native'
import type { Location, LocationType } from '../types'
import { Button } from '@/ui/Button'
import { Field, Segmented } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { LocationSelect } from './common'

/** Name, kind and where it sits inside another location. */
export function LocationSheet({ visible, onClose, onSave, existing }: { visible: boolean; onClose: () => void; onSave: (d: { name: string; type: LocationType; parentId?: string }) => void; existing?: Location }) {
  const [name, setName] = useState('')
  const [type, setType] = useState<LocationType>('warehouse')
  const [parent, setParent] = useState('main')
  useEffect(() => {
    if (visible) { setName(existing?.name ?? ''); setType(existing?.type ?? 'warehouse'); setParent(existing?.parentId ?? 'main') }
  }, [visible, existing])
  return (
    <Sheet visible={visible} onClose={onClose} title={existing ? 'Edit location' : 'New location'} footer={<Button label="Save" size="lg" block onPress={() => onSave({ name, type, ...(parent !== 'main' ? { parentId: parent } : {}) })} />}>
      <View style={{ gap: 14, paddingBottom: 8 }}>
        <Field label="Name" value={name} onChangeText={setName} placeholder="Back godown, Shelf A2…" />
        <Segmented<LocationType> value={type} onChange={setType} options={[{ value: 'warehouse', label: 'Godown' }, { value: 'shelf', label: 'Shelf' }, { value: 'counter', label: 'Counter' }]} />
        <LocationSelect label="Inside (optional)" value={parent} onChange={setParent} exclude={existing?.id} hint="Pick a godown to put a shelf inside it" />
      </View>
    </Sheet>
  )
}
