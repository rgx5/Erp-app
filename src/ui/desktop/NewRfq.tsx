import React from 'react'
import { View } from 'react-native'
import type { Supplier } from '@/domain/types'
import type { VariantView } from '@/domain/views'
import { Button, IconButton } from '@/ui/Button'
import { Field, NumberField } from '@/ui/Inputs'
import { Card, Chip } from '@/ui/primitives'
import { Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Plus, Trash } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { DeskButton } from './kit'
import { DesktopSettingsPage } from './SettingsPage'

interface Line { variantId: string; qty: string }

export interface DesktopNewRfqProps {
  title: string
  setTitle: (v: string) => void
  lines: Line[]
  setQty: (variantId: string, v: string) => void
  onRemoveLine: (variantId: string) => void
  byId: Map<string, VariantView>
  suppliers: Supplier[]
  ids: string[]
  toggleSupplier: (id: string) => void
  closes: string
  setCloses: (v: string) => void
  closesOk: boolean
  notes: string
  setNotes: (v: string) => void
  busy: boolean
  onAddItem: () => void
  onSave: () => void
}

/**
 * The desktop "new request for quotation" form: the same item-and-supplier picking the phone screen builds
 * (`src/app/m/purchasing/rfq/new.tsx`), centred in `DesktopSettingsPage`'s readable column. No request creation
 * logic lives here — every value and handler is computed once on the phone screen and passed down unchanged.
 */
export function DesktopNewRfq({ title, setTitle, lines, setQty, onRemoveLine, byId, suppliers, ids, toggleSupplier, closes, setCloses, closesOk, notes, setNotes, busy, onSave, onAddItem }: DesktopNewRfqProps) {
  const { c } = useTheme()
  return (
    <DesktopSettingsPage title="New request" right={<DeskButton label="Create request" tone="primary" disabled={busy} onPress={onSave} />}>
      <Field label="Name" value={title} onChangeText={setTitle} placeholder="Festival stock, monsoon restock…" />
      <Section title="Items wanted" style={{ marginTop: 18 }}>
        <View style={{ gap: 10 }}>
          {lines.map((l) => (
            <Card key={l.variantId} style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
              <View style={{ flex: 1 }}><T v="bodyStrong" numberOfLines={1}>{byId.get(l.variantId)?.productName ?? 'Item'}</T></View>
              <View style={{ width: 90 }}><NumberField label="Qty" value={l.qty} onChange={(t) => setQty(l.variantId, t)} decimals /></View>
              <IconButton label="Remove" tone="ghost" size={36} onPress={() => onRemoveLine(l.variantId)}><Trash size={18} color={c.inkMute} /></IconButton>
            </Card>
          ))}
          <Button label="Add item" kind="soft" block icon={<Plus size={18} color={c.primary} />} onPress={onAddItem} />
        </View>
      </Section>
      <Section title="Ask these suppliers" style={{ marginTop: 18 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {suppliers.map((s) => <Chip key={s.id} label={s.name} selected={ids.includes(s.id)} onPress={() => toggleSupplier(s.id)} />)}
        </View>
      </Section>
      <View style={{ marginTop: 18, gap: 14 }}>
        <Field label="Reply by (optional)" value={closes} onChangeText={setCloses} placeholder="YYYY-MM-DD" error={closesOk ? null : 'YYYY-MM-DD'} />
        <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline />
      </View>
    </DesktopSettingsPage>
  )
}
