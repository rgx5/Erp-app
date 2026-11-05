import React from 'react'
import { ScrollView, View } from 'react-native'
import { inr } from '@/domain/money'
import { VOUCHER_LABEL, type MoneyMode } from '@/modules/accounting/logic'
import type { Account, VoucherLine } from '@/modules/accounting/types'
import { AccountSelect } from '@/modules/accounting/ui/AccountSelect'
import type { Customer, Supplier } from '@/domain/types'
import { IconButton } from '@/ui/Button'
import { Field, MoneyField, Segmented, Select } from '@/ui/Inputs'
import { Card } from '@/ui/primitives'
import { Notice, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Close } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { DeskButton, DeskPage, Toolbar } from './kit'

type Kind = 'receipt' | 'payment' | 'journal' | 'contra'
type Counter = 'customer' | 'supplier' | 'account'
interface JLine { account: string; debit: string; credit: string; partyId: string }

export interface DesktopNewVoucherProps {
  kind: Kind; setKind: (k: Kind) => void
  date: string; setDate: (v: string) => void
  narration: string; setNarration: (v: string) => void
  amount: string; setAmount: (v: string) => void
  mode: MoneyMode; setMode: (v: MoneyMode) => void
  effective: Counter; counter: Counter; setCounter: (v: Counter) => void; setPartyId: (v: string) => void
  partyId: string
  partyOptions: Array<{ value: string; label: string; sub?: string }>
  account: string; setAccount: (v: string) => void
  from: string; setFrom: (v: string) => void
  to: string; setTo: (v: string) => void
  jl: JLine[]
  upd: (i: number, patch: Partial<JLine>) => void
  addLine: () => void
  removeLine: (i: number) => void
  resolveAccount: (code: string) => Account | null
  customers: Customer[]
  suppliers: Supplier[]
  journalLines: VoucherLine[]
  voucherDebit: (lines: VoucherLine[]) => number
  voucherCredit: (lines: VoucherLine[]) => number
  diff: number
  busy: boolean
  onSave: () => void
}

const MODES: Array<{ value: MoneyMode; label: string }> = [{ value: 'cash', label: 'Cash' }, { value: 'bank', label: 'Bank' }, { value: 'upi', label: 'UPI' }, { value: 'card', label: 'Card' }]
const counterOptions: Array<{ value: Counter; label: string }> = [{ value: 'customer', label: 'Customer' }, { value: 'supplier', label: 'Supplier' }, { value: 'account', label: 'Other account' }]

/**
 * The desktop "New voucher" screen: a `DeskPage`/`Toolbar` shell around the exact form `src/app/m/accounting/
 * vouchers/new.tsx` already builds, centred in a readable column — the same treatment `DesktopNewPurchase` gives
 * the receiving form, including its journal lines as `Card`s rather than a sortable grid (a journal has at most a
 * handful of lines; the `Field`/`Select`/`MoneyField` pieces below are the mobile ones, untouched). No voucher
 * validation or posting logic lives here — `journalLines`, `diff` and every field come from the phone screen.
 */
export function DesktopNewVoucher(p: DesktopNewVoucherProps) {
  const { c } = useTheme()
  return (
    <DeskPage
      toolbar={
        <Toolbar title="New voucher" subtitle="Receipt, payment, journal or contra"
          right={<DeskButton label={p.busy ? 'Posting…' : 'Post voucher'} tone="primary" disabled={p.busy} onPress={p.onSave} />} />
      }
    >
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ alignItems: 'center', padding: 28 }}>
        <View style={{ width: '100%', maxWidth: 680, gap: 14 }}>
          <Segmented compact value={p.kind} options={(['receipt', 'payment', 'journal', 'contra'] as Kind[]).map((k) => ({ value: k, label: VOUCHER_LABEL[k] }))} onChange={p.setKind} />
          <Field label="Date" value={p.date} onChangeText={p.setDate} placeholder="YYYY-MM-DD" autoCapitalize="none" />

          {p.kind === 'receipt' || p.kind === 'payment' ? (
            <>
              <View style={{ gap: 6 }}>
                <T v="label" tone="soft">{p.kind === 'receipt' ? 'RECEIVED FROM' : 'PAID TO'}</T>
                <Segmented compact value={p.effective} options={counterOptions} onChange={(v) => { p.setCounter(v); p.setPartyId('') }} />
              </View>
              {p.effective === 'account' ? <AccountSelect label="Account" value={p.account} onChange={p.setAccount} /> : <Select label={p.effective === 'supplier' ? 'Supplier' : 'Customer'} value={p.partyId} options={p.partyOptions} onChange={p.setPartyId} searchable placeholder="Choose" />}
              <MoneyField label="Amount" value={p.amount} onChange={p.setAmount} />
              <View style={{ gap: 6 }}>
                <T v="label" tone="soft">{p.kind === 'receipt' ? 'RECEIVED IN' : 'PAID FROM'}</T>
                <Segmented compact value={p.mode} options={MODES} onChange={p.setMode} />
              </View>
            </>
          ) : null}

          {p.kind === 'contra' ? (
            <>
              <AccountSelect label="From" value={p.from} onChange={p.setFrom} only={['asset']} />
              <AccountSelect label="To" value={p.to} onChange={p.setTo} only={['asset']} />
              <MoneyField label="Amount" value={p.amount} onChange={p.setAmount} />
            </>
          ) : null}

          {p.kind === 'journal' ? (
            <Section title="Entries" action="Add line" onAction={p.addLine} style={{ marginTop: 0 }}>
              {p.jl.map((l, i) => {
                const acc = l.account ? p.resolveAccount(l.account) : null
                const people = acc?.key === 'receivables' ? p.customers : acc?.key === 'payables' ? p.suppliers : null
                return (
                  <Card key={i} style={{ gap: 10 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
                      <View style={{ flex: 1 }}><AccountSelect label={`Line ${i + 1}`} value={l.account} onChange={(account) => p.upd(i, { account, partyId: '' })} /></View>
                      {p.jl.length > 2 ? <IconButton label="Remove line" onPress={() => p.removeLine(i)}><Close size={18} color={c.ink} /></IconButton> : null}
                    </View>
                    {people ? <Select label={acc?.key === 'payables' ? 'Supplier' : 'Customer'} value={l.partyId} options={people.map((person) => ({ value: person.id, label: person.name }))} onChange={(partyId) => p.upd(i, { partyId })} searchable placeholder="Whose account?" /> : null}
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                      <MoneyField label="Debit" value={l.debit} onChange={(debit) => p.upd(i, { debit, credit: debit ? '' : l.credit })} containerStyle={{ flex: 1 }} />
                      <MoneyField label="Credit" value={l.credit} onChange={(credit) => p.upd(i, { credit, debit: credit ? '' : l.debit })} containerStyle={{ flex: 1 }} />
                    </View>
                  </Card>
                )
              })}
              <Card tone={p.diff === 0 ? undefined : 'warning'} style={{ gap: 4 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T tone="soft">Debits</T><T v="num">{inr(p.voucherDebit(p.journalLines), 2)}</T></View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T tone="soft">Credits</T><T v="num">{inr(p.voucherCredit(p.journalLines), 2)}</T></View>
                {p.diff !== 0 ? <T v="caption" tone="warning">Difference {inr(Math.abs(p.diff), 2)} — debits and credits must be equal.</T> : null}
              </Card>
            </Section>
          ) : null}

          <Field label="Narration" value={p.narration} onChangeText={p.setNarration} placeholder="What is this for?" multiline />
          <Notice tone="primary" title="Vouchers are final" body="A posted voucher is never edited. If it was wrong, reverse it and post a new one." />
        </View>
      </ScrollView>
    </DeskPage>
  )
}
