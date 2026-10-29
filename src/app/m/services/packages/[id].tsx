import React, { useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { fmtDate, fmtDateTime } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useApp, useCan } from '@/data/store'
import { Button } from '@/ui/Button'
import { Field } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Badge, Card } from '@/ui/primitives'
import { KV, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Pause, Play } from '@/ui/icons'
import { ask } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'
import { expirePackage, reverseUse, setPackageFrozen } from '@/modules/services/ops'
import { isReversible, packageStatus, remainingValue, sessionsLeft, STATUS_LABEL, usesOf } from '@/modules/services/logic/packages'
import { act, Denied, PACKAGE_TONE } from '@/modules/services/ui/common'

const USE_LABEL = { use: 'Used', reversal: 'Given back', expiry: 'Lapsed' } as const

/** One customer's package: sessions left, its money, and freezing, lapsing or giving a session back. */
export default function PackageView() {
  const { c } = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const can = useCan('services')
  const manager = useCan('servicesManage')
  const data = useApp((s) => s.data)
  const now = Date.now()
  const p = data.customerPackages?.[id]
  const [note, setNote] = useState('')
  const [freezing, setFreezing] = useState<boolean | null>(null)
  const [reverseId, setReverseId] = useState<string | null>(null)
  const [reason, setReason] = useState('')

  if (!can) return <Denied title="Package" who="Packages & memberships are for people who work at the counter." />
  if (!p) return <Screen title="Not found" back><T tone="mute">This package is no longer here.</T></Screen>
  const status = packageStatus(p, now)
  const customer = p.customerId ? data.customers[p.customerId] : undefined
  const uses = usesOf(data, p.id)

  function freeze(v: boolean) {
    if (act((s, ctx) => setPackageFrozen(s, p!.id, v, note, ctx), v ? 'Frozen' : 'Unfrozen')) { setFreezing(null); setNote('') }
  }
  async function lapse() {
    if (await ask({ title: 'Let this package lapse?', message: `${sessionsLeft(p)} unused session${sessionsLeft(p) === 1 ? '' : 's'} will be recorded as income.`, confirm: 'Let it lapse' })) act((s, ctx) => expirePackage(s, p!.id, ctx), 'Lapsed')
  }
  function reverse() {
    if (!reason.trim()) return
    if (act((s, ctx) => reverseUse(s, reverseId!, reason, ctx), 'Session given back')) { setReverseId(null); setReason('') }
  }

  return (
    <Screen title={p.name} subtitle={`${p.no}${customer ? ` · ${customer.name}` : ''}`} back>
      <View style={{ gap: 14, paddingBottom: 28 }}>
        <Card>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Badge tone={PACKAGE_TONE[status]}>{STATUS_LABEL[status]}</Badge>
          </View>
          <View style={{ marginTop: 8 }}>
            <KV k="Sessions left" v={`${sessionsLeft(p)} of ${p.sessions}`} strong />
            {customer ? <KV k="Customer" v={customer.name} /> : null}
            <KV k="Sold on" v={fmtDate(p.soldAt)} />
            {p.expiresAt !== undefined ? <KV k="Valid until" v={fmtDate(p.expiresAt)} tone={status === 'expired' ? 'danger' : undefined} /> : null}
            <KV k="Price paid" v={inr(p.price, 0)} />
            <KV k="Still to earn" v={inr(remainingValue(p), 0)} tone="success" />
            {p.note ? <KV k="Note" v={p.note} /> : null}
          </View>
        </Card>

        {manager ? (
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {status === 'active' ? <Button label="Freeze" kind="soft" size="sm" icon={<Pause size={15} color={c.primary} />} onPress={() => { setNote(''); setFreezing(true) }} /> : null}
            {status === 'frozen' ? <Button label="Unfreeze" kind="success" size="sm" icon={<Play size={15} color="#fff" />} onPress={() => freeze(false)} /> : null}
          </View>
        ) : null}
        {status === 'expired' && p.status !== 'expired' && sessionsLeft(p) > 0 ? <Button label="Let it lapse — record the income" kind="outline" block onPress={() => void lapse()} /> : null}

        {customer ? <Button label="Open the customer" kind="soft" block onPress={() => router.push({ pathname: '/customers/[id]', params: { id: customer.id } } as never)} /> : null}

        <Section title="Sessions" style={{ marginTop: 0 }}>
          {uses.length ? (
            <View style={{ gap: 10 }}>
              {uses.map((u) => (
                <Card key={u.id} style={{ gap: 4 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <T v="bodyStrong" style={{ flex: 1 }}>{USE_LABEL[u.kind]}{u.serviceName ? ` · ${u.serviceName}` : ''}</T>
                    <T v="num">{u.sessions > 0 ? `+${u.sessions}` : u.sessions}</T>
                  </View>
                  <T v="caption" tone="mute">{fmtDateTime(u.date)}{u.note ? ` · ${u.note}` : ''}</T>
                  {manager && isReversible(data, u) ? <Button label="Give this session back" kind="ghost" size="sm" onPress={() => { setReason(''); setReverseId(u.id) }} /> : null}
                </Card>
              ))}
            </View>
          ) : <T tone="mute">No sessions used yet.</T>}
        </Section>
      </View>

      <Sheet visible={freezing !== null} onClose={() => setFreezing(null)} title="Freeze this package" footer={<Button label="Freeze" kind="danger" size="lg" block onPress={() => freeze(true)} />}>
        <View style={{ gap: 12, paddingBottom: 8 }}>
          <Field label="Why (optional)" value={note} onChangeText={setNote} autoCapitalize="sentences" />
          <T v="caption" tone="mute">A frozen package cannot be used until it is unfrozen. Its expiry date does not move.</T>
        </View>
      </Sheet>

      <Sheet visible={!!reverseId} onClose={() => setReverseId(null)} title="Give this session back" footer={<Button label="Confirm" kind="danger" size="lg" block onPress={reverse} />}>
        <View style={{ gap: 12, paddingBottom: 8 }}>
          <Field label="Why" value={reason} onChangeText={setReason} autoCapitalize="sentences" placeholder="Booking cancelled by the shop" />
        </View>
      </Sheet>
    </Screen>
  )
}
