import React, { useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { connectToPlatform } from '@/data/auth'
import { CloudError } from '@/data/api'
import { Button } from '@/ui/Button'
import { Field } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Tap } from '@/ui/primitives'
import { Notice } from '@/ui/blocks'
import { Eye, EyeOff, Server } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

const DEFAULT_URL = process.env.EXPO_PUBLIC_DEFAULT_API_URL ?? ''

/**
 * Connect to your business on the OneSyncERP platform: the server address, your business code, then your email and password. The catalogue,
 * customers and recent sales are downloaded once, and counter sales then keep working without a connection.
 */
export default function Connect() {
  const router = useRouter()
  const { c } = useTheme()
  const [url, setUrl] = useState(DEFAULT_URL)
  const [tenant, setTenant] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function signIn() {
    setError(null)
    if (!url.trim()) { setError('Enter the server address your administrator gave you.'); return }
    if (!tenant.trim()) { setError('Enter your business code.'); return }
    if (!email.trim() || !password) { setError('Enter your email and password.'); return }
    setBusy(true)
    try {
      await connectToPlatform(url, tenant, email, password)
      toast('Connected — your business is on this phone', 'ok')
      router.replace('/')
    } catch (e) {
      const status = e instanceof CloudError ? e.status : 0
      setError(status === 401 || status === 400 ? 'That business code, email or password is not right.' : status === 429 ? 'Too many attempts — try again in a few minutes.' : e instanceof Error ? e.message : 'Something went wrong')
      setBusy(false)
    }
  }

  return (
    <Screen title="Connect your business" subtitle="Download it once, then sales work offline" back
      footer={<Button label={busy ? 'Downloading your business…' : 'Sign in'} size="lg" block loading={busy} onPress={signIn} />}>
      <View style={{ gap: 16, marginTop: 8 }}>
        <Field label="Server address" value={url} onChangeText={setUrl} placeholder="https://erp.yourshop.in" autoCapitalize="none" autoCorrect={false} keyboardType="url"
          left={<Server size={18} color={c.inkMute} />} hint="Your administrator provides this." />
        <Field label="Business code" value={tenant} onChangeText={setTenant} placeholder="your-shop" autoCapitalize="none" autoCorrect={false} hint="The short name you use to sign in on the desktop app." />
        <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@yourshop.in" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="username" />
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry={!show} autoCapitalize="none" textContentType="password" onSubmitEditing={signIn}
          right={<Tap onPress={() => setShow((s) => !s)} hitSlop={10} accessibilityLabel="Show password">{show ? <EyeOff size={19} color={c.inkMute} /> : <Eye size={19} color={c.inkMute} />}</Tap>} />
        {error ? <Notice tone="danger" title={error} /> : null}
      </View>
    </Screen>
  )
}
