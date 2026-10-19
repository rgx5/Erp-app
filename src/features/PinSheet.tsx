import React, { useEffect, useState } from 'react'
import { View } from 'react-native'
import { Sheet } from '@/ui/Sheet'
import { T } from '@/ui/Text'
import { Avatar } from '@/ui/primitives'
import { PinPad } from './PinPad'

/** Asks one person for their 4-digit PIN. `onSubmit` returns an error message to show, or null when it worked. */
export function PinSheet({ visible, name, role, onClose, onSubmit }: { visible: boolean; name: string; role?: string; onClose: () => void; onSubmit: (pin: string) => Promise<string | null> }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [shake, setShake] = useState(0)
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (visible) { setPin(''); setError(null) } }, [visible])

  async function change(v: string) {
    if (busy) return
    setPin(v)
    setError(null)
    if (v.length === 4) {
      setBusy(true)
      const err = await onSubmit(v)
      setBusy(false)
      if (err) { setError(err); setShake((s) => s + 1); setPin('') } else onClose()
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} bare scroll={false}>
      <View style={{ alignItems: 'center', gap: 6, paddingTop: 4, paddingBottom: 22 }}>
        <Avatar name={name} size={56} />
        <T v="h2" style={{ marginTop: 6 }}>{name}</T>
        {role ? <T tone="mute" v="caption">{role}</T> : null}
        <T tone={error ? 'danger' : 'soft'} style={{ marginTop: 10, marginBottom: 14, minHeight: 22 }} align="center">{error ?? 'Enter your 4-digit PIN'}</T>
        <PinPad value={pin} onChange={change} shake={shake} />
      </View>
    </Sheet>
  )
}
