import React from 'react'
import { ScrollView, View } from 'react-native'
import type { DataState } from '@/data/state'
import { stockAt, variantName } from '@/modules/warehouse/logic'
import { ItemField, LocationSelect } from '@/modules/warehouse/ui/common'
import { IconButton } from '@/ui/Button'
import { Field, NumberField } from '@/ui/Inputs'
import { Card } from '@/ui/primitives'
import { Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Plus, Trash } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { DeskButton, DeskPage, Toolbar } from './kit'

interface Line { variantId: string; qty: string }

export interface DesktopNewTransferProps {
  data: DataState
  fromId: string
  setFrom: (v: string) => void
  toId: string
  setTo: (v: string) => void
  lines: Line[]
  patch: (variantId: string, qty: string) => void
  onRemoveLine: (variantId: string) => void
  adding: string
  setAdding: (v: string) => void
  onAdd: (variantId: string) => void
  notes: string
  setNotes: (v: string) => void
  busy: boolean
  onSend: () => void
}

/**
 * The desktop "New transfer" screen: a `DeskPage`/`Toolbar` shell around the exact form
 * `src/app/m/warehouse/transfers/new.tsx` builds, centred in a readable column instead of stretched edge-to-edge —
 * the same treatment `DesktopNewPurchase` gives the purchase-receipt form. No stock or transfer logic lives here;
 * every field and handler is passed down from the phone screen unchanged.
 */
export function DesktopNewTransfer({ data, fromId, setFrom, toId, setTo, lines, patch, onRemoveLine, adding, setAdding, onAdd, notes, setNotes, busy, onSend }: DesktopNewTransferProps) {
  const { c } = useTheme()

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title="New transfer"
          subtitle={lines.length ? `${lines.length} ${lines.length === 1 ? 'line' : 'lines'}` : 'Send stock between places'}
          right={<DeskButton label={busy ? 'Sending…' : 'Send stock'} tone="primary" disabled={busy} onPress={onSend} />}
        />
      }
    >
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ alignItems: 'center', padding: 28 }}>
        <View style={{ width: '100%', maxWidth: 680, gap: 6 }}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}><LocationSelect label="From" value={fromId} onChange={setFrom} /></View>
            <View style={{ flex: 1 }}><LocationSelect label="To" value={toId} onChange={setTo} exclude={fromId} /></View>
          </View>

          <Section title="Items" style={{ marginTop: 18 }}>
            <View style={{ gap: 10 }}>
              {lines.map((l) => (
                <Card key={l.variantId} style={{ gap: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <T v="bodyStrong" numberOfLines={1}>{variantName(data, l.variantId)}</T>
                      <T v="caption" tone="mute">{stockAt(data, l.variantId, fromId)} at the sender</T>
                    </View>
                    <IconButton label="Remove" tone="ghost" size={36} onPress={() => onRemoveLine(l.variantId)}><Trash size={17} color={c.inkMute} /></IconButton>
                  </View>
                  <NumberField label="Quantity" value={l.qty} onChange={(t) => patch(l.variantId, t)} decimals />
                </Card>
              ))}
              <ItemField value={adding} onChange={onAdd} placeholder="Add an item…" />
              {!lines.length ? <T v="caption" tone="mute"><Plus size={12} color={c.inkMute} /> Add the items you are sending.</T> : null}
            </View>
          </Section>

          <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline />
        </View>
      </ScrollView>
    </DeskPage>
  )
}
