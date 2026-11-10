import React, { useMemo, useState } from 'react'
import { ScrollView, Share, TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDateTime, fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useApp, useCan } from '@/data/store'
import { giftCardBalance, outstandingGiftCards, txnsOf } from '@/modules/credit/giftcards'
import type { GiftCard } from '@/modules/credit/types'
import type { CollectionMode } from '@/modules/credit/types'
import { MODE_OPTIONS } from '@/modules/credit/ui/modes'
import { QrCode } from '@/modules/credit/ui/QrCode'
import { Button } from '@/ui/Button'
import { Field, MoneyField } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { Chip, Tap } from '@/ui/primitives'
import { T } from '@/ui/Text'
import { Plus, Search as SearchIcon, Share as ShareIcon, Wallet, XCircle } from '@/ui/icons'
import { fonts, useTheme } from '@/ui/theme'
import { cellNum, cellText, DataTable, DeskButton, DeskPage, dtext, KpiStrip, KpiTile, Pill, Toolbar, type Column } from './kit'
import { DesktopSettingsPage } from './SettingsPage'

type Row = { id: string; code: string; sub: string; status: 'cancelled' | 'expired' | 'used' | 'active'; balance: number }

/**
 * The desktop Gift cards screen: a KPI strip for what's owed on cards, the same quick link to store-credit top-up,
 * and one dense sortable grid instead of a scrolling card list. Reads its own data directly, exactly like
 * `DesktopPurchases`: every balance comes from the same `giftCardBalance`/`outstandingGiftCards` the phone
 * `m/credit/giftcards/index.tsx` calls.
 */
export function DesktopGiftCards() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('collections')
  const data = useApp((s) => s.data)
  const [q, setQ] = useState('')
  const now = Date.now()
  const out = useMemo(() => outstandingGiftCards(data, now), [data, now])
  const rows = useMemo(() => Object.values(data.giftCards ?? {}).map((g) => ({ g, balance: giftCardBalance(data, g.id) })).sort((a, b) => b.g.issuedAt - a.g.issuedAt), [data])
  const shown = rows.filter(({ g }) => !q.trim() || g.code.includes(q.trim().toUpperCase().replace(/\s+/g, '')) || (data.customers[g.customerId ?? '']?.name ?? '').toLowerCase().includes(q.trim().toLowerCase()))

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Gift cards" />}>
        <View style={{ padding: 20 }}><T tone="mute">Gift cards are for the owner, managers and cashiers.</T></View>
      </DeskPage>
    )
  }

  const tableRows: Row[] = shown.map(({ g, balance }) => ({
    id: g.id, code: g.code, sub: data.customers[g.customerId ?? '']?.name ?? `Sold ${fmtDayShort(g.issuedAt)}`,
    status: !g.active ? 'cancelled' : g.expiresAt && g.expiresAt < now ? 'expired' : balance <= 0 ? 'used' : 'active', balance,
  }))

  const columns: Array<Column<Row>> = [
    { key: 'code', label: 'Card', sortValue: (r) => r.code, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.code}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.sub}</T>
      </View>
    ) },
    { key: 'status', label: 'Status', width: 110, sortValue: (r) => r.status, render: (r) => (
      r.status === 'cancelled' ? <Pill tone="danger" label="Cancelled" /> : r.status === 'expired' ? <Pill tone="warning" label="Expired" /> : r.status === 'used' ? <Pill label="Used up" /> : <Pill tone="success" label="Active" />
    ) },
    { key: 'balance', label: 'Balance', width: 120, align: 'right', sortValue: (r) => r.balance, render: (r) => cellNum(inr(r.balance, 0), true) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title="Gift cards"
          subtitle={rows.length ? `${rows.length} cards` : undefined}
          right={<DeskButton label="Sell card" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={() => router.push('/m/credit/giftcards/new')} />}
        />
      }
    >
      <KpiStrip>
        <KpiTile label="Owed on cards" value={inr(out.amount, 0)} tone="accent" delta={`${out.cards} active ${out.cards === 1 ? 'card' : 'cards'}`} />
      </KpiStrip>

      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10, alignItems: 'center' }}>
        <DeskButton label="Store-credit top-up" icon={<Wallet size={13} color={c.ink} />} onPress={() => router.push('/m/credit/topup')} />
        <View style={{ flex: 1 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 32, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: c.lineStrong, backgroundColor: c.surface, maxWidth: 300 }}>
          <SearchIcon size={14} color={c.inkMute} />
          <TextInput value={q} onChangeText={setQ} placeholder="Search code or customer" placeholderTextColor={c.inkMute} autoCorrect={false} autoCapitalize="none" style={{ minWidth: 160, color: c.ink, fontFamily: fonts.body, fontSize: 12.5, paddingVertical: 0, outlineWidth: 0 }} />
        </View>
      </View>

      <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable rows={tableRows} columns={columns} onRowPress={(r) => router.push({ pathname: '/m/credit/giftcards/[id]', params: { id: r.id } })} emptyLabel="No gift cards yet" />
      </View>
    </DeskPage>
  )
}

// ───────────────────────────── giftcards/[id].tsx ─────────────────────────────

export interface DesktopGiftCardPageProps {
  card: GiftCard
  shop: string
  balance: number
  expired: boolean
  txns: Array<{ id: string; type: 'issue' | 'redeem' | 'refund'; date: number; note?: string; amount: number }>
  customerName: string | undefined
  adding: boolean; setAdding: (v: boolean) => void
  amount: string; setAmount: (v: string) => void
  mode: CollectionMode; setMode: (v: CollectionMode) => void
  onRecharge: () => void
  onCancel: () => void
}

const WORD = { issue: 'Loaded', redeem: 'Spent', refund: 'Refunded' } as const

/** The desktop gift-card detail screen: the QR + balance up top, the movement history as a dense grid, and the add-money sheet. */
export function DesktopGiftCardPage(p: DesktopGiftCardPageProps) {
  const { c } = useTheme()
  const columns: Array<Column<DesktopGiftCardPageProps['txns'][number]>> = [
    { key: 'type', label: 'Movement', sortValue: (r) => r.type, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong}>{WORD[r.type]}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{fmtDateTime(r.date)}{r.note ? ` · ${r.note}` : ''}</T>
      </View>
    ) },
    { key: 'amount', label: 'Amount', width: 130, align: 'right', sortValue: (r) => r.amount, render: (r) => (r.type === 'redeem' ? cellText(`−${inr(r.amount, 0)}`, true) : cellNum(`+${inr(r.amount, 0)}`, true)) },
  ]

  return (
    <DeskPage toolbar={<Toolbar title={p.card.code} subtitle="Gift card" right={p.card.active ? <DeskButton label="Add money" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={() => p.setAdding(true)} /> : <Pill tone={p.expired ? 'warning' : 'danger'} label={p.expired ? 'Expired' : 'Cancelled'} />} />}>
      <KpiStrip>
        <KpiTile label="Balance" value={inr(p.balance, 0)} tone="primary" />
        {p.customerName ? <KpiTile label="For" value={p.customerName} /> : null}
        {p.card.expiresAt ? <KpiTile label="Valid till" value={fmtDayShort(p.card.expiresAt)} /> : null}
      </KpiStrip>

      <View style={{ flex: 1, flexDirection: 'row' }}>
        <View style={{ width: 280, borderRightWidth: 1, borderRightColor: c.line, alignItems: 'center', padding: 20, gap: 12 }}>
          <QrCode value={p.card.code} size={160} />
          <T style={dtext.title}>{p.card.code}</T>
          {p.card.note ? <T style={[dtext.tiny, { color: c.inkMute, textAlign: 'center' }]}>{p.card.note}</T> : null}
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            <DeskButton label="Share code" icon={<ShareIcon size={13} color={c.ink} />} onPress={() => void Share.share({ message: `${p.shop} gift card. Code: ${p.card.code}. Balance ${inr(p.balance, 0)}.` })} />
            {p.card.active ? <DeskButton label="Cancel card" tone="danger" icon={<XCircle size={13} color={c.danger} />} onPress={p.onCancel} /> : null}
          </View>
        </View>

        <View style={{ flex: 1, margin: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
          <DataTable rows={p.txns} columns={columns} emptyLabel="No movement yet" />
        </View>
      </View>

      <Sheet visible={p.adding} onClose={() => p.setAdding(false)} title="Add money" subtitle={p.card.code} footer={<Button label="Add" size="lg" block disabled={!(Number(p.amount) > 0)} onPress={p.onRecharge} />}>
        <View style={{ gap: 14 }}>
          <MoneyField label="Amount" value={p.amount} onChange={p.setAmount} placeholder="0" large />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {MODE_OPTIONS.filter((m) => m.value !== 'cheque').map((m) => <Chip key={m.value} label={m.label} selected={p.mode === m.value} onPress={() => p.setMode(m.value)} />)}
          </View>
        </View>
      </Sheet>
    </DeskPage>
  )
}

// ───────────────────────────── giftcards/new.tsx ─────────────────────────────

export interface DesktopNewGiftCardProps {
  value: string; setValue: (v: string) => void
  mode: CollectionMode; setMode: (v: CollectionMode) => void
  code: string; setCode: (v: string) => void
  expires: string; setExpires: (v: string) => void
  note: string; setNote: (v: string) => void
  customer: { name: string } | null
  onPickCustomer: () => void
  amt: number
  dateOk: boolean
  onSave: () => void
}

/** The desktop sell-a-gift-card form: the same centred-column shell around the exact same amount, payment-mode and customer fields. */
export function DesktopNewGiftCard(p: DesktopNewGiftCardProps) {
  const { c } = useTheme()
  return (
    <DesktopSettingsPage title="Sell a gift card" right={<DeskButton label={p.amt > 0 ? `Sell for ${inr(p.amt, 0)}` : 'Sell card'} tone="primary" disabled={!(p.amt > 0) || !p.dateOk} onPress={p.onSave} />}>
      <View style={{ gap: 18 }}>
        <MoneyField label="Value of the card" value={p.value} onChange={p.setValue} placeholder="0" large />
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {[500, 1000, 2000, 5000].map((n) => <Chip key={n} label={inr(n, 0)} selected={p.amt === n} onPress={() => p.setValue(String(n))} />)}
        </View>
        <View style={{ gap: 8 }}>
          <T style={[dtext.label, { color: c.inkMute }]}>Paid by</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {MODE_OPTIONS.filter((m) => m.value !== 'cheque').map((m) => <Chip key={m.value} label={m.label} selected={p.mode === m.value} onPress={() => p.setMode(m.value)} />)}
          </View>
        </View>
        <Field label="Code (optional)" value={p.code} onChangeText={(t) => p.setCode(t.toUpperCase())} placeholder="Leave empty to make one" autoCapitalize="characters" />
        <Field label="Valid till (optional)" value={p.expires} onChangeText={p.setExpires} placeholder="YYYY-MM-DD" error={p.dateOk ? null : 'Write the date as YYYY-MM-DD'} />
        <Tap onPress={p.onPickCustomer} style={{ padding: 14, borderRadius: 8, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
          <T style={[dtext.cell, !p.customer ? { color: c.inkMute } : null]}>{p.customer ? `For ${p.customer.name}` : 'For a customer (optional)'}</T>
        </Tap>
        <Field label="Note (optional)" value={p.note} onChangeText={p.setNote} />
      </View>
    </DesktopSettingsPage>
  )
}
