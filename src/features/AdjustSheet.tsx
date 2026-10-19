import React, { useEffect, useState } from 'react'
import { View } from 'react-native'
import { variantLabel } from '@/domain/codes'
import { fmtQty, fmtQtyUnit, isFrac, round3, unitName } from '@/domain/qty'
import type { VariantView } from '@/domain/views'
import { useIndustry } from '@/data/hooks'
import { adjustStock, OpError } from '@/data/ops'
import { perform } from '@/data/store'
import { Button } from '@/ui/Button'
import { Field, NumberField, Segmented, Select } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { T } from '@/ui/Text'
import { toast } from '@/ui/overlays'

type Mode = 'add' | 'remove' | 'set'

/** Correct what is on the shelf: add, remove, or set it to a counted figure — always with a reason, always in the ledger. */
export function AdjustSheet({ variant, onClose }: { variant: VariantView | null; onClose: () => void }) {
  const pack = useIndustry()
  const [mode, setMode] = useState<Mode>('remove')
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => { if (variant) { setMode('remove'); setQty(''); setReason(''); setNote('') } }, [variant?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!variant) return <Sheet visible={false} onClose={onClose} />
  const frac = isFrac(variant)
  const n = Number(qty)
  const delta = Number.isFinite(n) && qty !== '' ? round3(mode === 'add' ? n : mode === 'remove' ? -n : n - variant.stock) : 0
  const after = round3(variant.stock + delta)

  function apply() {
    if (qty === '' || !Number.isFinite(n)) { toast('Enter a quantity', 'err'); return }
    if (!reason) { toast('Choose a reason', 'err'); return }
    if (delta === 0) { toast('That is already the stock figure', 'info'); return }
    try {
      perform((s, ctx) => adjustStock(s, variant!.id, delta, 'adjust', 'MANUAL', [reason, note.trim()].filter(Boolean).join(' — '), ctx))
      toast(`${variant!.productName}: ${fmtQty(variant!.stock)} → ${fmtQty(after)}`, 'ok')
      onClose()
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not adjust stock', 'err') }
  }

  return (
    <Sheet visible onClose={onClose} title="Adjust stock" subtitle={`${variant.productName}${variantLabel(variant.size, variant.color) ? ` · ${variantLabel(variant.size, variant.color)}` : ''}`}
      footer={<Button label="Update stock" size="lg" block onPress={apply} />}>
      <View style={{ gap: 16, paddingBottom: 8 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <T tone="soft">On hand now</T>
          <T v="numLg">{fmtQtyUnit(variant.stock, variant)}</T>
        </View>
        <Segmented<Mode> value={mode} onChange={setMode} options={[{ value: 'remove', label: 'Remove' }, { value: 'add', label: 'Add' }, { value: 'set', label: 'Set to' }]} />
        <NumberField label={mode === 'set' ? 'New quantity' : `${unitName(variant)}${frac ? 's' : 's'} to ${mode}`} value={qty} onChange={setQty} decimals={frac} placeholder="0" large autoFocus
          hint={qty !== '' && delta !== 0 ? `${fmtQty(variant.stock)} → ${fmtQty(after)}` : undefined} error={after < 0 ? 'Stock cannot go below zero' : null} />
        <Select<string> label="Reason" value={reason} placeholder="Choose a reason" options={pack.stockReasons.map((r) => ({ value: r, label: r }))} onChange={setReason} />
        <Field label="Note (optional)" value={note} onChangeText={setNote} />
      </View>
    </Sheet>
  )
}
