import React from 'react'
import { View } from 'react-native'
import { fmtDateTime } from '@/domain/dates'
import { inr } from '@/domain/money'
import { STAGES } from '@/modules/hr/logic/recruitment'
import type { Candidate, CandidateStage, Opening } from '@/modules/hr/types'
import { Button } from '@/ui/Button'
import { Field, MoneyField } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { Chip } from '@/ui/primitives'
import { KV, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { useTheme } from '@/ui/theme'
import { DeskButton, Pill } from './kit'
import { DesktopSettingsPage } from './SettingsPage'

export interface DesktopCandidateProps {
  cur: Candidate | undefined
  opening: Opening
  name: string; setName: (v: string) => void
  phone: string; setPhone: (v: string) => void
  email: string; setEmail: (v: string) => void
  source: string; setSource: (v: string) => void
  expected: string; setExpected: (v: string) => void
  notes: string; setNotes: (v: string) => void
  iv: boolean; setIv: (v: boolean) => void
  ivDate: string; setIvDate: (v: string) => void
  ivTime: string; setIvTime: (v: string) => void
  ivWith: string; setIvWith: (v: string) => void
  ivNote: string; setIvNote: (v: string) => void
  ivRating: number; setIvRating: (v: number) => void
  offer: boolean; setOffer: (v: boolean) => void
  offerPay: string; setOfferPay: (v: string) => void
  hire: boolean; setHire: (v: boolean) => void
  joinDate: string; setJoinDate: (v: string) => void
  off: number[]; setOff: (v: number[] | ((w: number[]) => number[])) => void
  weekdays: readonly string[]
  onSave: () => void
  onMove: (stage: CandidateStage) => void
  onSaveInterview: () => void
  onSaveOffer: () => void
  onHire: () => void
  onOpenEmployee: () => void
}

/** The desktop candidate screen: profile form + stage/interviews, in the settings shell — the same `move`/`hire`/
 * `addInterview` handlers the phone screen uses, just reached from desktop chrome. */
export function DesktopCandidate(p: DesktopCandidateProps) {
  const { c } = useTheme()
  const { cur } = p

  return (
    <DesktopSettingsPage title={cur ? cur.name : 'New candidate'} subtitle={p.opening.title} right={<DeskButton label={cur ? 'Save details' : 'Add candidate'} tone="primary" onPress={p.onSave} />}>
      <View style={{ gap: 14 }}>
        {cur ? (
          <>
            <Section title="Stage" style={{ marginTop: 0 }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {STAGES.filter((s) => s.value !== 'hired').map((s) => <Chip key={s.value} label={s.label} selected={cur.stage === s.value} onPress={() => cur.stage !== s.value && cur.stage !== 'hired' && p.onMove(s.value)} />)}
                {cur.stage === 'hired' ? <Pill tone="success" label="Hired" /> : null}
              </View>
              {cur.stage !== 'hired' && cur.stage !== 'rejected' ? <DeskButton label="Hire" tone="primary" onPress={() => p.setHire(true)} /> : null}
              {cur.offeredPay ? <T tone="mute">Offered {inr(cur.offeredPay, 0)} a month</T> : null}
              {cur.employeeId ? <DeskButton label="Open employee" onPress={p.onOpenEmployee} /> : null}
            </Section>
            <Section title="Interviews" action="Add" onAction={() => { p.setIvWith(''); p.setIvNote(''); p.setIvRating(0); p.setIv(true) }} style={{ marginTop: 0 }}>
              {cur.interviews.length ? (
                <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}>
                  {cur.interviews.map((i, k) => <KV key={k} k={fmtDateTime(i.at)} v={i.rating ? `${i.rating}/5` : '—'} sub={[i.with && `with ${i.with}`, i.mode, i.note].filter(Boolean).join(' · ')} />)}
                </View>
              ) : <T tone="mute">None yet.</T>}
            </Section>
          </>
        ) : null}
        <Field label="Name" value={p.name} onChangeText={p.setName} autoCapitalize="words" />
        <Field label="Phone" value={p.phone} onChangeText={p.setPhone} keyboardType="phone-pad" />
        <Field label="Email (optional)" value={p.email} onChangeText={p.setEmail} autoCapitalize="none" />
        <Field label="Heard about us from" value={p.source} onChangeText={p.setSource} placeholder="Walk-in, referral, job site…" />
        <MoneyField label="Expected pay per month" value={p.expected} onChange={p.setExpected} />
        <Field label="Notes" value={p.notes} onChangeText={p.setNotes} multiline />
      </View>

      <Sheet visible={p.iv} onClose={() => p.setIv(false)} title="Interview" footer={<View style={{ padding: 16 }}><Button label="Save" size="lg" block onPress={p.onSaveInterview} /></View>}>
        <View style={{ gap: 14, paddingBottom: 12 }}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Field containerStyle={{ flex: 1 }} label="Date" value={p.ivDate} onChangeText={p.setIvDate} autoCapitalize="none" placeholder="YYYY-MM-DD" />
            <Field containerStyle={{ flex: 1 }} label="Time" value={p.ivTime} onChangeText={p.setIvTime} autoCapitalize="none" placeholder="11:00" />
          </View>
          <Field label="Interviewed by" value={p.ivWith} onChangeText={p.setIvWith} />
          <Field label="How it went" value={p.ivNote} onChangeText={p.setIvNote} multiline />
          <View style={{ flexDirection: 'row', gap: 8 }}>{[1, 2, 3, 4, 5].map((n) => <Chip key={n} label={String(n)} selected={p.ivRating === n} onPress={() => p.setIvRating(p.ivRating === n ? 0 : n)} />)}</View>
        </View>
      </Sheet>
      <Sheet visible={p.offer} onClose={() => p.setOffer(false)} title="Make an offer" footer={<View style={{ padding: 16 }}><Button label="Move to Offer" size="lg" block onPress={p.onSaveOffer} /></View>}>
        <MoneyField label="Pay offered per month" value={p.offerPay} onChange={p.setOfferPay} />
      </Sheet>
      <Sheet visible={p.hire} onClose={() => p.setHire(false)} title="Hire" subtitle="They become an employee with a joining checklist. Set their pay terms next."
        footer={<View style={{ padding: 16 }}><Button label="Hire" size="lg" block onPress={p.onHire} /></View>}>
        <View style={{ gap: 14, paddingBottom: 12 }}>
          <Field label="Joining date" value={p.joinDate} onChangeText={p.setJoinDate} autoCapitalize="none" placeholder="YYYY-MM-DD" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{p.weekdays.map((d, i) => <Chip key={d} label={d} selected={p.off.includes(i)} onPress={() => p.setOff((w) => (w.includes(i) ? w.filter((x) => x !== i) : [...w, i]))} />)}</View>
          <T v="caption" tone="mute">Weekly off days</T>
        </View>
      </Sheet>
    </DesktopSettingsPage>
  )
}
