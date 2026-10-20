import React, { useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { koshMoveToServer } from '@/data/kosh/auth'
import { normalizeKoshUrl } from '@/data/kosh/api'
import { isValidPin } from '@/data/pin'
import { Button } from '@/ui/Button'
import { Field, NumberField } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { Notice } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { toast, tell } from '@/ui/overlays'

/** Moves the business that lives on this phone to a Kosh server: it is created there and every record is uploaded. */
export function MoveToServerSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const router = useRouter()
  const [server, setServer] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function go() {
    setError(null)
    if (!server.trim()) { setError('Enter the server address.'); return }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setError('Enter a valid email — it becomes your sign-in.'); return }
    if (password.length < 8) { setError('Choose a password of at least 8 characters.'); return }
    if (!isValidPin(pin)) { setError('Type your owner PIN again (4 digits).'); return }
    setBusy(true)
    try {
      const r = await koshMoveToServer(normalizeKoshUrl(server), { email, password, pin })
      onClose()
      toast('Your business is moving to the server', 'ok')
      if (r.staffToReAdd) await tell('Add your staff again', `${r.staffToReAdd} ${r.staffToReAdd === 1 ? 'person' : 'people'} on this phone ${r.staffToReAdd === 1 ? 'was' : 'were'} not moved: their PINs are scrambled and cannot be copied. Add them under More → Staff & roles and give each a new PIN.`)
      router.replace('/')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not move the business')
      setBusy(false)
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Move to a server" subtitle="One business, every phone, backed up" full footer={<Button label={busy ? 'Moving…' : 'Move my business'} size="lg" block loading={busy} onPress={go} />}>
      <View style={{ gap: 14, paddingBottom: 8 }}>
        <T tone="soft">Everything — items, customers, bills, stock, settings — is copied to your Kosh server. This phone then stays in sync with it and keeps working offline.</T>
        <Field label="Server address" value={server} onChangeText={setServer} placeholder="https://erp.yourshop.in" autoCapitalize="none" autoCorrect={false} keyboardType="url" />
        <Field label="Your email" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" hint="You will sign in with this on other phones." />
        <Field label="Choose a password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" />
        <NumberField label="Owner PIN (again)" value={pin} onChange={(v) => setPin(v.slice(0, 4))} secureTextEntry maxLength={4} />
        {error ? <Notice tone="danger" title="Could not move it" body={error} /> : null}
      </View>
    </Sheet>
  )
}
