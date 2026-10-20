import React, { useState } from 'react'
import { View } from 'react-native'
import { useList } from '@/data/hooks'
import { OpError, type OpCtx } from '@/data/ops'
import type { Changes, DataState } from '@/data/state'
import { perform, useApp, useCan } from '@/data/store'
import { endOfDay, fmtDate, fromInputDate, toInputDate } from '@/domain/dates'
import { defaultFinancialYear, lockedThrough } from '@/modules/accounting/logic'
import { addPeriodLock, closeYear, deleteFinancialYear, removeLatestLock, saveFinancialYear } from '@/modules/accounting/ops'
import { Button } from '@/ui/Button'
import { Field } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Badge, Card } from '@/ui/primitives'
import { KV, Notice, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Lock, Plus, Unlock } from '@/ui/icons'
import { ask, toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

/** Financial years and period locks. A lock says "nothing on or before this day may be posted"; closing a year moves its profit to equity and locks it. */
export default function YearsPage() {
  const { c } = useTheme()
  const can = useCan('accounting')
  const owner = useCan('accountingLock')
  const years = useList('financialYears').sort((a, b) => b.start - a.start)
  const locks = useList('periodLocks').sort((a, b) => b.throughDate - a.throughDate)
  const data = useApp((s) => s.data)
  const through = lockedThrough(data)
  const [yearSheet, setYearSheet] = useState<{ id?: string; label: string; start: string; end: string } | null>(null)
  const [lockSheet, setLockSheet] = useState<{ date: string; note: string } | null>(null)

  if (!can) return <Screen title="Years & locks" back><T tone="mute">The books are for the owner and managers.</T></Screen>

  const run = <R extends { changes: Changes }>(fn: (s: DataState, ctx: OpCtx) => R, done: string) => {
    try { perform(fn); toast(done, 'ok'); return true } catch (e) { toast(e instanceof OpError ? e.message : 'Could not save', 'err'); return false }
  }
  const newYear = () => { const d = defaultFinancialYear(Date.now()); setYearSheet({ label: d.label, start: toInputDate(d.start), end: toInputDate(d.end) }) }
  const saveYear = () => {
    if (!yearSheet) return
    const start = fromInputDate(yearSheet.start), end = endOfDay(fromInputDate(yearSheet.end))
    if (!Number.isFinite(start) || !Number.isFinite(end)) return toast('Type the dates as YYYY-MM-DD.', 'err')
    if (run((s, ctx) => saveFinancialYear(s, { label: yearSheet.label, start, end }, yearSheet.id, ctx), 'Year saved')) setYearSheet(null)
  }
  async function close(id: string, label: string) {
    if (!(await ask({ title: `Close ${label}?`, message: 'Its profit moves to retained earnings and every date in it is locked. This cannot be undone.', confirm: 'Close the year', danger: true }))) return
    run((s, ctx) => closeYear(s, id, ctx), `${label} closed`)
  }
  async function remove(id: string, label: string) {
    if (await ask({ title: `Delete ${label}?`, confirm: 'Delete', danger: true })) run((s, ctx) => deleteFinancialYear(s, id, ctx), 'Year deleted')
  }
  const saveLock = () => {
    if (!lockSheet) return
    const d = fromInputDate(lockSheet.date)
    if (!Number.isFinite(d)) return toast('Type the date as YYYY-MM-DD.', 'err')
    if (run((s, ctx) => addPeriodLock(s, endOfDay(d), lockSheet.note, ctx), 'Period locked')) setLockSheet(null)
  }

  return (
    <Screen title="Years & locks" back>
      <View style={{ gap: 14, paddingBottom: 24 }}>
        <Card style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {through !== null ? <Lock size={18} color={c.primary} /> : <Unlock size={18} color={c.inkMute} />}
            <T v="bodyStrong">{through !== null ? `Locked through ${fmtDate(through)}` : 'Nothing is locked'}</T>
          </View>
          <T v="caption" tone="mute">Vouchers dated on or before the lock are refused — on every phone and on the server.</T>
          {owner ? (
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
              <View style={{ flex: 1 }}><Button label="Lock a period" kind="outline" block icon={<Lock size={18} color={c.ink} />} onPress={() => setLockSheet({ date: toInputDate(Date.now()), note: '' })} /></View>
              {locks.length ? <View style={{ flex: 1 }}><Button label="Unlock latest" kind="outline" block icon={<Unlock size={18} color={c.ink} />} onPress={() => run((s, ctx) => removeLatestLock(s, ctx), 'Unlocked')} /></View> : null}
            </View>
          ) : <T v="caption" tone="warning">Only the owner can lock or unlock a period.</T>}
        </Card>

        <Section title="Financial years" action={owner ? 'Add' : undefined} onAction={newYear}>
          {years.length ? years.map((y) => (
            <Card key={y.id} style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <T v="bodyStrong" style={{ flex: 1 }}>{y.label}</T>
                <Badge tone={y.status === 'closed' ? 'success' : 'primary'}>{y.status === 'closed' ? 'Closed' : 'Open'}</Badge>
              </View>
              <KV k="Runs" v={`${fmtDate(y.start)} – ${fmtDate(y.end)}`} />
              {y.status === 'open' && owner ? (
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
                  <View style={{ flex: 1 }}><Button label="Edit" kind="outline" block onPress={() => setYearSheet({ id: y.id, label: y.label, start: toInputDate(y.start), end: toInputDate(y.end) })} /></View>
                  <View style={{ flex: 1 }}><Button label="Close year" kind="danger" block onPress={() => void close(y.id, y.label)} /></View>
                  <Button label="Delete" kind="ghost" onPress={() => void remove(y.id, y.label)} />
                </View>
              ) : null}
            </Card>
          )) : (
            <Notice tone="primary" title="Using the standard April – March year" body={owner ? 'Add a financial year to close it at the year end and carry the profit forward.' : 'The owner can add a financial year.'} action={owner ? 'Add a year' : undefined} onAction={newYear} />
          )}
        </Section>

        {locks.length ? (
          <Section title="Lock history">
            <Card padded={false}>
              {locks.map((l, i) => (
                <View key={l.id} style={{ padding: 14, borderTopWidth: i ? 1 : 0, borderTopColor: c.line, gap: 2 }}>
                  <T v="bodyStrong">Through {fmtDate(l.throughDate)}</T>
                  <T v="caption" tone="mute">{l.note || 'No note'}</T>
                </View>
              ))}
            </Card>
          </Section>
        ) : null}
      </View>

      <Sheet visible={!!yearSheet} onClose={() => setYearSheet(null)} title={yearSheet?.id ? 'Edit financial year' : 'New financial year'} footer={<Button label="Save" size="lg" block icon={<Plus size={18} color={c.onPrimary} />} onPress={saveYear} />}>
        {yearSheet ? (
          <View style={{ gap: 14, paddingBottom: 16 }}>
            <Field label="Name" value={yearSheet.label} onChangeText={(label) => setYearSheet({ ...yearSheet, label })} />
            <Field label="Starts" value={yearSheet.start} onChangeText={(start) => setYearSheet({ ...yearSheet, start })} placeholder="YYYY-MM-DD" autoCapitalize="none" />
            <Field label="Ends" value={yearSheet.end} onChangeText={(end) => setYearSheet({ ...yearSheet, end })} placeholder="YYYY-MM-DD" autoCapitalize="none" />
          </View>
        ) : null}
      </Sheet>
      <Sheet visible={!!lockSheet} onClose={() => setLockSheet(null)} title="Lock a period" footer={<Button label="Lock" size="lg" block icon={<Lock size={18} color={c.onPrimary} />} onPress={saveLock} />}>
        {lockSheet ? (
          <View style={{ gap: 14, paddingBottom: 16 }}>
            <Field label="Lock everything up to and including" value={lockSheet.date} onChangeText={(date) => setLockSheet({ ...lockSheet, date })} placeholder="YYYY-MM-DD" autoCapitalize="none" />
            <Field label="Note" value={lockSheet.note} onChangeText={(note) => setLockSheet({ ...lockSheet, note })} placeholder="For example, September filed" />
          </View>
        ) : null}
      </Sheet>
    </Screen>
  )
}
