import React, { useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'
import { isValidStaffCode, nextStaffCode, normalizeStaffCode } from '@/domain/codes'
import { ROLE_HELP, ROLE_LABEL } from '@/domain/permissions'
import type { Role, User } from '@/domain/types'
import { useLabels, useList } from '@/data/hooks'
import { OpError, saveStaff } from '@/data/ops'
import { hashPin, isValidPin } from '@/data/pin'
import { perform, useApp } from '@/data/store'
import { SettingsLocked, useCanSettings } from '@/features/settingsKit'
import { Button, IconButton } from '@/ui/Button'
import { Field, NumberField, Segmented, SwitchRow } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Badge, Card, Group } from '@/ui/primitives'
import { ListRow, Notice } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Plus } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

const ROLES: Role[] = ['owner', 'manager', 'cashier']

/** The people who use this business: what each can do, their PIN, and their staff number for crediting sales. */
export default function Staff() {
  const { c } = useTheme()
  const allowed = useCanSettings()
  const labels = useLabels()
  const users = useList('users')
  const me = useApp((s) => s.session?.userId)
  const connected = useApp((s) => s.workspace?.mode === 'remote')
  const [editing, setEditing] = useState<User | 'new' | null>(null)

  const sorted = useMemo(() => [...users].sort((a, b) => Number(b.active) - Number(a.active) || ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || a.name.localeCompare(b.name)), [users])

  if (!allowed) return <SettingsLocked title="Staff & roles" />

  return (
    <Screen title="Staff & roles" subtitle={`${users.filter((u) => u.active).length} active`} back right={<IconButton label="Add person" tone="dark" onPress={() => setEditing('new')}><Plus size={22} color={c.bg} /></IconButton>}>
      <View style={{ gap: 14, paddingBottom: 12 }}>
        {connected ? <Notice tone="primary" title="PINs are kept by the server" body="A new PIN is sent to the server once and never stored on this phone. People can sign in on any phone with it." /> : null}
        <Group>
          {sorted.map((u) => (
            <ListRow key={u.id} avatar={u.name} title={u.name} subtitle={`${ROLE_LABEL[u.role]}${u.code ? ` · ${labels.staff} no. ${u.code}` : ''}`}
              badge={u.id === me ? <Badge tone="primary">You</Badge> : !u.active ? <Badge>Inactive</Badge> : undefined} onPress={() => setEditing(u)} />
          ))}
        </Group>
        <Card flat>
          <T v="label" tone="soft" style={{ marginBottom: 8 }}>WHO CAN DO WHAT</T>
          {ROLES.map((r) => (
            <View key={r} style={{ flexDirection: 'row', gap: 10, paddingVertical: 4 }}>
              <T v="bodyStrong" style={{ width: 76 }}>{ROLE_LABEL[r]}</T>
              <T v="caption" tone="soft" style={{ flex: 1 }}>{ROLE_HELP[r]}</T>
            </View>
          ))}
        </Card>
      </View>
      <StaffSheet person={editing} isSelf={editing !== null && editing !== 'new' && editing.id === me} onClose={() => setEditing(null)} />
    </Screen>
  )
}

function StaffSheet({ person, isSelf, onClose }: { person: User | 'new' | null; isSelf: boolean; onClose: () => void }) {
  const users = useList('users')
  const connected = useApp((s) => s.workspace?.mode === 'remote')
  const labels = useLabels()
  const existing = person && person !== 'new' ? person : undefined
  const [name, setName] = useState('')
  const [role, setRole] = useState<Role>('cashier')
  const [code, setCode] = useState('')
  const [pin, setPin] = useState('')
  const [active, setActive] = useState(true)
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!person) return
    setTried(false); setBusy(false); setPin('')
    setName(existing?.name ?? ''); setRole(existing?.role ?? 'cashier'); setActive(existing?.active ?? true)
    setCode(existing ? existing.code ?? '' : nextStaffCode(users))
  }, [person]) // eslint-disable-line react-hooks/exhaustive-deps

  const errors = {
    name: !name.trim() ? 'Enter a name' : null,
    code: code && !isValidStaffCode(normalizeStaffCode(code)) ? 'Use 2 or 3 digits, like 07' : null,
    pin: !existing && !isValidPin(pin) ? 'Choose a 4-digit PIN' : pin && !isValidPin(pin) ? 'A PIN is exactly 4 digits' : null,
  }

  async function save() {
    setTried(true)
    if (Object.values(errors).some(Boolean)) return
    setBusy(true)
    try {
      const pinArg = pin ? (connected ? { plain: pin } : { hash: await hashPin(pin) }) : {}
      perform((s, ctx) => saveStaff(s, { name, role, code: code ? normalizeStaffCode(code) : undefined, active }, existing?.id, pinArg, ctx))
      toast(existing ? 'Saved' : `${name.trim()} added`, 'ok')
      onClose()
    } catch (e) {
      toast(e instanceof OpError ? e.message : 'Could not save', 'err')
      setBusy(false)
    }
  }

  return (
    <Sheet visible={!!person} onClose={onClose} full title={existing ? existing.name : 'Add a person'} subtitle={existing ? ROLE_LABEL[existing.role] : undefined}
      footer={<Button label={existing ? 'Save changes' : 'Add person'} size="lg" block loading={busy} onPress={save} />}>
      <View style={{ gap: 14, paddingBottom: 8 }}>
        <Field label="Name" value={name} onChangeText={setName} autoCapitalize="words" error={tried ? errors.name : null} />
        <View>
          <T v="label" tone="soft" style={{ marginBottom: 6 }}>ROLE</T>
          <Segmented<Role> value={role} onChange={setRole} options={ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))} />
          <T v="caption" tone="mute" style={{ marginTop: 8 }}>{ROLE_HELP[role]}</T>
          {isSelf && existing && role !== existing.role ? <T v="caption" tone="warning" style={{ marginTop: 6 }}>You are changing your own role.</T> : null}
        </View>
        <Field label={`${labels.staff} number`} value={code} onChangeText={(t) => setCode(t.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={3} mono hint="Picked on a bill to say who served the customer" error={tried ? errors.code : null} />
        <NumberField label={existing ? 'New PIN (leave empty to keep)' : '4-digit PIN'} value={pin} onChange={setPin} secureTextEntry maxLength={4} placeholder="••••" error={tried ? errors.pin : null} />
        <Card padded={false}>
          <SwitchRow title="Active" subtitle={isSelf ? 'You cannot deactivate yourself' : active ? 'Can sign in' : 'Cannot sign in; past bills keep their name'} value={active} onChange={setActive} disabled={isSelf} />
        </Card>
      </View>
    </Sheet>
  )
}
