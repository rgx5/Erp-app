import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { fmtDayShort, timeAgo } from '@/domain/dates'
import { perform, useApp, useCan } from '@/data/store'
import { whatsApp } from '@/features/share'
import { Button } from '@/ui/Button'
import { Field, SwitchRow } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Avatar, Badge, Card, Chip, Group, Tap } from '@/ui/primitives'
import { EmptyState, Section, StatTile } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { MessageCircle, Star } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'
import { awaitingFeedback, feedbackList, feedbackRequest, isLowScore, npsClass, npsSummary } from '@/modules/crm/feedback'
import { captureFeedback } from '@/modules/crm/ops'
import { failWith } from '@/modules/crm/ui/forms'

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i)

/** Ratings after a sale: record what a customer said, ask the ones who were not asked, and watch the score. */
export default function Feedback() {
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

  if (!can) return <Screen title="Feedback" back><T tone="mute">Feedback is for people who use the billing counter.</T></Screen>
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
    <Screen title="Feedback & ratings" back right={<Button label="Record" size="sm" onPress={() => start(null)} />}>
      <View style={{ gap: 14, paddingBottom: 28 }}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <StatTile label="Recommend score" value={sum.score === null ? '—' : String(sum.score)} tone={sum.score !== null && sum.score < 0 ? 'danger' : 'success'} foot={sum.scored ? `${sum.promoters} fans · ${sum.detractors} unhappy` : 'Ask 0–10: would you recommend us?'} icon={<Star size={16} color={c.success} />} style={{ flex: 1 }} />
          <StatTile label="Average rating" value={sum.avgRating === null ? '—' : `${sum.avgRating} ★`} foot={sum.rated ? `${sum.rated} rating${sum.rated === 1 ? '' : 's'}` : 'Stars out of 5'} icon={<Star size={16} color={c.primary} />} style={{ flex: 1 }} />
        </View>

        {waiting.length ? (
          <Section title="Ask these customers" style={{ marginTop: 0 }}>
            <Group>
              {waiting.map((b) => {
                const cu = b.customerId ? data.customers[b.customerId] : undefined
                if (!cu) return null
                return (
                  <View key={b.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11 }}>
                    <Avatar name={cu.name} size={36} />
                    <View style={{ flex: 1 }}><T v="bodyStrong" numberOfLines={1}>{cu.name}</T><T v="caption" tone="mute">{b.no} · {fmtDayShort(b.date)}</T></View>
                    <Button label="Ask" kind="success" size="sm" icon={<MessageCircle size={14} color="#fff" />} onPress={() => void whatsApp(feedbackRequest(shop, cu.name, b.no), cu.phone)} />
                    <Button label="Record" kind="soft" size="sm" onPress={() => start(b.id)} />
                  </View>
                )
              })}
            </Group>
            <T v="caption" tone="mute" style={{ marginTop: 8 }}>The message asks for a reply; when they answer, tap Record and enter it. Collecting replies automatically needs a WhatsApp Business account on a server.</T>
          </Section>
        ) : null}

        <Section title="What customers said" style={{ marginTop: 0 }}>
          {list.length ? (
            <Group>
              {list.slice(0, 60).map((f) => {
                const cu = f.customerId ? data.customers[f.customerId] : undefined
                return (
                  <View key={f.id} style={{ padding: 14, gap: 4 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <T v="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>{cu?.name ?? 'Walk-in'}</T>
                      {f.rating !== undefined ? <Badge tone={f.rating <= 2 ? 'danger' : f.rating >= 4 ? 'success' : 'warning'}>{f.rating} ★</Badge> : null}
                      {f.nps !== undefined ? <Badge tone={npsClass(f.nps) === 'promoter' ? 'success' : npsClass(f.nps) === 'detractor' ? 'danger' : 'default'}>{f.nps}/10</Badge> : null}
                    </View>
                    {f.comment ? <T tone="soft">{f.comment}</T> : null}
                    <T v="caption" tone="mute">{timeAgo(f.at, now)}{f.ticketId ? ' · complaint opened' : ''}</T>
                  </View>
                )
              })}
            </Group>
          ) : (
            <EmptyState icon={<Star size={26} color={c.primary} />} title="No feedback yet" hint="After a sale, ask how it went. A low score can open a complaint so it gets fixed." action="Record feedback" onAction={() => start(null)} />
          )}
        </Section>
      </View>

      <Sheet visible={open} onClose={() => setOpen(false)} title="Record feedback" full footer={<Button label="Save" size="lg" block onPress={save} />}>
        <View style={{ gap: 14, paddingBottom: 8 }}>
          {billId ? <Card><T v="bodyStrong">{data.bills[billId]?.no}</T><T v="caption" tone="mute">{data.bills[billId]?.customerId ? data.customers[data.bills[billId].customerId as string]?.name : ''}</T></Card> : <T v="caption" tone="mute">Not linked to a bill. Record feedback from the list above to link it.</T>}
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
    </Screen>
  )
}
