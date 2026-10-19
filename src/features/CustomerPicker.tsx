import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { inr0 } from '@/domain/money'
import { filterCustomers } from '@/domain/stock'
import type { Customer } from '@/domain/types'
import { useLabels, useList } from '@/data/hooks'
import { OpError, saveCustomer } from '@/data/ops'
import { perform } from '@/data/store'
import { Button } from '@/ui/Button'
import { Field, SearchBar } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { Avatar, Badge, Tap } from '@/ui/primitives'
import { EmptyState } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Plus, UserPlus, Users } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

/** Find a customer by mobile or name — or add one on the spot, which is what happens most at a busy counter. */
export function CustomerPicker({ visible, onClose, onPick, selectedId }: { visible: boolean; onClose: () => void; onPick: (c: Customer | null) => void; selectedId?: string | null }) {
  const { c } = useTheme()
  const labels = useLabels()
  const customers = useList('customers')
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')

  const results = useMemo(() => (q.trim() ? filterCustomers(customers, q, '').slice(0, 30) : [...customers].sort((a, b) => b.createdAt - a.createdAt).slice(0, 12)), [customers, q])
  const digits = q.replace(/\D/g, '')

  function close() { setQ(''); setAdding(false); setName(''); setPhone(''); onClose() }

  function startAdd() { setPhone(digits.length >= 6 ? digits.slice(0, 10) : ''); setName(digits.length >= 6 ? '' : q.trim()); setAdding(true) }

  function create() {
    try {
      const r = perform((s, ctx) => saveCustomer(s, { name, phone, email: '', dob: '', anniversary: '', address: '', gstin: '', notes: '' }, undefined, ctx))
      toast(`${r.customer.name} added`, 'ok')
      onPick(r.customer)
      close()
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not add', 'err') }
  }

  return (
    <Sheet visible={visible} onClose={close} title={adding ? `New ${labels.customer.toLowerCase()}` : labels.customer} full={!adding}
      footer={adding ? <Button label={`Add ${labels.customer.toLowerCase()}`} size="lg" block onPress={create} /> : undefined}>
      {adding ? (
        <View style={{ gap: 14, paddingBottom: 8 }}>
          <Field label="Mobile number" value={phone} onChangeText={(t) => setPhone(t.replace(/\D/g, '').slice(0, 10))} keyboardType="number-pad" placeholder="10 digits" autoFocus />
          <Field label="Name (optional)" value={name} onChangeText={setName} autoCapitalize="words" />
        </View>
      ) : (
        <View style={{ gap: 12 }}>
          <SearchBar value={q} onChange={setQ} placeholder="Search mobile number or name" autoFocus />
          {selectedId ? <Button label={`Remove ${labels.customer.toLowerCase()} from this bill`} kind="outline" size="sm" onPress={() => { onPick(null); close() }} /> : null}
          {q.trim() && !results.length ? (
            <EmptyState compact icon={<Users size={24} color={c.primary} />} title="No match" hint={digits.length >= 6 ? `Add ${digits} as a new ${labels.customer.toLowerCase()}.` : 'Try a mobile number.'} />
          ) : null}
          {results.map((r) => (
            <Tap key={r.id} onPress={() => { onPick(r); close() }} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }}>
              <Avatar name={r.name} size={42} />
              <View style={{ flex: 1 }}>
                <T v="bodyStrong" numberOfLines={1}>{r.name}</T>
                <T v="caption" tone="mute">{r.phone}</T>
              </View>
              {r.loyaltyPoints > 0 ? <Badge tone="primary">{r.loyaltyPoints} pts</Badge> : null}
              {r.storeCredit > 0 ? <Badge tone="success">{inr0(r.storeCredit)}</Badge> : null}
            </Tap>
          ))}
          <Button label={q.trim() ? `Add “${q.trim()}” as new` : `Add new ${labels.customer.toLowerCase()}`} kind="soft" icon={q.trim() ? <UserPlus size={18} color={c.primary} /> : <Plus size={18} color={c.primary} />} block onPress={startAdd} />
        </View>
      )}
    </Sheet>
  )
}
