import React, { useMemo, useState } from 'react'
import { ScrollView, View } from 'react-native'
import { fmtDayShort, timeAgo } from '@/domain/dates'
import { perform, useApp, useCan } from '@/data/store'
import { whatsApp } from '@/features/share'
import { awaitingFeedback, feedbackList, feedbackRequest, isLowScore, npsClass, npsSummary } from '@/modules/crm/feedback'
import { captureFeedback } from '@/modules/crm/ops'
import { failWith } from '@/modules/crm/ui/forms'
import { Button } from '@/ui/Button'
import { Field, SwitchRow } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { Chip, Tap } from '@/ui/primitives'
import { T } from '@/ui/Text'
import { MessageCircle, Star } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'
import { DeskButton, DeskPage, dtext, KpiStrip, KpiTile, Pill, SplitPane, Toolbar } from './kit'

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i)

/**
 * The desktop Feedback & ratings screen: a KPI strip (recommend score, average rating), the "what customers said"
 * log in the main pane and the "ask these customers" queue in a side panel — instead of two stacked `Section`s —
 * with the same record-feedback sheet. Reads its own data directly, exactly like `DesktopPurchases`: every figure
 * comes from the same `npsSummary`/`awaitingFeedback` the phone `m/crm/feedback.tsx` calls.
 */
export function DesktopFeedback() {
  const { c } = useTheme()
  const can = useCan('customers')
  const data = useApp((s) => s.data)
  const [billId, setBillId] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [rating, setRating] = useState<number | undefined>()
  const [nps, setNps] = useState<number | undefined>()
  const [comment, setComment] = useState('')
  const [ticket, setTicket] = useState(true)
  const now = Date.now()
  const list = useMemo(() => feedbackList(data), [data])
  const sum = useMemo(() => npsSummary(list), [list])
  const waiting = useMemo(() => awaitingFeedback(data, now).slice(0, 15), [data, now])

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Feedback & ratings" />}>
        <View style={{ padding: 20 }}><T tone="mute">Feedback is for people who use the billing counter.</T></View>
      </DeskPage>
    )
  }

  const shop = data.store?.name ?? 'our shop'
  function start(id: string | null) { setBillId(id); setRating(undefined); setNps(undefined); setComment(''); setOpen(true) }
  function save() {
    try {
      const r = perform((s, ctx) => captureFeedback(s, { ...(billId ? { billId } : {}), ...(rating !== undefined ? { rating } : {}), ...(nps !== undefined ? { nps } : {}), comment, openTicket: ticket }, ctx))
      toast(r.ticket ? `Thanks — ${r.ticket.no} opened for the complaint` : 'Feedback saved', 'ok'); setOpen(false)
    } catch (e) { failWith(e) }
  }
  const low = isLowScore({ ...(rating !== undefined ? { rating } : {}), ...(nps !== undefined ? { nps } : {}) })

  return (
    <DeskPage
      toolbar={<Toolbar title="Feedback & ratings" right={<DeskButton label="Record" tone="primary" onPress={() => start(null)} />} />}
    >
      <KpiStrip>
        <KpiTile label="Recommend score" value={sum.score === null ? '—' : String(sum.score)} tone={sum.score !== null && sum.score < 0 ? 'danger' : 'success'} delta={sum.scored ? `${sum.promoters} fans · ${sum.detractors} unhappy` : 'Ask 0–10: would you recommend us?'} />
        <KpiTile label="Average rating" value={sum.avgRating === null ? '—' : `${sum.avgRating} ★`} delta={sum.rated ? `${sum.rated} rating${sum.rated === 1 ? '' : 's'}` : 'Stars out of 5'} />
      </KpiStrip>

      <SplitPane widths={['flex', 340]}>
        <View style={{ flex: 1, margin: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
          <View style={{ height: 30, borderBottomWidth: 1, borderBottomColor: c.lineStrong, backgroundColor: c.sunken, paddingHorizontal: 10, justifyContent: 'center' }}>
            <T style={[dtext.label, { color: c.inkMute }]}>What customers said</T>
          </View>
          {list.length ? (
            <ScrollView style={{ flex: 1 }}>
              {list.slice(0, 80).map((f, i) => {
                const cu = f.customerId ? data.customers[f.customerId] : undefined
                return (
                  <View key={f.id} style={{ paddingHorizontal: 12, paddingVertical: 10, backgroundColor: i % 2 ? c.surfaceAlt : 'transparent', borderBottomWidth: 1, borderBottomColor: c.line, gap: 4 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <T style={[dtext.cellStrong, { flex: 1 }]} numberOfLines={1}>{cu?.name ?? 'Walk-in'}</T>
                      {f.rating !== undefined ? <Pill tone={f.rating <= 2 ? 'danger' : f.rating >= 4 ? 'success' : 'warning'} label={`${f.rating} ★`} /> : null}
                      {f.nps !== undefined ? <Pill tone={npsClass(f.nps) === 'promoter' ? 'success' : npsClass(f.nps) === 'detractor' ? 'danger' : 'default'} label={`${f.nps}/10`} /> : null}
                    </View>
                    {f.comment ? <T style={dtext.cell}>{f.comment}</T> : null}
                    <T style={[dtext.tiny, { color: c.inkMute }]}>{timeAgo(f.at, now)}{f.ticketId ? ' · complaint opened' : ''}</T>
                  </View>
                )
              })}
            </ScrollView>
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <Star size={24} color={c.primary} />
              <T style={[dtext.cell, { color: c.inkMute }]}>No feedback yet</T>
            </View>
          )}
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 10 }}>
          <T style={[dtext.label, { color: c.inkMute }]}>Ask these customers</T>
          {waiting.length ? waiting.map((b) => {
            const cu = b.customerId ? data.customers[b.customerId] : undefined
            if (!cu) return null
            return (
              <View key={b.id} style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 10, gap: 8 }}>
                <View style={{ gap: 1 }}>
                  <T style={dtext.cellStrong} numberOfLines={1}>{cu.name}</T>
                  <T style={[dtext.tiny, { color: c.inkMute }]}>{b.no} · {fmtDayShort(b.date)}</T>
                </View>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Button label="Ask" kind="success" size="sm" icon={<MessageCircle size={14} color="#fff" />} onPress={() => void whatsApp(feedbackRequest(shop, cu.name, b.no), cu.phone)} />
                  <Button label="Record" kind="soft" size="sm" onPress={() => start(b.id)} />
                </View>
              </View>
            )
          }) : <T style={[dtext.tiny, { color: c.inkMute }]}>No one is waiting to be asked.</T>}
          <T style={[dtext.tiny, { color: c.inkMute, marginTop: 4 }]}>The message asks for a reply; when they answer, press Record and enter it.</T>
        </ScrollView>
      </SplitPane>

      <Sheet visible={open} onClose={() => setOpen(false)} title="Record feedback" full footer={<Button label="Save" size="lg" block onPress={save} />}>
        <View style={{ gap: 14, paddingBottom: 8 }}>
          {billId ? <T v="bodyStrong">{data.bills[billId]?.no}</T> : <T v="caption" tone="mute">Not linked to a bill. Record feedback from the list above to link it.</T>}
          <View><T v="label" tone="soft" style={{ marginBottom: 6 }}>Stars</T>
            <View style={{ flexDirection: 'row', gap: 8 }}>{range(1, 5).map((n) => <Tap key={n} onPress={() => setRating(rating === n ? undefined : n)} hitSlop={6} accessibilityLabel={`${n} stars`}><Star size={34} color={rating !== undefined && n <= rating ? c.warning : c.lineStrong} fill={rating !== undefined && n <= rating ? c.warning : 'none'} /></Tap>)}</View>
          </View>
          <View><T v="label" tone="soft" style={{ marginBottom: 6 }}>Would you recommend us? (0–10)</T>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>{range(0, 10).map((n) => <Chip key={n} label={String(n)} selected={nps === n} onPress={() => setNps(nps === n ? undefined : n)} />)}</View>
          </View>
          <Field label="What did they say? (optional)" value={comment} onChangeText={setComment} multiline autoCapitalize="sentences" />
          {low ? <SwitchRow title="Open a complaint" subtitle="Follow up with this customer" value={ticket} onChange={setTicket} /> : null}
        </View>
      </Sheet>
    </DeskPage>
  )
}
