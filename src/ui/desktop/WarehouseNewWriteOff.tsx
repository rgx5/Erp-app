import React from 'react'
import { ScrollView, View } from 'react-native'
import { inr } from '@/domain/money'
import type { DataState } from '@/data/state'
import { batchesOf, REASON_LABEL, ruleFor, serialsInStock, stockAt, variantName } from '@/modules/warehouse/logic'
import type { WriteOffReason } from '@/modules/warehouse/types'
import { ItemField, LocationSelect } from '@/modules/warehouse/ui/common'
import { IconButton } from '@/ui/Button'
import { Field, NumberField, Select } from '@/ui/Inputs'
import { Card, Chip } from '@/ui/primitives'
import { Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Trash } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { DeskButton, DeskPage, Toolbar } from './kit'

interface Line { key: string; variantId: string; qty: string; batchId: string; serial: string; locationId: string }

export interface DesktopNewWriteOffProps {
  data: DataState
  reason: WriteOffReason
  setReason: (r: WriteOffReason) => void
  lines: Line[]
  patch: (key: string, p: Partial<Line>) => void
  onRemoveLine: (key: string) => void
  adding: string
  setAdding: (v: string) => void
  onAdd: (variantId: string) => void
  hasPlaces: boolean
  notes: string
  setNotes: (v: string) => void
  total: number
  busy: boolean
  onPost: () => void
}

const REASONS = Object.keys(REASON_LABEL) as WriteOffReason[]

/**
 * The desktop "New write-off" screen: a `DeskPage`/`Toolbar` shell around the exact form
 * `src/app/m/warehouse/writeoffs/new.tsx` builds, centred in a readable column — the same treatment
 * `DesktopNewPurchase` gives the purchase-receipt form. No pricing or stock logic lives here; every field and
 * handler is passed down from the phone screen unchanged.
 */
export function DesktopNewWriteOff({ data, reason, setReason, lines, patch, onRemoveLine, adding, setAdding, onAdd, hasPlaces, notes, setNotes, total, busy, onPost }: DesktopNewWriteOffProps) {
  const { c } = useTheme()

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title="New write-off"
          subtitle={lines.length ? `${lines.length} ${lines.length === 1 ? 'line' : 'lines'} · ${inr(total, 0)}` : 'Damage, expiry, samples or loss'}
          right={<DeskButton label={busy ? 'Posting…' : `Write off · ${inr(total, 0)}`} tone="danger" disabled={busy} onPress={onPost} />}
        />
      }
    >
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ alignItems: 'center', padding: 28 }}>
        <View style={{ width: '100%', maxWidth: 680, gap: 10 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {REASONS.map((r) => <Chip key={r} label={REASON_LABEL[r]} selected={reason === r} onPress={() => setReason(r)} />)}
          </View>

          <Section title="Items" style={{ marginTop: 10 }}>
            <View style={{ gap: 10 }}>
              {lines.map((l) => {
                const rule = ruleFor(data, l.variantId)
                const batches = rule?.trackBatch ? batchesOf(data, l.variantId).filter((b) => b.qty > 0) : []
                const serials = rule?.trackSerial ? serialsInStock(data, l.variantId) : []
                return (
                  <Card key={l.key} style={{ gap: 10 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View style={{ flex: 1 }}>
                        <T v="bodyStrong" numberOfLines={1}>{variantName(data, l.variantId)}</T>
                        <T v="caption" tone="mute">{stockAt(data, l.variantId, l.locationId)} on hand here</T>
                      </View>
                      <IconButton label="Remove" tone="ghost" size={36} onPress={() => onRemoveLine(l.key)}><Trash size={17} color={c.inkMute} /></IconButton>
                    </View>
                    <NumberField label="Quantity" value={l.qty} onChange={(t) => patch(l.key, { qty: t })} decimals />
                    {hasPlaces ? <LocationSelect label="From" value={l.locationId} onChange={(id) => patch(l.key, { locationId: id })} /> : null}
                    {batches.length ? <Select<string> label="Batch" value={l.batchId} placeholder="Not from a batch" options={[{ value: '', label: 'Not from a batch' }, ...batches.map((b) => ({ value: b.id, label: `${b.batchNo} · ${b.qty}` }))]} onChange={(v) => patch(l.key, { batchId: v })} /> : null}
                    {serials.length ? <Select<string> label="Serial number" value={l.serial} placeholder="Choose the unit" searchable options={serials.map((s) => ({ value: s.serial, label: s.serial }))} onChange={(v) => patch(l.key, { serial: v, qty: '1' })} /> : null}
                  </Card>
                )
              })}
              <ItemField value={adding} onChange={onAdd} placeholder="Add an item…" />
            </View>
          </Section>

          <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline />
        </View>
      </ScrollView>
    </DeskPage>
  )
}
