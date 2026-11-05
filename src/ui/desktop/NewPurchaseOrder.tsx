import React from 'react'
import { View } from 'react-native'
import { variantLabel } from '@/domain/codes'
import { inr } from '@/domain/money'
import type { Supplier } from '@/domain/types'
import type { VariantView } from '@/domain/views'
import { Button, IconButton } from '@/ui/Button'
import { Field, MoneyField, NumberField, Select } from '@/ui/Inputs'
import { Card } from '@/ui/primitives'
import { Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Plus, Trash, UserPlus } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { DeskButton } from './kit'
import { DesktopSettingsPage } from './SettingsPage'

interface Line { variantId: string; qty: string; cost: string }

export interface DesktopNewPurchaseOrderProps {
  editing: boolean
  no?: string
  suppliers: Supplier[]
  supplierId: string
  setSupplierId: (v: string) => void
  lines: Line[]
  setQty: (variantId: string, v: string) => void
  setCost: (variantId: string, v: string) => void
  onRemoveLine: (variantId: string) => void
  byId: Map<string, VariantView>
  expected: string
  setExpected: (v: string) => void
  dateOk: boolean
  notes: string
  setNotes: (v: string) => void
  total: number
  busy: boolean
  onAddItem: () => void
  onNewSupplier: () => void
  onSave: () => void
}

/**
 * The desktop "new purchase order" form: the same `Select`/`Field`/`Card` lines the phone screen builds
 * (`src/app/m/purchasing/orders/new.tsx`), centred in `DesktopSettingsPage`'s readable column instead of stretched
 * edge to edge. No order total, validation or save logic lives here — every value and handler is computed once on
 * the phone screen and passed down unchanged.
 */
export function DesktopNewPurchaseOrder({ editing, no, suppliers, supplierId, setSupplierId, lines, setQty, setCost, onRemoveLine, byId, expected, setExpected, dateOk, notes, setNotes, total, busy, onAddItem, onNewSupplier, onSave }: DesktopNewPurchaseOrderProps) {
  const { c } = useTheme()
  return (
    <DesktopSettingsPage
      title={editing ? `Edit ${no}` : 'New purchase order'}
      subtitle={lines.length ? `${lines.length} ${lines.length === 1 ? 'line' : 'lines'} · ${inr(total)}` : undefined}
      right={<DeskButton label={total > 0 ? `Save order · ${inr(total)}` : 'Save order'} tone="primary" disabled={busy} onPress={onSave} />}
      maxWidth={780}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Select<string> label="Supplier" value={supplierId} placeholder="Who is it for?" searchable
            options={suppliers.map((s) => ({ value: s.id, label: s.name, sub: s.phone || undefined })).sort((a, b) => a.label.localeCompare(b.label))} onChange={setSupplierId} />
        </View>
        <IconButton label="New supplier" tone="primary" size={50} onPress={onNewSupplier}><UserPlus size={20} color={c.primary} /></IconButton>
      </View>

      <Section title="Items" style={{ marginTop: 18 }}>
        <View style={{ gap: 10 }}>
          {lines.map((l) => {
            const v = byId.get(l.variantId)
            if (!v) return null
            return (
              <Card key={l.variantId} style={{ gap: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <T v="bodyStrong" numberOfLines={1}>{v.productName}</T>
                    <T v="caption" tone="mute" numberOfLines={1}>{[variantLabel(v.size, v.color), v.sku].filter(Boolean).join(' · ')} · {v.stock} in stock</T>
                  </View>
                  <IconButton label="Remove" tone="ghost" size={36} onPress={() => onRemoveLine(l.variantId)}><Trash size={18} color={c.inkMute} /></IconButton>
                </View>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <View style={{ flex: 1 }}><NumberField label="Quantity" value={l.qty} onChange={(t) => setQty(l.variantId, t)} decimals={!!v.fractional} /></View>
                  <View style={{ flex: 1 }}><MoneyField label="Cost each" value={l.cost} onChange={(t) => setCost(l.variantId, t)} /></View>
                </View>
              </Card>
            )
          })}
          <Button label="Add item" kind="soft" block icon={<Plus size={18} color={c.primary} />} onPress={onAddItem} />
        </View>
      </Section>

      <Section title="Details" style={{ marginTop: 18 }}>
        <View style={{ gap: 14 }}>
          <Field label="Expected by (optional)" value={expected} onChangeText={setExpected} placeholder="YYYY-MM-DD" error={dateOk ? null : 'Write the date as YYYY-MM-DD'} />
          <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline />
        </View>
      </Section>
    </DesktopSettingsPage>
  )
}
