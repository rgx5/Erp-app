import React, { useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { inr } from '@/domain/money'
import { OpError } from '@/data/ops'
import { perform, useCan } from '@/data/store'
import { batchesOf, locationOptions, REASON_LABEL, ruleFor, serialsInStock, stockAt, variantName, writeOffTotal } from '@/modules/warehouse/logic'
import { postWriteOff } from '@/modules/warehouse/ops'
import type { WriteOffReason } from '@/modules/warehouse/types'
import { ItemField, LocationSelect, useData } from '@/modules/warehouse/ui/common'
import { Button, IconButton } from '@/ui/Button'
import { Field, NumberField, Select } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Card, Chip } from '@/ui/primitives'
import { Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Trash } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

interface Line { key: string; variantId: string; qty: string; batchId: string; serial: string; locationId: string }
const REASONS = Object.keys(REASON_LABEL) as WriteOffReason[]

/** A write-off: what, how many, from which place / batch / serial, and why. The loss is posted to the books at cost. */
export default function NewWriteOff() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('warehouse')
  const data = useData()
  const [reason, setReason] = useState<WriteOffReason>('damage')
  const [lines, setLines] = useState<Line[]>([])
  const [adding, setAdding] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  if (!can) return <Screen title="Write-off" back><T tone="mute">Write-offs are for the owner and managers.</T></Screen>
  const hasPlaces = locationOptions(data).length > 1

  const patch = (key: string, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)))
  const add = (variantId: string) => { if (variantId) setLines((ls) => [...ls, { key: `${variantId}-${ls.length}-${Date.now()}`, variantId, qty: '1', batchId: '', serial: '', locationId: 'main' }]); setAdding('') }
  const costs = lines.map((l) => ({ qty: Number(l.qty) || 0, cost: data.variants[l.variantId]?.avgCost ?? data.variants[l.variantId]?.cost ?? 0 }))

  function post() {
    setBusy(true)
    try {
      const r = perform((s, ctx) => postWriteOff(s, { reason, notes, lines: lines.map((l) => ({ variantId: l.variantId, qty: Number(l.qty) || 0, ...(l.batchId ? { batchId: l.batchId } : {}), ...(l.serial ? { serial: l.serial } : {}), ...(l.locationId !== 'main' ? { locationId: l.locationId } : {}) })) }, ctx))
      toast(`${r.writeOff.no} posted`, 'ok')
      router.replace({ pathname: '/m/warehouse/writeoffs/[id]', params: { id: r.writeOff.id } })
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not post', 'err'); setBusy(false) }
  }

  return (
    <Screen title="New write-off" back footer={<Button label={`Write off · ${inr(writeOffTotal(costs), 0)}`} kind="danger" size="lg" block loading={busy} onPress={post} />}>
      <View style={{ gap: 14, paddingBottom: 14 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{REASONS.map((r) => <Chip key={r} label={REASON_LABEL[r]} selected={reason === r} onPress={() => setReason(r)} />)}</View>
        <Section title="Items">
          <View style={{ gap: 10 }}>
            {lines.map((l) => {
              const rule = ruleFor(data, l.variantId)
              const batches = rule?.trackBatch ? batchesOf(data, l.variantId).filter((b) => b.qty > 0) : []
              const serials = rule?.trackSerial ? serialsInStock(data, l.variantId) : []
              return (
                <Card key={l.key} style={{ gap: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={{ flex: 1 }}><T v="bodyStrong" numberOfLines={1}>{variantName(data, l.variantId)}</T><T v="caption" tone="mute">{stockAt(data, l.variantId, l.locationId)} on hand here</T></View>
                    <IconButton label="Remove" tone="ghost" size={36} onPress={() => setLines(lines.filter((x) => x.key !== l.key))}><Trash size={17} color={c.inkMute} /></IconButton>
                  </View>
                  <NumberField label="Quantity" value={l.qty} onChange={(t) => patch(l.key, { qty: t })} decimals />
                  {hasPlaces ? <LocationSelect label="From" value={l.locationId} onChange={(id) => patch(l.key, { locationId: id })} /> : null}
                  {batches.length ? <Select<string> label="Batch" value={l.batchId} placeholder="Not from a batch" options={[{ value: '', label: 'Not from a batch' }, ...batches.map((b) => ({ value: b.id, label: `${b.batchNo} · ${b.qty}` }))]} onChange={(v) => patch(l.key, { batchId: v })} /> : null}
                  {serials.length ? <Select<string> label="Serial number" value={l.serial} placeholder="Choose the unit" searchable options={serials.map((s) => ({ value: s.serial, label: s.serial }))} onChange={(v) => patch(l.key, { serial: v, qty: '1' })} /> : null}
                </Card>
              )
            })}
            <ItemField value={adding} onChange={add} placeholder="Add an item…" />
          </View>
        </Section>
        <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline />
      </View>
    </Screen>
  )
}
