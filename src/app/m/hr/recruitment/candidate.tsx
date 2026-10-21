import React, { useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { fmtDateTime } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useCan } from '@/data/store'
import { STAGES, STAGE_LABEL } from '@/modules/hr/logic/recruitment'
import { atTime, ymdOf } from '@/modules/hr/logic/ymd'
import { addInterview, hireCandidate, moveCandidate, saveCandidate } from '@/modules/hr/ops'
import type { CandidateStage } from '@/modules/hr/types'
import { act, Denied, useHr } from '@/modules/hr/ui/common'
import { Button } from '@/ui/Button'
import { Field, MoneyField } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Badge, Card, Chip } from '@/ui/primitives'
import { KV, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { WEEKDAYS } from '@/modules/hr/logic/ymd'

/** A candidate: details, stage, interviews, and hiring. */
export default function CandidatePage() {
  const router = useRouter()
  const { id, openingId } = useLocalSearchParams<{ id?: string; openingId?: string }>()
  const can = useCan('hr')
  const { data, now } = useHr()
  const cur = id ? data.hrCandidates?.[id] : undefined
  const opening = data.hrOpenings?.[cur?.openingId ?? openingId ?? '']
  const [name, setName] = useState(cur?.name ?? '')
  const [phone, setPhone] = useState(cur?.phone ?? '')
  const [email, setEmail] = useState(cur?.email ?? '')
  const [source, setSource] = useState(cur?.source ?? '')
  const [expected, setExpected] = useState(cur?.expectedPay ? String(cur.expectedPay) : '')
  const [notes, setNotes] = useState(cur?.notes ?? '')
  const [iv, setIv] = useState(false)
  const [ivDate, setIvDate] = useState(ymdOf(now))
  const [ivTime, setIvTime] = useState('11:00')
  const [ivWith, setIvWith] = useState('')
  const [ivNote, setIvNote] = useState('')
  const [ivRating, setIvRating] = useState(0)
  const [offer, setOffer] = useState(false)
  const [offerPay, setOfferPay] = useState('')
  const [hire, setHire] = useState(false)
  const [joinDate, setJoinDate] = useState(ymdOf(now))
  const [off, setOff] = useState<number[]>([0])

  if (!can) return <Denied title="Candidate" who="Recruitment is for the owner and managers." />
  if (!opening) return <Denied title="Not found" who="This opening is no longer here." />

  function save() {
    const r = act((s, ctx) => saveCandidate(s, { openingId: opening!.id, name, phone, email, source, expectedPay: Number(expected) || 0, notes }, id, ctx), undefined)
    if (r) router.back()
  }
  const move = (stage: CandidateStage) => {
    if (stage === 'offer') { setOfferPay(cur?.offeredPay ? String(cur.offeredPay) : expected); setOffer(true); return }
    act((s, ctx) => moveCandidate(s, id!, stage, ctx), `Moved to ${STAGE_LABEL[stage]}`)
  }

  return (
    <Screen title={cur ? cur.name : 'New candidate'} subtitle={opening.title} back footer={<Button label={cur ? 'Save details' : 'Add candidate'} size="lg" block onPress={save} />}>
      <View style={{ gap: 14, paddingBottom: 12 }}>
        {cur ? (
          <>
            <Section title="Stage" style={{ marginTop: 0 }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {STAGES.filter((s) => s.value !== 'hired').map((s) => <Chip key={s.value} label={s.label} selected={cur.stage === s.value} onPress={() => cur.stage !== s.value && cur.stage !== 'hired' && move(s.value)} />)}
                {cur.stage === 'hired' ? <Badge tone="success">Hired</Badge> : null}
              </View>
              {cur.stage !== 'hired' && cur.stage !== 'rejected' ? <Button label="Hire" kind="success" block onPress={() => setHire(true)} /> : null}
              {cur.offeredPay ? <T tone="mute">Offered {inr(cur.offeredPay, 0)} a month</T> : null}
              {cur.employeeId ? <Button label="Open employee" kind="outline" block onPress={() => router.push({ pathname: '/m/hr/employees/[id]', params: { id: cur.employeeId! } } as never)} /> : null}
            </Section>
            <Section title="Interviews" action="Add" onAction={() => { setIvWith(''); setIvNote(''); setIvRating(0); setIv(true) }} style={{ marginTop: 0 }}>
              {cur.interviews.length ? <Card>{cur.interviews.map((i, k) => <KV key={k} k={fmtDateTime(i.at)} v={i.rating ? `${i.rating}/5` : '—'} sub={[i.with && `with ${i.with}`, i.mode, i.note].filter(Boolean).join(' · ')} />)}</Card> : <T tone="mute">None yet.</T>}
            </Section>
          </>
        ) : null}
        <Field label="Name" value={name} onChangeText={setName} autoCapitalize="words" />
        <Field label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        <Field label="Email (optional)" value={email} onChangeText={setEmail} autoCapitalize="none" />
        <Field label="Heard about us from" value={source} onChangeText={setSource} placeholder="Walk-in, referral, job site…" />
        <MoneyField label="Expected pay per month" value={expected} onChange={setExpected} />
        <Field label="Notes" value={notes} onChangeText={setNotes} multiline />
      </View>

      <Sheet visible={iv} onClose={() => setIv(false)} title="Interview" footer={<View style={{ padding: 16 }}><Button label="Save" size="lg" block onPress={() => { const t = atTime(ivDate, ivTime); if (act((s, ctx) => addInterview(s, id!, { at: t, with: ivWith, mode: 'in person', note: ivNote, rating: ivRating || undefined }, ctx), 'Interview saved')) setIv(false) }} /></View>}>
        <View style={{ gap: 14, paddingBottom: 12 }}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Field containerStyle={{ flex: 1 }} label="Date" value={ivDate} onChangeText={setIvDate} autoCapitalize="none" placeholder="YYYY-MM-DD" />
            <Field containerStyle={{ flex: 1 }} label="Time" value={ivTime} onChangeText={setIvTime} autoCapitalize="none" placeholder="11:00" />
          </View>
          <Field label="Interviewed by" value={ivWith} onChangeText={setIvWith} />
          <Field label="How it went" value={ivNote} onChangeText={setIvNote} multiline />
          <View style={{ flexDirection: 'row', gap: 8 }}>{[1, 2, 3, 4, 5].map((n) => <Chip key={n} label={String(n)} selected={ivRating === n} onPress={() => setIvRating(ivRating === n ? 0 : n)} />)}</View>
        </View>
      </Sheet>
      <Sheet visible={offer} onClose={() => setOffer(false)} title="Make an offer" footer={<View style={{ padding: 16 }}><Button label="Move to Offer" size="lg" block onPress={() => { if (act((s, ctx) => moveCandidate(s, id!, 'offer', ctx, Number(offerPay) || undefined), 'Offer made')) setOffer(false) }} /></View>}>
        <MoneyField label="Pay offered per month" value={offerPay} onChange={setOfferPay} />
      </Sheet>
      <Sheet visible={hire} onClose={() => setHire(false)} title="Hire" subtitle="They become an employee with a joining checklist. Set their pay terms next."
        footer={<View style={{ padding: 16 }}><Button label="Hire" size="lg" block onPress={() => { const r = act((s, ctx) => hireCandidate(s, id!, { joinDate, weeklyOff: off }, ctx), 'Hired'); if (r) { setHire(false); router.replace({ pathname: '/m/hr/employees/[id]', params: { id: r.employee.id } } as never) } }} /></View>}>
        <View style={{ gap: 14, paddingBottom: 12 }}>
          <Field label="Joining date" value={joinDate} onChangeText={setJoinDate} autoCapitalize="none" placeholder="YYYY-MM-DD" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{WEEKDAYS.map((d, i) => <Chip key={d} label={d} selected={off.includes(i)} onPress={() => setOff((w) => (w.includes(i) ? w.filter((x) => x !== i) : [...w, i]))} />)}</View>
          <T v="caption" tone="mute">Weekly off days</T>
        </View>
      </Sheet>
    </Screen>
  )
}
