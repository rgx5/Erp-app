import React, { useMemo, useState } from 'react'
import { SectionList, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useList } from '@/data/hooks'
import { OpError, type OpCtx } from '@/data/ops'
import type { Changes, DataState } from '@/data/state'
import { perform, useCan } from '@/data/store'
import { inr } from '@/domain/money'
import { EXPENSE_PREFIX, isDebitNormal, resolveAccount, TYPE_LABEL, TYPE_ORDER } from '@/modules/accounting/chart'
import { closingSigned, onNormalSide } from '@/modules/accounting/ledger'
import { deleteAccount, saveAccount, seedChart, syncExpenseAccounts } from '@/modules/accounting/ops'
import type { Account, AccountType } from '@/modules/accounting/types'
import { useLedger } from '@/modules/accounting/ui/hooks'
import { GST_PAYMENT_CATEGORY } from '@/domain/analytics'
import { Button, IconButton } from '@/ui/Button'
import { Field, MoneyField, Segmented, SwitchRow } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Badge } from '@/ui/primitives'
import { EmptyState, ListRow, Notice } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { BookOpen, Plus, Trash } from '@/ui/icons'
import { ask, toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

interface Draft { id?: string; code: string; name: string; type: AccountType; opening: string; active: boolean; direct: boolean; system: boolean }
const blank: Draft = { code: '', name: '', type: 'expense', opening: '', active: true, direct: false, system: false }

/** The chart of accounts: every account documents post to, with its balance. Built-in accounts can be renamed and switched off. */
export default function ChartPage() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('accounting')
  const ledger = useLedger()
  const expenses = useList('expenses')
  const [draft, setDraft] = useState<Draft | null>(null)

  const sections = useMemo(() => TYPE_ORDER.map((t) => ({ type: t, title: TYPE_LABEL[t], data: ledger.chart.filter((a) => a.type === t).sort((a, b) => a.code.localeCompare(b.code)) })).filter((s) => s.data.length), [ledger.chart])
  const missing = useMemo(() => {
    if (!ledger.persisted) return 0
    const cats = new Set(expenses.filter((e) => e.category !== GST_PAYMENT_CATEGORY).map((e) => `${EXPENSE_PREFIX}${e.category || 'Other'}`))
    return [...cats].filter((k) => !resolveAccount(ledger.chart, k)).length
  }, [ledger, expenses])

  if (!can) return <Screen title="Chart of accounts" back><T tone="mute">The books are for the owner and managers.</T></Screen>

  const run = <R extends { changes: Changes }>(fn: (s: DataState, ctx: OpCtx) => R, done: string) => {
    try { perform(fn); toast(done, 'ok'); return true } catch (e) { toast(e instanceof OpError ? e.message : 'Could not save', 'err'); return false }
  }
  const edit = (a: Account) => setDraft({ id: a.id, code: a.code, name: a.name, type: a.type, opening: a.openingBalance ? String(a.openingBalance) : '', active: a.active, direct: a.group === 'Cost of sales', system: a.system })
  const save = () => {
    if (!draft) return
    const opening = draft.opening.trim() === '' ? 0 : Number(draft.opening)
    const ok = run((s, ctx) => saveAccount(s, { code: draft.code, name: draft.name, type: draft.type, openingBalance: opening, active: draft.active, ...(draft.type === 'expense' ? { group: draft.direct ? 'Cost of sales' : '' } : {}) }, draft.id, ctx), 'Account saved')
    if (ok) setDraft(null)
  }
  async function remove() {
    if (!draft?.id || !(await ask({ title: `Delete ${draft.name}?`, message: 'Only accounts with no entries can be deleted.', confirm: 'Delete', danger: true }))) return
    if (run((s, ctx) => deleteAccount(s, draft.id!, ctx), 'Account deleted')) setDraft(null)
  }

  return (
    <Screen title="Chart of accounts" subtitle={ledger.persisted ? `${ledger.chart.length} accounts` : 'Not set up yet'} back scroll={false}
      right={ledger.persisted ? <IconButton label="New account" tone="dark" onPress={() => setDraft(blank)}><Plus size={22} color={c.bg} /></IconButton> : undefined}>
      {!ledger.persisted ? (
        <View style={{ gap: 12, paddingBottom: 12 }}>
          <Notice tone="primary" title="The books already work" body="Sales, purchases and expenses are posted to a standard chart. Save it to rename accounts, add your own and enter opening balances." />
          <Button label="Set up the chart of accounts" block onPress={() => run((s, ctx) => seedChart(s, ctx), 'Chart of accounts saved')} />
        </View>
      ) : missing ? (
        <View style={{ paddingBottom: 12 }}><Notice tone="warning" title={`${missing} expense ${missing === 1 ? 'category has' : 'categories have'} no account`} body="Until they do, those expenses sit in Suspense." action="Add accounts" onAction={() => run((s, ctx) => syncExpenseAccounts(s, ctx), 'Accounts added')} /></View>
      ) : null}
      <SectionList sections={sections} keyExtractor={(a) => a.id} stickySectionHeadersEnabled={false} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 28 }}
        ListEmptyComponent={<EmptyState icon={<BookOpen size={26} color={c.primary} />} title="No accounts" />}
        renderSectionHeader={({ section }) => <T v="label" tone="soft" style={{ marginTop: 14, marginBottom: 6 }}>{section.title.toUpperCase()}</T>}
        renderItem={({ item: a, index, section }) => {
          const bal = onNormalSide(a, closingSigned(ledger, a.id))
          return (
            <View style={{ backgroundColor: c.surface, borderTopLeftRadius: index === 0 ? 16 : 0, borderTopRightRadius: index === 0 ? 16 : 0, borderBottomLeftRadius: index === section.data.length - 1 ? 16 : 0, borderBottomRightRadius: index === section.data.length - 1 ? 16 : 0, borderWidth: 1, borderColor: c.line, marginTop: -1, overflow: 'hidden' }}>
              <ListRow title={`${a.code}  ${a.name}`} subtitle={a.active ? undefined : 'Switched off'} value={bal ? inr(bal, 2) : undefined} valueTone={bal < 0 ? 'danger' : undefined}
                badge={a.system ? <Badge>Built in</Badge> : undefined} chevron dense onPress={ledger.persisted ? () => edit(a) : () => router.push({ pathname: '/m/accounting/ledger/[id]', params: { id: a.id } })} />
            </View>
          )
        }} />

      <Sheet visible={!!draft} onClose={() => setDraft(null)} title={draft?.id ? 'Edit account' : 'New account'} full
        footer={<Button label="Save" size="lg" block onPress={save} />}>
        {draft ? (
          <View style={{ gap: 14, paddingBottom: 16 }}>
            <Field label="Number" value={draft.code} onChangeText={(code) => setDraft({ ...draft, code })} keyboardType="number-pad" editable={!draft.system} hint={draft.system ? 'The number of a built-in account stays fixed.' : 'The number you know it by, like 6500.'} />
            <Field label="Name" value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} />
            {draft.system ? <T v="caption" tone="mute">Kind: {TYPE_LABEL[draft.type]} (fixed for built-in accounts)</T> : (
              <View style={{ gap: 6 }}>
                <T v="label" tone="soft">KIND</T>
                <Segmented compact value={draft.type} options={TYPE_ORDER.map((t) => ({ value: t, label: TYPE_LABEL[t] }))} onChange={(type) => setDraft({ ...draft, type })} />
              </View>
            )}
            {draft.type === 'expense' ? <SwitchRow title="Direct cost" subtitle="Counted in cost of sales, above gross profit" value={draft.direct} onChange={(direct) => setDraft({ ...draft, direct })} /> : null}
            <MoneyField label="Opening balance" value={draft.opening} onChange={(opening) => setDraft({ ...draft, opening })} hint={`On the ${isDebitNormal(draft.type) ? 'debit' : 'credit'} side. Leave empty if the books start from zero.`} />
            <SwitchRow title="In use" subtitle="Switched-off accounts are hidden from voucher forms" value={draft.active} onChange={(active) => setDraft({ ...draft, active })} />
            {draft.id ? <Button label="View ledger" kind="outline" block onPress={() => { const id = draft.id!; setDraft(null); router.push({ pathname: '/m/accounting/ledger/[id]', params: { id } }) }} /> : null}
            {draft.id && !draft.system ? <Button label="Delete account" kind="danger" block icon={<Trash size={18} color={c.danger} />} onPress={remove} /> : null}
          </View>
        ) : null}
      </Sheet>
    </Screen>
  )
}
