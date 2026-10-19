import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { ROLE_LABEL } from '@/domain/permissions'
import type { User } from '@/domain/types'
import { switchUser, signOut } from '@/data/auth'
import { useList } from '@/data/hooks'
import { useApp } from '@/data/store'
import { PinSheet } from '@/features/PinSheet'
import { Screen } from '@/ui/Screen'
import { Avatar, Group, Tap } from '@/ui/primitives'
import { T } from '@/ui/Text'
import { ChevronRight } from '@/ui/icons'
import { ask } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

/** "Who's using the app?" — pick yourself, enter your PIN. Used on shared phones and when switching person. */
export default function Who() {
  const router = useRouter()
  const { c } = useTheme()
  const users = useList('users')
  const ws = useApp((s) => s.workspace)
  const current = useApp((s) => s.session?.userId)
  const [picked, setPicked] = useState<User | null>(null)
  const staff = useMemo(() => users.filter((u) => u.active).sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : a.role === 'manager' ? -1 : 1)), [users])

  async function submit(pin: string): Promise<string | null> {
    const r = await switchUser(picked!.id, pin)
    if (r === 'ok') { router.replace('/'); return null }
    if (r === 'locked') return 'Too many attempts — wait a moment and try again'
    if (r === 'offline') return 'No connection — this business needs the internet to check your PIN'
    return 'That PIN is not right'
  }

  async function leave() {
    if (await ask({ title: 'Sign out of this business?', message: 'Everything on this phone is removed. Anything not yet synced to the server is lost.', confirm: 'Sign out', danger: true })) {
      await signOut()
      router.replace('/welcome')
    }
  }

  return (
    <Screen title="Who’s there?" subtitle={ws?.name} back={!!current}>
      <View style={{ marginTop: 8 }}>
        <Group>
          {staff.map((u) => (
            <Tap key={u.id} onPress={() => setPicked(u)} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 }}>
              <Avatar name={u.name} size={46} />
              <View style={{ flex: 1 }}>
                <T v="bodyStrong">{u.name}</T>
                <T v="caption" tone="mute">{ROLE_LABEL[u.role]}{u.code ? ` · No. ${u.code}` : ''}</T>
              </View>
              <ChevronRight size={18} color={c.inkMute} />
            </Tap>
          ))}
        </Group>
        <Tap onPress={leave} style={{ alignItems: 'center', paddingVertical: 22 }}>
          <T v="bodyStrong" tone="danger">Sign out of this business</T>
        </Tap>
      </View>
      <PinSheet visible={!!picked} name={picked?.name ?? ''} role={picked ? ROLE_LABEL[picked.role] : undefined} onClose={() => setPicked(null)} onSubmit={submit} />
    </Screen>
  )
}
