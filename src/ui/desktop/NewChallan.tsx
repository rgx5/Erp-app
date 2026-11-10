import React from 'react'
import { ScrollView, View } from 'react-native'
import type { ChallanLine, SalesOrder } from '@/modules/sales-docs/types'
import { CustomerRow } from '@/modules/sales-docs/ui/forms'
import { Field, NumberField } from '@/ui/Inputs'
import { Card } from '@/ui/primitives'
import { Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Plus, Trash } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { DeskButton, DeskPage, Toolbar } from './kit'

interface Row { line: ChallanLine; qty: string }

export interface DesktopNewChallanProps {
  title: string
  order: SalesOrder | undefined
  customerId: string | null
  setCustomerId: (v: string | null) => void
  name: string
  setName: (v: string) => void
  phone: string
  setPhone: (v: string) => void
  address: string
  setAddress: (v: string) => void
  rows: Row[]
  setRows: (v: Row[]) => void
  linked: string | undefined
  vehicle: string
  setVehicle: (v: string) => void
  driver: string
  setDriver: (v: string) => void
  tracking: string
  setTracking: (v: string) => void
  notes: string
  setNotes: (v: string) => void
  busy: boolean
  onAddItem: () => void
  onSave: () => void
}

/**
 * The desktop "New challan" screen: a `DeskPage`/`Toolbar` shell around the exact form
 * `src/app/m/sales-docs/challans/new.tsx` builds, centred in a readable column, with line items kept as editable
 * mobile `Card`s (same as `DesktopNewPurchase`) rather than forced into a `DataTable`.
 */
export function DesktopNewChallan(p: DesktopNewChallanProps) {
  const { c } = useTheme()
  return (
    <DeskPage
      toolbar={<Toolbar title={p.title} subtitle={p.order ? `Against ${p.order.no}` : undefined} right={<DeskButton label={p.busy ? 'Saving…' : 'Save challan'} tone="primary" disabled={p.busy} onPress={p.onSave} />} />}
    >
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ alignItems: 'center', padding: 28 }}>
        <View style={{ width: '100%', maxWidth: 780, gap: 6 }}>
          <CustomerRow customerId={p.customerId} onChange={p.setCustomerId} label="Deliver to" optional={!p.linked} />
          {!p.customerId ? (
            <View style={{ gap: 12, marginTop: 10 }}>
              <Field label="Name" value={p.name} onChangeText={p.setName} />
              <Field label="Phone (optional)" value={p.phone} onChangeText={p.setPhone} keyboardType="phone-pad" />
            </View>
          ) : null}
          <View style={{ marginTop: 12 }}><Field label="Delivery address" value={p.address} onChangeText={p.setAddress} multiline placeholder="Leave blank to use the customer’s address" /></View>

          <Section title="Items" style={{ marginTop: 18 }}>
            <View style={{ gap: 10 }}>
              {p.rows.map(({ line: l, qty }) => (
                <Card key={l.variantId ?? l.sku} style={{ gap: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <T v="bodyStrong" numberOfLines={1}>{l.name}</T>
                      <T v="caption" tone="mute" numberOfLines={1}>{l.sku}</T>
                    </View>
                    <DeskButton label="Remove" icon={<Trash size={14} color={c.inkMute} />} onPress={() => p.setRows(p.rows.filter((r) => r.line !== l))} />
                  </View>
                  <NumberField label={`Quantity${l.unit && l.unit !== 'pc' ? ` (${l.unit})` : ''}`} value={qty} decimals={!!l.unit && l.unit !== 'pc'} onChange={(t) => p.setRows(p.rows.map((r) => (r.line === l ? { ...r, qty: t } : r)))} />
                </Card>
              ))}
              {p.rows.length === 0 ? <T tone="mute">{p.order ? 'Everything on this order has already been sent.' : 'Add the items going out.'}</T> : null}
              {!p.linked ? <DeskButton label="Add item" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={p.onAddItem} /> : null}
              {p.order && p.rows.length ? <T v="caption" tone="mute">Quantities are capped at what is still to send on {p.order.no}.</T> : null}
            </View>
          </Section>

          <Section title="Transport" style={{ marginTop: 18 }}>
            <View style={{ gap: 14 }}>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ flex: 1 }}><Field label="Vehicle" value={p.vehicle} onChangeText={p.setVehicle} autoCapitalize="characters" /></View>
                <View style={{ flex: 1 }}><Field label="Driver" value={p.driver} onChangeText={p.setDriver} /></View>
              </View>
              <Field label="Tracking / LR number" value={p.tracking} onChangeText={p.setTracking} autoCapitalize="characters" />
              <Field label="Notes (optional)" value={p.notes} onChangeText={p.setNotes} multiline />
            </View>
          </Section>
        </View>
      </ScrollView>
    </DeskPage>
  )
}
