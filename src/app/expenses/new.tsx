import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { DAY, fmtDate, fromInputDate, toInputDate } from '@/domain/dates'
import { inr } from '@/domain/money'
import type { ExpenseMode } from '@/domain/types'
import { useConnected, useIndustry, useList } from '@/data/hooks'
import { addExpense, editExpense, OpError, removeExpense } from '@/data/ops'
import { perform, useApp, useCan } from '@/data/store'
import { Button } from '@/ui/Button'
import { Field, MoneyField, Segmented, Select, SwitchRow } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Card, Chip } from '@/ui/primitives'
import { KV, Notice, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Trash } from '@/ui/icons'
import { ask, toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

const MODES: Array<{ value: ExpenseMode; label: string }> = [{ value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI' }, { value: 'card', label: 'Card' }, { value: 'bank', label: 'Bank' }]

const dateMask = (t: string) => {
  const d = t.replace(/\D/g, '').slice(0, 8)
  return d.length > 6 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d.length > 4 ? `${d.slice(0, 4)}-${d.slice(4)}` : d
}

function dateError(s: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return 'Use year-month-day, e.g. 2026-10-19'
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d || y < 2000) return 'That date does not exist'
  if (dt.getTime() > Date.now()) return 'That date is in the future'
  return null
}

/** Record an expense, or open one (`?id=`). On a connected workspace the server keeps expenses as a permanent record, so an existing one is read-only there. */
export default function ExpenseForm() {
  const { c } = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id?: string }>()
  const pack = useIndustry()
  const connected = useConnected()
  const canExp = useCan('expenses')
  const existing = useApp((s) => (id ? s.data.expenses[id] : undefined))
  const expenses = useList('expenses')
  const users = useApp((s) => s.data.users)

  const [amount, setAmount] = useState(existing ? String(existing.amount) : '')
  const [category, setCategory] = useState(existing?.category ?? '')
  const [date, setDate] = useState(toInputDate(existing?.date ?? Date.now()))
  const [mode, setMode] = useState<ExpenseMode>(existing?.mode ?? 'cash')
  const [vendor, setVendor] = useState(existing?.vendor ?? '')
  const [note, setNote] = useState(existing?.note ?? '')
  const [recurring, setRecurring] = useState(existing?.recurring ?? false)
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)

  // The industry's own list first, then any other category the books already use.
  const categories = useMemo(() => {
    const extra = [...new Set(expenses.map((e) => e.category))].filter((x) => x && !pack.expenseCategories.includes(x))
    return [...pack.expenseCategories, ...extra]
  }, [expenses, pack.expenseCategories])

  if (id && !existing) return <Screen title="Not found" back><T tone="mute">This expense is no longer here.</T></Screen>
  if (!canExp) return <Screen title="Expenses" back><T tone="mute">Your role cannot record expenses.</T></Screen>

  if (existing && connected) {
    return (
      <Screen title={existing.category} subtitle={fmtDate(existing.date)} back>
        <View style={{ gap: 14, paddingTop: 4 }}>
          <Card style={{ alignItems: 'center', gap: 2 }}>
            <T v="label" tone="mute">AMOUNT</T>
            <T v="display">{inr(existing.amount)}</T>
          </Card>
          <Card>
            <KV k="Category" v={existing.category} />
            <KV k="Date" v={fmtDate(existing.date)} />
            <KV k="Paid by" v={MODES.find((m) => m.value === existing.mode)?.label ?? existing.mode} />
            {existing.vendor ? <KV k="Paid to" v={existing.vendor} /> : null}
            {existing.note ? <KV k="Note" v={existing.note} /> : null}
            {existing.recurring ? <KV k="Regular cost" v="Yes" /> : null}
            {users[existing.userId] ? <KV k="Recorded by" v={users[existing.userId].name} /> : null}
          </Card>
          <Notice tone="primary" title="Kept as a permanent record" body="Once an expense reaches the server it can’t be changed or deleted from the app. If you made a mistake, add a correcting entry." />
        </View>
      </Screen>
    )
  }

  const errors = {
    amount: !(Number(amount) > 0) ? 'Enter the amount' : null,
    category: !category ? 'Choose a category' : null,
    date: dateError(date),
  }
  const ok = !Object.values(errors).some(Boolean)

  // A cash expense logged today is stamped with the time, so it lands inside a drawer session opened earlier today.
  const stamp = () => {
    if (existing && toInputDate(existing.date) === date) return existing.date
    return date === toInputDate(Date.now()) ? Date.now() : fromInputDate(date)
  }

  function save() {
    setTried(true)
    if (!ok) { toast('Fill the highlighted fields to continue', 'err'); return }
    setBusy(true)
    const draft = { date: stamp(), category, amount: Number(amount), mode, vendor: vendor.trim(), note: note.trim(), recurring }
    try {
      if (existing) perform((s) => editExpense(s, existing.id, draft))
      else perform((_s, ctx) => addExpense(draft, ctx))
      toast(existing ? 'Saved' : `${category} · ${inr(draft.amount)} recorded`, 'ok')
      router.back()
    } catch (e) {
      toast(e instanceof OpError ? e.message : 'Could not save', 'err')
      setBusy(false)
    }
  }

  async function remove() {
    if (!existing) return
    if (!(await ask({ title: 'Delete this expense?', message: `${existing.category} · ${inr(existing.amount)} will be removed from your books.`, confirm: 'Delete', danger: true }))) return
    try {
      perform(() => removeExpense(existing.id))
      toast('Expense deleted', 'ok')
      router.back()
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not delete', 'err') }
  }

  const today = toInputDate(Date.now())
  const yesterday = toInputDate(Date.now() - DAY)

  return (
    <Screen title={existing ? 'Edit expense' : 'New expense'} back
      right={existing ? <Button label="Delete" kind="danger" size="sm" icon={<Trash size={16} color={c.danger} />} onPress={remove} /> : undefined}
      footer={<Button label={existing ? 'Save changes' : 'Record expense'} size="lg" block loading={busy} onPress={save} />}>
      <View style={{ gap: 6, paddingBottom: 12 }}>
        <MoneyField label="Amount" value={amount} onChange={setAmount} large autoFocus={!existing} error={tried ? errors.amount : null} />

        <Section title="Details" style={{ marginTop: 14 }}>
          <View style={{ gap: 14 }}>
            <Select<string> label="Category" value={category} placeholder="Choose a category" options={categories.map((x) => ({ value: x, label: x }))} onChange={setCategory} error={tried ? errors.category : null} />
            <View>
              <T v="label" tone="soft" style={{ marginBottom: 6 }}>Paid by</T>
              <Segmented<ExpenseMode> value={mode} onChange={setMode} options={MODES} />
              {mode === 'cash' ? <T v="caption" tone="mute" style={{ marginTop: 6 }}>Cash expenses are taken off the drawer at day close.</T> : null}
            </View>
            <View style={{ gap: 8 }}>
              <Field label="Date" value={date} onChangeText={(t) => setDate(dateMask(t))} keyboardType="number-pad" placeholder="YYYY-MM-DD" mono error={tried ? errors.date : null} />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Chip label="Today" selected={date === today} onPress={() => setDate(today)} />
                <Chip label="Yesterday" selected={date === yesterday} onPress={() => setDate(yesterday)} />
              </View>
            </View>
          </View>
        </Section>

        <Section title="Optional" style={{ marginTop: 14 }}>
          <View style={{ gap: 14 }}>
            <Field label="Paid to" value={vendor} onChangeText={setVendor} autoCapitalize="words" placeholder="Landlord, electricity board…" />
            <Field label="Note" value={note} onChangeText={setNote} multiline autoCapitalize="sentences" />
          </View>
          <Card padded={false} style={{ marginTop: 14 }}>
            <SwitchRow title="Regular cost" subtitle="Rent, salaries and other costs that come back every month" value={recurring} onChange={setRecurring} />
          </Card>
        </Section>

        {connected && !existing ? <T v="caption" tone="mute" style={{ marginTop: 12 }}>Expenses sync to your server and are kept as a permanent record, so double-check the amount before saving.</T> : null}
      </View>
    </Screen>
  )
}
