import React, { useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useLabels } from '@/data/hooks'
import { OpError, saveCustomer } from '@/data/ops'
import { perform, useApp, useCan } from '@/data/store'
import { Button } from '@/ui/Button'
import { Field } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { toast } from '@/ui/overlays'

/** "19900315" → "1990-03-15" as the digits are typed. */
const dateMask = (t: string) => {
  const d = t.replace(/\D/g, '').slice(0, 8)
  return d.length > 6 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d.length > 4 ? `${d.slice(0, 4)}-${d.slice(4)}` : d
}

/** Empty is fine; otherwise it must be a real calendar date that is not in the future. */
function dateError(s: string): string | null {
  if (!s) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return 'Use year-month-day, e.g. 1990-03-15'
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d || y < 1900) return 'That date does not exist'
  if (dt.getTime() > Date.now()) return 'That date is in the future'
  return null
}

/** Add a customer, or edit one (`?id=`). Points and store credit are earned and spent at the counter, never typed here. */
export default function CustomerForm() {
  const router = useRouter()
  const labels = useLabels()
  const { id } = useLocalSearchParams<{ id?: string }>()
  const canEdit = useCan('customers')
  const existing = useApp((s) => (id ? s.data.customers[id] : undefined))
  const one = labels.customer.toLowerCase()

  const [phone, setPhone] = useState(existing?.phone ?? '')
  const [name, setName] = useState(existing?.name === 'Customer' ? '' : existing?.name ?? '')
  const [email, setEmail] = useState(existing?.email ?? '')
  const [dob, setDob] = useState(existing?.dob ?? '')
  const [anniversary, setAnniversary] = useState(existing?.anniversary ?? '')
  const [address, setAddress] = useState(existing?.address ?? '')
  const [gstin, setGstin] = useState(existing?.gstin ?? '')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)

  if (id && !existing) return <Screen title="Not found" back><T tone="mute">This {one} is no longer here.</T></Screen>
  if (!canEdit) return <Screen title={labels.customers} back><T tone="mute">Your role cannot add or change {labels.customers.toLowerCase()}.</T></Screen>

  const errors = {
    phone: phone.length !== 10 ? 'Enter the 10-digit mobile number' : null,
    email: email && !/^\S+@\S+\.\S+$/.test(email.trim()) ? 'That email address doesn’t look right' : null,
    dob: dateError(dob),
    anniversary: dateError(anniversary),
    gstin: gstin && !/^[0-9A-Z]{15}$/.test(gstin.toUpperCase()) ? 'GSTIN has 15 letters and digits' : null,
  }
  const ok = !Object.values(errors).some(Boolean)

  function save() {
    setTried(true)
    if (!ok) { toast('Fill the highlighted fields to continue', 'err'); return }
    setBusy(true)
    try {
      const r = perform((s, ctx) => saveCustomer(s, {
        name, phone, email: email.trim(), dob, anniversary, address: address.trim(), gstin: gstin.toUpperCase(), notes: notes.trim(),
      }, id, ctx))
      toast(existing ? 'Saved' : `${r.customer.name} added`, 'ok')
      if (existing) router.back()
      else router.replace({ pathname: '/customers/[id]', params: { id: r.customer.id } })
    } catch (e) {
      toast(e instanceof OpError ? e.message : 'Could not save', 'err')
      setBusy(false)
    }
  }

  return (
    <Screen title={existing ? `Edit ${one}` : `New ${one}`} back footer={<Button label={existing ? 'Save changes' : `Add ${one}`} size="lg" block loading={busy} onPress={save} />}>
      <View style={{ gap: 6, paddingBottom: 12 }}>
        <Section title="Contact" style={{ marginTop: 6 }}>
          <View style={{ gap: 14 }}>
            <Field label="Mobile number" value={phone} onChangeText={(t) => setPhone(t.replace(/\D/g, '').slice(0, 10))} keyboardType="number-pad" placeholder="10 digits" autoFocus={!existing}
              error={tried ? errors.phone : null} hint="Used to find them again at the counter" />
            <Field label="Name" value={name} onChangeText={setName} autoCapitalize="words" placeholder="Optional" />
            <Field label="Email (optional)" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} error={tried ? errors.email : null} />
          </View>
        </Section>

        <Section title="Special dates" style={{ marginTop: 14 }}>
          <View style={{ gap: 14 }}>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}><Field label="Birthday" value={dob} onChangeText={(t) => setDob(dateMask(t))} keyboardType="number-pad" placeholder="YYYY-MM-DD" mono error={tried ? errors.dob : null} /></View>
              <View style={{ flex: 1 }}><Field label="Anniversary" value={anniversary} onChangeText={(t) => setAnniversary(dateMask(t))} keyboardType="number-pad" placeholder="YYYY-MM-DD" mono error={tried ? errors.anniversary : null} /></View>
            </View>
            <T v="caption" tone="mute">Optional. They show up under “This month’s dates” so you can send wishes.</T>
          </View>
        </Section>

        <Section title="Billing details" style={{ marginTop: 14 }}>
          <View style={{ gap: 14 }}>
            <Field label="Address (optional)" value={address} onChangeText={setAddress} multiline autoCapitalize="sentences" />
            <Field label="GSTIN (optional)" value={gstin} onChangeText={(t) => setGstin(t.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 15))} autoCapitalize="characters" mono
              error={tried ? errors.gstin : null} hint="Printed on the tax invoice for business customers" />
            <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline autoCapitalize="sentences" />
          </View>
        </Section>
      </View>
    </Screen>
  )
}
