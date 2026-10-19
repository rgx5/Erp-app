import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { computeDayClose } from '@/domain/analytics'
import { dayCloseHtml, dayCloseText, varianceKind, varianceLabel, type VarianceKind } from '@/domain/dayclose-report'
import { dayLabel, fmtDate, fmtTime, startOfDay } from '@/domain/dates'
import { inr, inr0, round2 } from '@/domain/money'
import type { DaySession } from '@/domain/types'
import { useList, useStore } from '@/data/hooks'
import { closeDay, openDay, OpError } from '@/data/ops'
import { perform, useApp, useCan } from '@/data/store'
import { printHtml, sharePdf, whatsApp } from '@/features/share'
import { Button } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { MoneyField } from '@/ui/Inputs'
import { Badge, Card, Chip, Group, IconWell } from '@/ui/primitives'
import { EmptyState, KV, ListRow, Notice, Section } from '@/ui/blocks'
import { Sheet } from '@/ui/Sheet'
import { T } from '@/ui/Text'
import { Clock, FileText, Lock, Printer, Share, Sun, Unlock } from '@/ui/icons'
import { ask, toast } from '@/ui/overlays'
import { useTheme, type Tone } from '@/ui/theme'

const VARIANCE_TONE: Record<VarianceKind, Tone> = { none: 'default', balanced: 'success', short: 'danger', over: 'warning' }
const RECENT_SHOWN = 10

export default function DayClose() {
  const { c } = useTheme()
  const canReports = useCan('reports')
  const sessions = useList('sessions')
  const bills = useList('bills')
  const expenses = useList('expenses')
  const users = useApp((s) => s.data.users)

  const open = useMemo(() => sessions.find((s) => !s.closedAt), [sessions])
  const closed = useMemo(() => sessions.filter((s) => s.closedAt).sort((a, b) => b.closedAt! - a.closedAt!), [sessions])
  const figs = useMemo(() => computeDayClose(bills, expenses, open), [bills, expenses, open])
  const lastCounted = closed[0]?.countedCash

  const [opening, setOpening] = useState(lastCounted !== undefined ? String(lastCounted) : '')
  const [counted, setCounted] = useState('')
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<DaySession | null>(null)
  const [all, setAll] = useState(false)

  const name = (id?: string) => (id ? users[id]?.name : undefined)
  const variance = counted === '' ? undefined : round2(Number(counted) - figs.expected)
  const stale = !!open && startOfDay(open.openedAt) < startOfDay()

  if (!canReports) return <Screen title="Day close" back><EmptyState icon={<Clock size={26} color={c.primary} />} title="Not available" hint="Only the owner and managers can open and close the day." /></Screen>

  function start() {
    if (opening === '') { toast('Count the cash in the drawer first', 'err'); return }
    setBusy(true)
    try {
      perform((s, ctx) => openDay(s, Number(opening), ctx))
      toast('Day opened', 'ok')
      setCounted('')
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not open the day', 'err') }
    setBusy(false)
  }

  async function finish() {
    if (!open) return
    if (counted === '') { toast('Count the cash in the drawer first', 'err'); return }
    const v = round2(Number(counted) - figs.expected)
    const msg = v === 0
      ? `You counted ${inr(Number(counted))} and the books expect the same. Closing locks today’s figures.`
      : `You counted ${inr(Number(counted))} but the books expect ${inr(figs.expected)} — ${varianceLabel(v).toLowerCase()}. The difference is recorded. Closing locks today’s figures.`
    if (!(await ask({ title: 'Close the day?', message: msg, confirm: 'Close day', danger: v !== 0 }))) return
    setBusy(true)
    try {
      const r = perform((s, ctx) => closeDay(s, open.id, Number(counted), ctx))
      toast('Day closed', 'ok')
      setCounted(''); setOpening(String(r.session.countedCash ?? ''))
      setReport(r.session)
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not close the day', 'err') }
    setBusy(false)
  }

  const footer = open
    ? <Button label="Close day" size="lg" block loading={busy} disabled={counted === ''} icon={<Lock size={20} color="#fff" />} onPress={() => void finish()} />
    : <Button label="Open day" size="lg" block loading={busy} icon={<Unlock size={20} color="#fff" />} onPress={start} />

  return (
    <Screen title="Day close" subtitle={open ? `Open since ${dayLabel(open.openedAt).toLowerCase()}, ${fmtTime(open.openedAt)}` : 'Cash drawer'} back footer={footer}>
      <View style={{ gap: 14, paddingTop: 4 }}>
        {stale ? <Notice tone="warning" icon={<Clock size={20} color={c.warning} />} title="This day is still open from earlier" body="Count the drawer and close it so every day gets its own report." /> : null}

        {open ? (
          <>
            <Card style={{ gap: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Badge tone="success" icon={<Sun size={12} color={c.success} />}>Day open</Badge>
                <T v="caption" tone="mute">{name(open.openedBy) ? `Opened by ${name(open.openedBy)}` : fmtDate(open.openedAt)}</T>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
                <View>
                  <T v="label" tone="mute">SALES SINCE OPENING</T>
                  <T v="display">{inr0(figs.totalSales)}</T>
                </View>
                <T v="caption" tone="mute">{figs.bills} {figs.bills === 1 ? 'bill' : 'bills'}</T>
              </View>
            </Card>

            <Section title="What should be in the drawer" style={{ marginTop: 4 }}>
              <Card>
                <KV k="Opening cash" v={inr(figs.opening)} />
                <KV k="+ Cash received" v={inr(figs.cashIn)} sub="After change given back; refunds taken off" />
                <KV k="− Cash expenses" v={inr(figs.cashExpenses)} />
                <View style={{ height: 1, backgroundColor: c.line, marginVertical: 6 }} />
                <KV k="Expected in drawer" v={inr(figs.expected)} strong big />
              </Card>
              <T v="caption" tone="mute" style={{ marginTop: 8, paddingHorizontal: 2 }}>UPI and card payments of {inr(figs.digital)} went to the bank, not the drawer.</T>
            </Section>

            <Section title="Count the cash" style={{ marginTop: 4 }}>
              <MoneyField label="Cash in the drawer now" value={counted} onChange={setCounted} large hint="Count notes and coins, then enter the total" />
              {variance !== undefined ? (
                <View style={{ marginTop: 12 }}>
                  <Notice tone={VARIANCE_TONE[varianceKind(variance)]} title={varianceLabel(variance)}
                    body={variance === 0 ? 'The drawer matches the books exactly.' : variance < 0 ? 'Check for an unrecorded expense or a missed bill before closing.' : 'More cash than expected — check for a bill that was not recorded.'} />
                </View>
              ) : null}
            </Section>

            <Button label="Print day so far" kind="outline" icon={<Printer size={18} color={c.ink} />} onPress={() => setReport(open)} />
          </>
        ) : (
          <>
            <Card style={{ gap: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <IconWell tone="accent" size={46}><Sun size={22} color={c.accent} /></IconWell>
                <View style={{ flex: 1 }}>
                  <T v="h2">Start the day</T>
                  <T v="caption" tone="mute">{fmtDate(Date.now())}</T>
                </View>
              </View>
              <T tone="soft">Count the cash in the drawer and open the day. When you close, the app compares what you counted with what it expects.</T>
              <MoneyField label="Cash in the drawer now" value={opening} onChange={setOpening} large />
              {lastCounted !== undefined && Number(opening) !== lastCounted ? (
                <View style={{ flexDirection: 'row' }}><Chip label={`Use ${inr0(lastCounted)} from last close`} onPress={() => setOpening(String(lastCounted))} /></View>
              ) : null}
            </Card>
            <Notice tone="primary" title="Opening the day is optional" body="Bills can be made any time. Opening a day just lets you reconcile the cash drawer when you close." />
          </>
        )}

        {closed.length ? (
          <Section title="Past days" action={closed.length > RECENT_SHOWN ? (all ? 'Show less' : `All ${closed.length}`) : undefined} onAction={() => setAll(!all)} style={{ marginTop: 4 }}>
            <Group>
              {(all ? closed : closed.slice(0, RECENT_SHOWN)).map((s) => {
                const k = varianceKind(s.variance)
                return (
                  <ListRow key={s.id} icon={<FileText size={19} color={c.primary} />} title={fmtDate(s.closedAt!)} subtitle={`Counted ${inr0(s.countedCash ?? 0)} · closed by ${name(s.closedBy) ?? 'staff'}`}
                    badge={<Badge tone={VARIANCE_TONE[k]}>{k === 'balanced' ? 'Matched' : k === 'short' ? `Short ${inr0(Math.abs(s.variance ?? 0))}` : k === 'over' ? `Over ${inr0(s.variance ?? 0)}` : '—'}</Badge>}
                    onPress={() => setReport(s)} />
                )
              })}
            </Group>
          </Section>
        ) : null}
      </View>

      <ReportSheet session={report} onClose={() => setReport(null)} />
    </Screen>
  )
}

/** One day's figures, laid out as the Z-report (or the X-report while the day is still open), with print and share. */
function ReportSheet({ session, onClose }: { session: DaySession | null; onClose: () => void }) {
  const { c } = useTheme()
  const store = useStore()
  const bills = useList('bills')
  const expenses = useList('expenses')
  const users = useApp((s) => s.data.users)
  const figs = useMemo(() => (session ? computeDayClose(bills, expenses, session) : null), [bills, expenses, session])

  if (!session || !figs) return <Sheet visible={false} onClose={onClose} />
  const done = !!session.closedAt
  const doc = { store, session, figures: figs, openedBy: users[session.openedBy]?.name, closedBy: session.closedBy ? users[session.closedBy]?.name : undefined }
  const expected = done ? session.expectedCash ?? figs.expected : figs.expected
  const k = varianceKind(done ? session.variance : undefined)

  return (
    <Sheet visible onClose={onClose} title={done ? 'Day close report' : 'Day so far'} subtitle={fmtDate(session.closedAt ?? session.openedAt)}
      footer={(
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button label="WhatsApp" kind="success" icon={<Share size={18} color="#fff" />} onPress={() => void whatsApp(dayCloseText(doc))} />
          <Button label="Print" kind="outline" icon={<Printer size={18} color={c.ink} />} onPress={() => void printHtml(dayCloseHtml(doc))} />
          <View style={{ flex: 1 }}><Button label="PDF" kind="outline" block icon={<FileText size={18} color={c.ink} />} onPress={() => void sharePdf(dayCloseHtml(doc), `day-close-${fmtDate(session.closedAt ?? session.openedAt)}.pdf`)} /></View>
        </View>
      )}>
      <View style={{ gap: 14, paddingBottom: 8 }}>
        {done ? <Notice tone={VARIANCE_TONE[k]} title={varianceLabel(session.variance)} body={`Counted ${inr(session.countedCash ?? 0)} against ${inr(expected)} expected`} /> : null}
        <Card>
          <KV k="Bills" v={String(figs.bills)} />
          <KV k="Total sales" v={inr(figs.totalSales)} strong />
          <KV k="UPI + card" v={inr(figs.digital)} />
        </Card>
        <Card>
          <KV k="Opening cash" v={inr(figs.opening)} />
          <KV k="+ Cash received" v={inr(figs.cashIn)} />
          <KV k="− Cash expenses" v={inr(figs.cashExpenses)} />
          <KV k="Expected in drawer" v={inr(expected)} strong />
          {done ? <KV k="Counted" v={inr(session.countedCash ?? 0)} strong /> : null}
        </Card>
        <T v="caption" tone="mute">
          Opened {fmtTime(session.openedAt)}{doc.openedBy ? ` by ${doc.openedBy}` : ''}{done ? ` · closed ${fmtTime(session.closedAt!)}${doc.closedBy ? ` by ${doc.closedBy}` : ''}` : ''}
        </T>
      </View>
    </Sheet>
  )
}
