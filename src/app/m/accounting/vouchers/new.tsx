import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useList } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { perform, useCan } from '@/data/store'
import { fromInputDate, toInputDate } from '@/domain/dates'
import { inr, round2 } from '@/domain/money'
import { resolveAccount } from '@/modules/accounting/chart'
import { contraLines, paymentLines, receiptLines, voucherCredit, voucherDebit, VOUCHER_LABEL, type MoneyMode } from '@/modules/accounting/logic'
import { createVoucher } from '@/modules/accounting/ops'
import type { VoucherLine } from '@/modules/accounting/types'
import { AccountSelect } from '@/modules/accounting/ui/AccountSelect'
import { useLedger } from '@/modules/accounting/ui/hooks'
import type { PartyType } from '@/modules/postings'
import { Button, IconButton } from '@/ui/Button'
import { Field, MoneyField, Segmented, Select } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Card } from '@/ui/primitives'
import { Notice, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Close } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

type Kind = 'receipt' | 'payment' | 'journal' | 'contra'
type Counter = 'customer' | 'supplier' | 'account'
interface JLine { account: string; debit: string; credit: string; partyId: string }
const num = (s: string) => (s.trim() === '' ? 0 : Number(s))
const MODES: Array<{ value: MoneyMode; label: string }> = [{ value: 'cash', label: 'Cash' }, { value: 'bank', label: 'Bank' }, { value: 'upi', label: 'UPI' }, { value: 'card', label: 'Card' }]

/** A hand-made entry: money received, money paid, a transfer between cash and bank, or a journal between any accounts. */
export default function NewVoucher() {
  const { c } = useTheme()
  const router = useRouter()
  const params = useLocalSearchParams<{ type?: string; partyType?: string; partyId?: string }>()
  const can = useCan('accounting')
  const ledger = useLedger()
  const customers = useList('customers'), suppliers = useList('suppliers')

  const [kind, setKind] = useState<Kind>((['receipt', 'payment', 'journal', 'contra'] as const).find((k) => k === params.type) ?? 'receipt')
  const [date, setDate] = useState(toInputDate(Date.now()))
  const [narration, setNarration] = useState('')
  const [amount, setAmount] = useState('')
  const [mode, setMode] = useState<MoneyMode>('cash')
  const [counter, setCounter] = useState<Counter>(params.partyType === 'supplier' ? 'supplier' : params.partyType === 'customer' ? 'customer' : 'account')
  const [partyId, setPartyId] = useState(params.partyId ?? '')
  const [account, setAccount] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [jl, setJl] = useState<JLine[]>([{ account: '', debit: '', credit: '', partyId: '' }, { account: '', debit: '', credit: '', partyId: '' }])
  const [busy, setBusy] = useState(false)

  const effective: Counter = kind === 'receipt' && counter === 'account' && params.partyType ? 'customer' : counter
  const partyOptions = useMemo(() => (effective === 'supplier' ? suppliers : customers).map((p) => ({ value: p.id, label: p.name, sub: p.phone || undefined })), [effective, customers, suppliers])

  const journalLines: VoucherLine[] = useMemo(() => jl.map((l) => {
    const acc = l.account ? resolveAccount(ledger.chart, l.account) : null
    const party: { type: PartyType; id: string } | undefined = l.partyId && acc?.key === 'receivables' ? { type: 'customer', id: l.partyId } : l.partyId && acc?.key === 'payables' ? { type: 'supplier', id: l.partyId } : undefined
    return { account: l.account, ...(num(l.debit) ? { debit: round2(num(l.debit)) } : {}), ...(num(l.credit) ? { credit: round2(num(l.credit)) } : {}), ...(party ? { party } : {}) }
  }), [jl, ledger.chart])
  const diff = round2(voucherDebit(journalLines) - voucherCredit(journalLines))

  if (!can) return <Screen title="New voucher" back><T tone="mute">Vouchers are for the owner and managers.</T></Screen>

  function lines(): VoucherLine[] {
    const amt = round2(num(amount))
    if (kind === 'journal') return journalLines
    if (!(amt > 0)) throw new OpError('Enter the amount.')
    if (kind === 'contra') {
      if (!from || !to) throw new OpError('Choose where the money moves from and to.')
      if (from === to) throw new OpError('Choose two different accounts.')
      return contraLines(from, to, amt)
    }
    const party = effective === 'account' ? undefined : { type: effective as PartyType, id: partyId }
    if (party && !party.id) throw new OpError(`Choose the ${party.type}.`)
    if (!party && !account) throw new OpError('Choose the account.')
    return (kind === 'receipt' ? receiptLines : paymentLines)({ mode, amount: amt, ...(party ? { party } : { account }) })
  }

  function save() {
    try {
      setBusy(true)
      const l = lines()
      const when = toInputDate(Date.now()) === date ? Date.now() : fromInputDate(date)
      const { voucher } = perform((s, ctx) => createVoucher(s, { type: kind, date: when, narration, lines: l }, ctx))
      toast(`${voucher.no} saved`, 'ok')
      router.replace({ pathname: '/m/accounting/vouchers/[id]', params: { id: voucher.id } })
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not save the voucher', 'err') } finally { setBusy(false) }
  }

  const upd = (i: number, patch: Partial<JLine>) => setJl((a) => a.map((x, k) => (k === i ? { ...x, ...patch } : x)))
  const counterOptions: Array<{ value: Counter; label: string }> = [{ value: 'customer', label: 'Customer' }, { value: 'supplier', label: 'Supplier' }, { value: 'account', label: 'Other account' }]

  return (
    <Screen title="New voucher" back footer={<Button label="Post voucher" size="lg" block loading={busy} onPress={save} />}>
      <View style={{ gap: 14, paddingBottom: 18 }}>
        <Segmented compact value={kind} options={(['receipt', 'payment', 'journal', 'contra'] as Kind[]).map((k) => ({ value: k, label: VOUCHER_LABEL[k] }))} onChange={setKind} />
        <Field label="Date" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" autoCapitalize="none" />

        {kind === 'receipt' || kind === 'payment' ? (
          <>
            <View style={{ gap: 6 }}>
              <T v="label" tone="soft">{kind === 'receipt' ? 'RECEIVED FROM' : 'PAID TO'}</T>
              <Segmented compact value={effective} options={counterOptions} onChange={(v) => { setCounter(v); setPartyId('') }} />
            </View>
            {effective === 'account' ? <AccountSelect label="Account" value={account} onChange={setAccount} /> : <Select label={effective === 'supplier' ? 'Supplier' : 'Customer'} value={partyId} options={partyOptions} onChange={setPartyId} searchable placeholder="Choose" />}
            <MoneyField label="Amount" value={amount} onChange={setAmount} />
            <View style={{ gap: 6 }}>
              <T v="label" tone="soft">{kind === 'receipt' ? 'RECEIVED IN' : 'PAID FROM'}</T>
              <Segmented compact value={mode} options={MODES} onChange={setMode} />
            </View>
          </>
        ) : null}

        {kind === 'contra' ? (
          <>
            <AccountSelect label="From" value={from} onChange={setFrom} only={['asset']} />
            <AccountSelect label="To" value={to} onChange={setTo} only={['asset']} />
            <MoneyField label="Amount" value={amount} onChange={setAmount} />
          </>
        ) : null}

        {kind === 'journal' ? (
          <Section title="Entries" action="Add line" onAction={() => setJl((a) => [...a, { account: '', debit: '', credit: '', partyId: '' }])}>
            {jl.map((l, i) => {
              const acc = l.account ? resolveAccount(ledger.chart, l.account) : null
              const people = acc?.key === 'receivables' ? customers : acc?.key === 'payables' ? suppliers : null
              return (
                <Card key={i} style={{ gap: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
                    <View style={{ flex: 1 }}><AccountSelect label={`Line ${i + 1}`} value={l.account} onChange={(account) => upd(i, { account, partyId: '' })} /></View>
                    {jl.length > 2 ? <IconButton label="Remove line" onPress={() => setJl((a) => a.filter((_, k) => k !== i))}><Close size={18} color={c.ink} /></IconButton> : null}
                  </View>
                  {people ? <Select label={acc?.key === 'payables' ? 'Supplier' : 'Customer'} value={l.partyId} options={people.map((p) => ({ value: p.id, label: p.name }))} onChange={(partyId) => upd(i, { partyId })} searchable placeholder="Whose account?" /> : null}
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <MoneyField label="Debit" value={l.debit} onChange={(debit) => upd(i, { debit, credit: debit ? '' : l.credit })} containerStyle={{ flex: 1 }} />
                    <MoneyField label="Credit" value={l.credit} onChange={(credit) => upd(i, { credit, debit: credit ? '' : l.debit })} containerStyle={{ flex: 1 }} />
                  </View>
                </Card>
              )
            })}
            <Card tone={diff === 0 ? undefined : 'warning'} style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T tone="soft">Debits</T><T v="num">{inr(voucherDebit(journalLines), 2)}</T></View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T tone="soft">Credits</T><T v="num">{inr(voucherCredit(journalLines), 2)}</T></View>
              {diff !== 0 ? <T v="caption" tone="warning">Difference {inr(Math.abs(diff), 2)} — debits and credits must be equal.</T> : null}
            </Card>
          </Section>
        ) : null}

        <Field label="Narration" value={narration} onChangeText={setNarration} placeholder="What is this for?" multiline />
        <Notice tone="primary" title="Vouchers are final" body="A posted voucher is never edited. If it was wrong, reverse it and post a new one." />
      </View>
    </Screen>
  )
}
