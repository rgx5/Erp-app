import React, { useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { useIndustry, useStore } from '@/data/hooks'
import { useApp } from '@/data/store'
import { saveSettings, SettingsLocked, useCanSettings } from '@/features/settingsKit'
import { Button } from '@/ui/Button'
import { Field, NumberField } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Notice, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { goBack } from '@/ui/nav'

const GSTIN_RE = /^[0-9A-Z]{15}$/

/** Name, address and GSTIN — what prints at the top of every receipt and tax invoice. */
export default function StoreSettingsScreen() {
  const router = useRouter()
  const allowed = useCanSettings()
  const store = useStore()
  const pack = useIndustry()
  const connected = useApp((s) => s.workspace?.mode === 'remote')

  const [name, setName] = useState(store.name)
  const [tagline, setTagline] = useState(store.tagline)
  const [address, setAddress] = useState(store.address)
  const [city, setCity] = useState(store.city)
  const [phone, setPhone] = useState(store.phone)
  const [email, setEmail] = useState(store.email)
  const [gstin, setGstin] = useState(store.gstin)
  const [prefix, setPrefix] = useState(store.invoicePrefix)
  const [nextNo, setNextNo] = useState(String(store.nextInvoiceNo))
  const [tried, setTried] = useState(false)

  if (!allowed) return <SettingsLocked title="Business profile" />

  const errors = {
    name: !name.trim() ? 'The business needs a name' : null,
    gstin: gstin.trim() && !GSTIN_RE.test(gstin.trim().toUpperCase()) ? 'A GSTIN is 15 letters and digits' : null,
    email: email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim()) ? 'That email does not look right' : null,
    prefix: prefix.trim() && !/^[A-Za-z0-9-]{1,10}$/.test(prefix.trim()) ? 'Up to 10 letters, digits or dashes' : null,
    next: !connected && (!nextNo || Number(nextNo) < 1) ? 'Must be 1 or more' : null,
  }
  const dirty = name !== store.name || tagline !== store.tagline || address !== store.address || city !== store.city || phone !== store.phone || email !== store.email
    || gstin !== store.gstin || prefix !== store.invoicePrefix || (!connected && Number(nextNo) !== store.nextInvoiceNo)

  function save() {
    setTried(true)
    if (Object.values(errors).some(Boolean)) return
    const ok = saveSettings({
      name: name.trim(), tagline: tagline.trim(), address: address.trim(), city: city.trim(), phone: phone.trim(), email: email.trim(),
      gstin: gstin.trim().toUpperCase(), invoicePrefix: prefix.trim(), ...(connected ? {} : { nextInvoiceNo: Number(nextNo) }),
    })
    if (ok) goBack(router)
  }

  return (
    <Screen title="Business profile" back footer={<Button label="Save changes" size="lg" block disabled={!dirty} onPress={save} />}>
      <View style={{ paddingBottom: 12 }}>
        <Section title="Shown on receipts" style={{ marginTop: 6 }}>
          <View style={{ gap: 14 }}>
            <Field label="Business name" value={name} onChangeText={setName} autoCapitalize="words" error={tried ? errors.name : null} />
            <Field label="Tagline (optional)" value={tagline} onChangeText={setTagline} placeholder={pack.demo.tagline} />
            <Field label="Address" value={address} onChangeText={setAddress} multiline />
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}><Field label="City" value={city} onChangeText={setCity} autoCapitalize="words" /></View>
              <View style={{ flex: 1 }}><Field label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" /></View>
            </View>
            <Field label="Email (optional)" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" error={tried ? errors.email : null} />
          </View>
        </Section>

        <Section title="Tax" style={{ marginTop: 24 }}>
          <Field label="GSTIN (optional)" value={gstin} onChangeText={(t) => setGstin(t.toUpperCase())} autoCapitalize="characters" maxLength={15} mono
            hint="Printed on tax invoices. Leave empty if you are not registered for GST." error={tried ? errors.gstin : null} />
        </Section>

        <Section title="Bill numbers" style={{ marginTop: 24 }}>
          <View style={{ gap: 14 }}>
            <Field label="Invoice prefix" value={prefix} onChangeText={setPrefix} autoCapitalize="characters" mono maxLength={10} hint={`Bills read ${prefix.trim() || 'INV-'}0001, ${prefix.trim() || 'INV-'}0002…`} error={tried ? errors.prefix : null} />
            {connected ? (
              <Notice tone="primary" title="Numbers are kept per phone" body="This business syncs with a server, so each phone numbers its own bills (for example INV-M4X-0001). That way two phones can never use the same number." />
            ) : (
              <NumberField label="Next bill number" value={nextNo} onChange={setNextNo} hint="Set this to carry on from your paper bill book." error={tried ? errors.next : null} />
            )}
          </View>
        </Section>
        <T v="caption" tone="mute" style={{ marginTop: 18 }}>Changes apply to new receipts straight away. Bills already printed are not altered.</T>
      </View>
    </Screen>
  )
}
