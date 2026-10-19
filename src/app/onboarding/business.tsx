import React, { useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { industryById } from '@/industries'
import { createLocalBusiness } from '@/data/auth'
import { isValidPin } from '@/data/pin'
import { Button } from '@/ui/Button'
import { Field, NumberField } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { T } from '@/ui/Text'
import { toast } from '@/ui/overlays'

/** Details for a brand-new business that lives on this phone. Everything else can be changed later in Settings. */
export default function BusinessSetup() {
  const { industry } = useLocalSearchParams<{ industry?: string }>()
  const pack = industryById(industry)
  const router = useRouter()
  const [name, setName] = useState('')
  const [owner, setOwner] = useState('')
  const [city, setCity] = useState('')
  const [gstin, setGstin] = useState('')
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [busy, setBusy] = useState(false)
  const [tried, setTried] = useState(false)

  const gstinBad = gstin.trim() !== '' && !/^[0-9A-Z]{15}$/.test(gstin.trim().toUpperCase())
  const errors = {
    name: !name.trim() ? 'Enter your business name' : null,
    owner: !owner.trim() ? 'Enter the owner’s name' : null,
    pin: !isValidPin(pin) ? 'A PIN is exactly 4 digits' : null,
    pin2: pin2 !== pin ? 'The PINs do not match' : null,
    gstin: gstinBad ? 'GSTIN is 15 letters and digits' : null,
  }
  const ok = !Object.values(errors).some(Boolean)

  async function create() {
    setTried(true)
    if (!ok) return
    setBusy(true)
    try {
      await createLocalBusiness({ packId: pack.id, name, ownerName: owner, city, gstin, pin })
      toast(`${name.trim()} is ready`, 'ok')
      router.replace('/')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not create the business', 'err')
      setBusy(false)
    }
  }

  return (
    <Screen title="Your business" subtitle={pack.name} back footer={<Button label="Create business" size="lg" block loading={busy} onPress={create} />}>
      <View style={{ gap: 16, marginTop: 8 }}>
        <Field label="Business name" value={name} onChangeText={setName} placeholder="e.g. Sharma Fresh Mart" error={tried ? errors.name : null} autoCapitalize="words" />
        <Field label="Your name" value={owner} onChangeText={setOwner} placeholder="The owner" error={tried ? errors.owner : null} autoCapitalize="words" />
        <Field label="City (optional)" value={city} onChangeText={setCity} autoCapitalize="words" />
        <Field label="GSTIN (optional)" value={gstin} onChangeText={(t) => setGstin(t.toUpperCase())} placeholder="Printed on tax invoices" error={tried ? errors.gstin : null} autoCapitalize="characters" maxLength={15} />
        <View style={{ gap: 6, marginTop: 6 }}>
          <T v="h2">Owner PIN</T>
          <T tone="mute" v="caption">You’ll use this 4-digit PIN to switch users on this phone.</T>
        </View>
        <NumberField label="PIN" value={pin} onChange={(v) => setPin(v.slice(0, 4))} secureTextEntry maxLength={4} error={tried ? errors.pin : null} />
        <NumberField label="Repeat PIN" value={pin2} onChange={(v) => setPin2(v.slice(0, 4))} secureTextEntry maxLength={4} error={tried ? errors.pin2 : null} />
      </View>
    </Screen>
  )
}
