import React, { useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'
import { inr0 } from '@/domain/money'
import { endOfDay, fmtDate, fromInputDate, toInputDate } from '@/domain/dates'
import type { Coupon, DiscountType } from '@/domain/types'
import { useList } from '@/data/hooks'
import { OpError, saveCoupon } from '@/data/ops'
import { perform } from '@/data/store'
import { SettingsLocked, useCanSettings } from '@/features/settingsKit'
import { Button, IconButton } from '@/ui/Button'
import { Field, MoneyField, NumberField, Segmented, SwitchRow } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Badge, Group } from '@/ui/primitives'
import { EmptyState, ListRow } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Plus, Ticket } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

type Status = { label: string; tone: 'success' | 'warning' | 'danger' | 'default' }
function statusOf(c: Coupon, used: number, now = Date.now()): Status {
  if (!c.active) return { label: 'Paused', tone: 'default' }
  if (c.expiresAt && c.expiresAt < now) return { label: 'Expired', tone: 'danger' }
  if (c.maxUses > 0 && used >= c.maxUses) return { label: 'Used up', tone: 'warning' }
  return { label: 'Active', tone: 'success' }
}

/** Discount codes: a percentage or a flat amount, with an optional minimum bill, expiry date and usage limit. */
export default function Coupons() {
  const { c } = useTheme()
  const allowed = useCanSettings()
  const coupons = useList('coupons')
  const bills = useList('bills')
  const [editing, setEditing] = useState<Coupon | 'new' | null>(null)

  const used = useMemo(() => {
    const m = new Map<string, number>()
    for (const b of bills) if (b.coupon && b.status !== 'held') m.set(b.coupon, (m.get(b.coupon) ?? 0) + 1)
    return m
  }, [bills])
  const sorted = useMemo(() => [...coupons].sort((a, b) => Number(b.active) - Number(a.active) || b.createdAt - a.createdAt), [coupons])

  if (!allowed) return <SettingsLocked title="Coupons" />

  return (
    <Screen title="Coupons" back right={<IconButton label="New coupon" tone="dark" onPress={() => setEditing('new')}><Plus size={22} color={c.bg} /></IconButton>}>
      {sorted.length ? (
        <View style={{ paddingBottom: 12 }}>
          <Group>
            {sorted.map((cp) => {
              const st = statusOf(cp, used.get(cp.code) ?? 0)
              const n = used.get(cp.code) ?? 0
              return (
                <ListRow key={cp.id} icon={<Ticket size={20} color={st.tone === 'success' ? c.success : c.inkMute} />} iconTone={st.tone === 'success' ? 'success' : 'default'}
                  title={cp.code} subtitle={[cp.type === 'pct' ? `${cp.value}% off` : `${inr0(cp.value)} off`, cp.minBill > 0 ? `on bills over ${inr0(cp.minBill)}` : null, cp.expiresAt ? `until ${fmtDate(cp.expiresAt)}` : null].filter(Boolean).join(' · ')}
                  meta={`Used ${n}${cp.maxUses > 0 ? ` of ${cp.maxUses}` : ''} ${n === 1 ? 'time' : 'times'}`} badge={<Badge tone={st.tone}>{st.label}</Badge>} onPress={() => setEditing(cp)} />
              )
            })}
          </Group>
        </View>
      ) : (
        <EmptyState icon={<Ticket size={26} color={c.primary} />} title="No coupons yet" hint="Create a code like DIWALI10 that cashiers can apply at checkout." action="Create a coupon" onAction={() => setEditing('new')} />
      )}
      <CouponSheet coupon={editing} onClose={() => setEditing(null)} />
    </Screen>
  )
}

function CouponSheet({ coupon, onClose }: { coupon: Coupon | 'new' | null; onClose: () => void }) {
  const existing = coupon && coupon !== 'new' ? coupon : undefined
  const [code, setCode] = useState('')
  const [type, setType] = useState<DiscountType>('pct')
  const [value, setValue] = useState('')
  const [minBill, setMinBill] = useState('')
  const [expiry, setExpiry] = useState('')
  const [maxUses, setMaxUses] = useState('')
  const [active, setActive] = useState(true)
  const [tried, setTried] = useState(false)

  useEffect(() => {
    if (!coupon) return
    setTried(false)
    setCode(existing?.code ?? ''); setType(existing?.type ?? 'pct'); setValue(existing ? String(existing.value) : ''); setMinBill(existing?.minBill ? String(existing.minBill) : '')
    setExpiry(existing?.expiresAt ? toInputDate(existing.expiresAt) : ''); setMaxUses(existing?.maxUses ? String(existing.maxUses) : ''); setActive(existing?.active ?? true)
  }, [coupon]) // eslint-disable-line react-hooks/exhaustive-deps

  const expiryBad = expiry.trim() !== '' && (!DATE_RE.test(expiry.trim()) || Number.isNaN(fromInputDate(expiry.trim())))
  const errors = {
    code: !code.trim() ? 'Enter a code' : null,
    value: !(Number(value) > 0) ? 'Enter the discount' : type === 'pct' && Number(value) > 100 ? 'A percentage cannot be over 100' : null,
    expiry: expiryBad ? 'Use YYYY-MM-DD, or leave empty' : null,
  }

  function save() {
    setTried(true)
    if (Object.values(errors).some(Boolean)) return
    try {
      perform((s, ctx) => saveCoupon(s, {
        code, type, value: Number(value), minBill: Number(minBill) || 0, maxUses: Math.floor(Number(maxUses)) || 0, active,
        expiresAt: expiry.trim() ? endOfDay(fromInputDate(expiry.trim())) : undefined,
      }, existing?.id, ctx))
      toast(existing ? 'Coupon saved' : 'Coupon created', 'ok')
      onClose()
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not save the coupon', 'err') }
  }

  return (
    <Sheet visible={!!coupon} onClose={onClose} title={existing ? `Edit ${existing.code}` : 'New coupon'} footer={<Button label={existing ? 'Save coupon' : 'Create coupon'} size="lg" block onPress={save} />}>
      <View style={{ gap: 14, paddingBottom: 8 }}>
        <Field label="Code" value={code} onChangeText={(t) => setCode(t.toUpperCase().replace(/\s+/g, ''))} autoCapitalize="characters" mono placeholder="DIWALI10" error={tried ? errors.code : null} />
        <Segmented<DiscountType> value={type} onChange={setType} options={[{ value: 'pct', label: 'Percentage off' }, { value: 'amt', label: 'Amount off' }]} />
        {type === 'pct'
          ? <NumberField label="Discount" value={value} onChange={setValue} decimals suffix="%" error={tried ? errors.value : null} />
          : <MoneyField label="Discount" value={value} onChange={setValue} error={tried ? errors.value : null} />}
        <MoneyField label="Minimum bill (optional)" value={minBill} onChange={setMinBill} hint="The code only works on bills at least this big" />
        <Field label="Valid until (optional)" value={expiry} onChangeText={setExpiry} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" maxLength={10} error={tried ? errors.expiry : null} />
        <NumberField label="Total uses allowed (optional)" value={maxUses} onChange={setMaxUses} hint="Leave empty for no limit" />
        <SwitchRow title="Active" subtitle={active ? 'Cashiers can apply this code' : 'Paused — the code is rejected at checkout'} value={active} onChange={setActive} />
        {existing ? <T v="caption" tone="mute">Coupons cannot be deleted because past bills refer to them. Pause one to stop it being used.</T> : null}
      </View>
    </Sheet>
  )
}
