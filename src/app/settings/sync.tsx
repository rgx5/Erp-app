import React, { useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { timeAgo, fmtDate } from '@/domain/dates'
import { num } from '@/domain/money'
import type { SyncEntity } from '@/domain/types'
import { reauthenticate } from '@/data/auth'
import { useList } from '@/data/hooks'
import { retryRejected, syncNow } from '@/data/runtime'
import { useApp, useUser } from '@/data/store'
import { useSyncStatus } from '@/features/settingsKit'
import { Button } from '@/ui/Button'
import { Field } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Badge, Card, IconWell } from '@/ui/primitives'
import { KV, Notice, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Cloud, Database, Refresh } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'
import { MoveToServerSheet } from '@/features/MoveToServer'

const ENTITY: Partial<Record<SyncEntity, string>> = {
  bill: 'Sale', billReturn: 'Return', customer: 'Customer', customerUpdate: 'Customer edit', product: 'New item', productUpdate: 'Item edit', productDelete: 'Item removal',
  variant: 'New option', variantUpdate: 'Price or stock edit', expense: 'Expense', stockAdjust: 'Stock adjustment', storeUpdate: 'Business settings', supplier: 'Supplier',
  supplierUpdate: 'Supplier edit', purchase: 'Purchase', session: 'Day opened', sessionUpdate: 'Day closed', user: 'New staff member', userUpdate: 'Staff edit',
  coupon: 'Coupon', couponUpdate: 'Coupon edit', category: 'Category', categoryDelete: 'Category removal',
}

const host = (url?: string) => (url ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '')

/** Whether the business is safe: what has reached the server, what is waiting, and what the server refused. */
export default function SyncScreen() {
  const { c } = useTheme()
  const router = useRouter()
  const ws = useApp((s) => s.workspace)
  const sync = useApp((s) => s.sync)
  const outbox = useApp((s) => s.outbox)
  const user = useUser()
  const status = useSyncStatus()
  const prefix = useApp((s) => s.data.store?.invoicePrefix ?? 'INV-')
  const bills = useList('bills')
  const products = useList('products')
  const customers = useList('customers')
  const [busy, setBusy] = useState(false)
  const [signIn, setSignIn] = useState(false)
  const [moving, setMoving] = useState(false)

  const connected = ws?.mode === 'remote'
  const rejected = outbox.filter((o) => o.synced === 2)

  async function run() {
    setBusy(true)
    try { await syncNow() } finally { setBusy(false) }
  }
  async function retry() {
    setBusy(true)
    try { await retryRejected(); toast('Trying again', 'info') } finally { setBusy(false) }
  }

  return (
    <Screen title="Sync & connection" back refreshing={busy} onRefresh={connected ? run : undefined}>
      <View style={{ paddingBottom: 12, gap: 4 }}>
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <IconWell size={46} tone={status.calm ? (connected ? 'success' : 'default') : status.tone === c.danger ? 'danger' : 'warning'}><status.Icon size={22} color={status.tone} /></IconWell>
          <View style={{ flex: 1 }}>
            <T v="h2">{status.label}</T>
            <T v="caption" tone="mute">{status.detail}</T>
          </View>
        </Card>

        {connected ? (
          <>
            {!sync.authenticated ? (
              <View style={{ marginTop: 12 }}>
                <Notice tone="warning" title="Your sign-in has expired" body={ws?.loginEmail ? `Enter the password for ${ws.loginEmail} to carry on syncing. Nothing is lost meanwhile.` : 'Sign out and connect again to carry on syncing.'} action={ws?.loginEmail ? 'Sign in' : undefined} onAction={() => setSignIn(true)} />
              </View>
            ) : null}
            {sync.lastError && sync.authenticated ? <View style={{ marginTop: 12 }}><Notice tone="danger" title="The last sync had a problem" body={sync.lastError} /></View> : null}

            <View style={{ marginTop: 14 }}>
              <Button label={busy || sync.busy ? 'Syncing…' : 'Sync now'} size="lg" block loading={busy || sync.busy} icon={<Refresh size={19} color="#fff" />} onPress={run} />
            </View>

            <Section title="Details" style={{ marginTop: 24 }}>
              <Card>
                <KV k="Business" v={ws?.name ?? ''} />
                <KV k="Server" v={host(ws?.apiUrl)} />
                <KV k="Signed in as" v={user?.name ?? '—'} />
                <KV k="This phone’s number series" v={ws?.deviceTag ?? '—'} sub={`Bills read ${prefix}${ws?.deviceTag ?? ''}-0001`} />
                <KV k="Waiting to upload" v={num(sync.pending)} tone={sync.pending ? 'warning' : undefined} sub={sync.oldestPendingAt ? `oldest ${timeAgo(sync.oldestPendingAt)}` : undefined} />
                <KV k="Last uploaded" v={sync.lastSyncedAt ? timeAgo(sync.lastSyncedAt) : 'Not yet'} />
                <KV k="Last downloaded" v={sync.lastPulledAt ? timeAgo(sync.lastPulledAt) : 'Not yet'} />
              </Card>
            </Section>

            {rejected.length ? (
              <Section title={`Not saved · ${rejected.length}`} style={{ marginTop: 24 }}>
                <View style={{ gap: 10 }}>
                  <T v="caption" tone="soft">The server refused these changes, so they were set aside and the rest carried on. They stay on this phone.</T>
                  {rejected.slice(0, 12).map((o) => (
                    <Card key={o.id} flat>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <T v="bodyStrong" style={{ flex: 1 }}>{o.entity === 'mut' ? `Change to ${String((o.payload as { coll?: string }).coll ?? 'a record')}` : ENTITY[o.entity] ?? o.entity}</T>
                        <Badge tone="danger">{o.attempts} {o.attempts === 1 ? 'try' : 'tries'}</Badge>
                      </View>
                      <T v="caption" tone="danger" style={{ marginTop: 4 }}>{o.lastError ?? 'Refused by the server'}</T>
                      <T v="micro" tone="mute" style={{ marginTop: 4 }}>Made {timeAgo(o.createdAt)}</T>
                    </Card>
                  ))}
                  {rejected.length > 12 ? <T v="caption" tone="mute">…and {rejected.length - 12} more.</T> : null}
                  <Button label="Try them again" kind="soft" block loading={busy} onPress={retry} />
                </View>
              </Section>
            ) : null}
          </>
        ) : (
          <>
            <View style={{ marginTop: 12 }}>
              <Notice tone="warning" icon={<Database size={20} color={c.warning} />} title="There is no backup but this phone" body="Export a copy regularly. If the phone is lost or reset, the business goes with it." action="Back up" onAction={() => router.push('/settings/data')} />
            </View>
            <Section title="On this phone" style={{ marginTop: 24 }}>
              <Card>
                <KV k="Business" v={ws?.name ?? ''} />
                <KV k="Started" v={ws ? fmtDate(ws.createdAt) : '—'} />
                <KV k="Bills" v={num(bills.length)} />
                <KV k="Items" v={num(products.length)} />
                <KV k="Customers" v={num(customers.length)} />
              </Card>
            </Section>
            <View style={{ marginTop: 14, gap: 10 }}>
              <T v="caption" tone="mute">To share one business between several phones, move it to a Kosh server. Your data then lives on the server and every phone keeps working offline.</T>
              <Button label="Move to a server" kind="outline" block icon={<Cloud size={18} color={c.ink} />} onPress={() => setMoving(true)} />
            </View>
          </>
        )}
      </View>
      <MoveToServerSheet visible={moving} onClose={() => setMoving(false)} />
      <SignInSheet visible={signIn} email={ws?.loginEmail ?? ''} onClose={() => setSignIn(false)} onDone={() => { setSignIn(false); void run() }} />
    </Screen>
  )
}

function SignInSheet({ visible, email, onClose, onDone }: { visible: boolean; email: string; onClose: () => void; onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function go() {
    if (!password) { setError('Enter your password'); return }
    setBusy(true); setError(null)
    try {
      await reauthenticate(password)
      setPassword('')
      toast('Signed in', 'ok')
      onDone()
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Could not sign in')
    } finally { setBusy(false) }
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Sign in again" subtitle={email} footer={<Button label="Sign in" size="lg" block loading={busy} onPress={go} />}>
      <View style={{ gap: 12, paddingBottom: 8 }}>
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} error={error} onSubmitEditing={go} autoFocus />
        <T v="caption" tone="mute">Changes made while you were signed out are kept and upload straight after.</T>
      </View>
    </Sheet>
  )
}
