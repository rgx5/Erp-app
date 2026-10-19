import React, { useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { ROLE_LABEL } from '@/domain/permissions'
import type { Role } from '@/domain/types'
import { connectWithPassword, connectWithPin, listStaff } from '@/data/auth'
import { CloudError } from '@/data/api'
import { PinSheet } from '@/features/PinSheet'
import { Button } from '@/ui/Button'
import { Field, Segmented } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Avatar, Group, Tap } from '@/ui/primitives'
import { Notice } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Eye, EyeOff, Server } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

const DEFAULT_URL = process.env.EXPO_PUBLIC_DEFAULT_API_URL ?? ''

type Method = 'owner' | 'staff'
type Person = { id: string; name: string; role: Role; active: boolean; code?: string }

/**
 * Connect to a Kosh server. Owners and managers sign in with email and password; counter staff pick their name and enter
 * their PIN. Either way the whole business is downloaded to the phone, and from then on works offline.
 */
export default function Connect() {
  const router = useRouter()
  const { c } = useTheme()
  const [method, setMethod] = useState<Method>('owner')
  const [url, setUrl] = useState(DEFAULT_URL)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [storeId, setStoreId] = useState('')
  const [staff, setStaff] = useState<Person[] | null>(null)
  const [picked, setPicked] = useState<Person | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fail = (e: unknown) => setError(e instanceof CloudError ? e.message : e instanceof Error ? e.message : 'Something went wrong')

  async function signIn() {
    setError(null)
    if (!url.trim()) { setError('Enter the server address your administrator gave you.'); return }
    if (!email.trim() || !password) { setError('Enter your email and password.'); return }
    setBusy(true)
    try {
      await connectWithPassword(url, email, password)
      toast('Connected — your business is on this phone', 'ok')
      router.replace('/')
    } catch (e) { fail(e); setBusy(false) }
  }

  async function findStaff() {
    setError(null)
    if (!url.trim() || !storeId.trim()) { setError('Enter the server address and the Store ID.'); return }
    setBusy(true)
    try { setStaff((await listStaff(url, storeId)).filter((u) => u.active)) } catch (e) { fail(e) }
    setBusy(false)
  }

  async function pinSubmit(pin: string): Promise<string | null> {
    try {
      await connectWithPin(url, storeId, picked!.id, pin)
      router.replace('/')
      return null
    } catch (e) {
      const status = e instanceof CloudError ? e.status : 0
      return status === 429 ? 'Too many attempts — try again in a few minutes' : status === 401 ? 'That PIN is not right' : e instanceof Error ? e.message : 'Could not sign in'
    }
  }

  return (
    <Screen title="Connect your business" subtitle="Download it once, then it works offline" back
      footer={method === 'owner' ? <Button label={busy ? 'Downloading your business…' : 'Sign in'} size="lg" block loading={busy} onPress={signIn} /> : staff ? undefined : <Button label="Find my name" size="lg" block loading={busy} onPress={findStaff} />}>
      <View style={{ gap: 16, marginTop: 8 }}>
        <Segmented<Method> value={method} onChange={(m) => { setMethod(m); setError(null) }} options={[{ value: 'owner', label: 'Owner / Manager' }, { value: 'staff', label: 'Staff PIN' }]} />

        <Field label="Server address" value={url} onChangeText={setUrl} placeholder="https://erp.yourshop.in/api" autoCapitalize="none" autoCorrect={false} keyboardType="url"
          left={<Server size={18} color={c.inkMute} />} hint="Your administrator provides this — it is the API your ERP runs on." />

        {method === 'owner' ? (
          <>
            <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@yourshop.in" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="username" />
            <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry={!show} autoCapitalize="none" textContentType="password" onSubmitEditing={signIn}
              right={<Tap onPress={() => setShow((s) => !s)} hitSlop={10} accessibilityLabel="Show password">{show ? <EyeOff size={19} color={c.inkMute} /> : <Eye size={19} color={c.inkMute} />}</Tap>} />
          </>
        ) : (
          <>
            <Field label="Store ID" value={storeId} onChangeText={(t) => { setStoreId(t); setStaff(null) }} placeholder="store_xxxxxxxxxx" autoCapitalize="none" autoCorrect={false} hint="Owner → More → Settings → Data & sync shows it." />
            {staff ? (
              <View style={{ gap: 10 }}>
                <T v="h2">Who are you?</T>
                {staff.length ? (
                  <Group>
                    {staff.map((u) => (
                      <Tap key={u.id} onPress={() => setPicked(u)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
                        <Avatar name={u.name} size={40} />
                        <View style={{ flex: 1 }}><T v="bodyStrong">{u.name}</T><T v="caption" tone="mute">{ROLE_LABEL[u.role]}</T></View>
                      </Tap>
                    ))}
                  </Group>
                ) : <T tone="mute">No staff found for that Store ID.</T>}
              </View>
            ) : null}
          </>
        )}
        {error ? <Notice tone="danger" title={error} /> : null}
      </View>
      <PinSheet visible={!!picked} name={picked?.name ?? ''} role={picked ? ROLE_LABEL[picked.role] : undefined} onClose={() => setPicked(null)} onSubmit={pinSubmit} />
    </Screen>
  )
}
