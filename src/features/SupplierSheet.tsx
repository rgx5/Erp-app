import React, { useEffect, useState } from 'react'
import { View } from 'react-native'
import type { Supplier } from '@/domain/types'
import { OpError, saveSupplier } from '@/data/ops'
import { perform } from '@/data/store'
import { Button } from '@/ui/Button'
import { Field, MoneyField } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { toast } from '@/ui/overlays'

/** Add a supplier, or edit one. `onSaved` hands back the saved supplier (the goods-receipt form selects it straight away). */
export function SupplierSheet({ visible, onClose, supplier, onSaved }: { visible: boolean; onClose: () => void; supplier?: Supplier | null; onSaved?: (s: Supplier) => void }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [gstin, setGstin] = useState('')
  const [address, setAddress] = useState('')
  const [opening, setOpening] = useState('')

  useEffect(() => {
    if (!visible) return
    setName(supplier?.name ?? ''); setPhone(supplier?.phone ?? ''); setGstin(supplier?.gstin ?? ''); setAddress(supplier?.address ?? '')
    setOpening(supplier?.openingBalance ? String(supplier.openingBalance) : '')
  }, [visible, supplier?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  function save() {
    try {
      const r = perform((s, ctx) => saveSupplier(s, { name, phone: phone.replace(/\D/g, ''), gstin: gstin.trim(), address: address.trim(), openingBalance: Number(opening) || 0 }, supplier?.id, ctx))
      toast(supplier ? 'Supplier updated' : `${r.supplier.name} added`, 'ok')
      onSaved?.(r.supplier)
      onClose()
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not save', 'err') }
  }

  return (
    <Sheet visible={visible} onClose={onClose} title={supplier ? 'Edit supplier' : 'New supplier'} footer={<Button label={supplier ? 'Save changes' : 'Add supplier'} size="lg" block onPress={save} />}>
      <View style={{ gap: 14, paddingBottom: 10 }}>
        <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. Mehta Textiles" autoCapitalize="words" autoFocus={!supplier} />
        <Field label="Phone (optional)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={14} />
        <Field label="GSTIN (optional)" value={gstin} onChangeText={(t) => setGstin(t.toUpperCase())} autoCapitalize="characters" mono maxLength={15} placeholder="15 characters" />
        <Field label="Address (optional)" value={address} onChangeText={setAddress} multiline />
        <MoneyField label="Owed to them at the start" value={opening} onChange={setOpening} hint="What you already owed this supplier when you began using the app" />
      </View>
    </Sheet>
  )
}
