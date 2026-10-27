import React from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDate, fmtDateTime } from '@/domain/dates'
import { inr } from '@/domain/money'
import type { Bill, Customer } from '@/domain/types'
import { listOf } from '@/data/state'
import { useApp } from '@/data/store'
import { Section } from '@/ui/blocks'
import { Card, Tap } from '@/ui/primitives'
import { T } from '@/ui/Text'
import { useTheme } from '@/ui/theme'
import { APPT_LABEL, apptTitle } from '../logic/appointments'
import { JOB_LABEL, isOpenJob } from '../logic/jobs'
import { customerBalance, packagesOf, packageStatus, sessionsLeft, STATUS_LABEL } from '../logic/packages'
import { linkOf } from '../hooks'

const Row = ({ onPress, title, sub, right }: { onPress: () => void; title: string; sub: string; right?: string }) => {
  const { c } = useTheme()
  return (
    <Tap onPress={onPress} style={{ flexDirection: 'row', gap: 8, padding: 14, borderTopWidth: 1, borderTopColor: c.line }}>
      <View style={{ flex: 1 }}><T v="bodyStrong" numberOfLines={1}>{title}</T><T v="caption" tone="mute" numberOfLines={1}>{sub}</T></View>
      {right ? <T v="num">{right}</T> : null}
    </Tap>
  )
}

/** On a customer's page: package balance, upcoming bookings and repairs in progress. */
export function CustomerServicesPanel({ customer }: { customer: Customer }) {
  const router = useRouter()
  const data = useApp((s) => s.data)
  const now = Date.now()
  const pkgs = packagesOf(data, customer.id).filter((p) => sessionsLeft(p) > 0 && packageStatus(p, now) !== 'expired')
  const appts = listOf(data.appointments ?? {}).filter((a) => a.customerId === customer.id && (a.status === 'booked' || a.status === 'confirmed') && a.end >= now).sort((a, b) => a.start - b.start).slice(0, 3)
  const jobs = listOf(data.jobCards ?? {}).filter((j) => j.customerId === customer.id && isOpenJob(j))
  if (!pkgs.length && !appts.length && !jobs.length) return null
  const bal = customerBalance(data, customer.id, now)
  return (
    <Section title="Services" style={{ marginTop: 6 }}>
      <Card padded={false}>
        {pkgs.length ? (
          <View style={{ padding: 14 }}>
            <T v="bodyStrong">{bal.sessions} session{bal.sessions === 1 ? '' : 's'} left in {bal.packages} package{bal.packages === 1 ? '' : 's'}</T>
            <T v="caption" tone="success">{inr(bal.value, 0)} paid for and not yet used{bal.nextExpiry ? ` · first expires ${fmtDate(bal.nextExpiry)}` : ''}</T>
          </View>
        ) : null}
        {pkgs.map((p) => (
          <Row key={p.id} onPress={() => router.push({ pathname: '/m/services/packages/[id]', params: { id: p.id } })} title={p.name} sub={`${sessionsLeft(p)} of ${p.sessions} left · ${STATUS_LABEL[packageStatus(p, now)]}${p.expiresAt ? ` · till ${fmtDate(p.expiresAt)}` : ''}`} />
        ))}
        {appts.map((a) => (
          <Row key={a.id} onPress={() => router.push({ pathname: '/m/services/appointments/[id]', params: { id: a.id } })} title={`${apptTitle(a)}`} sub={`${fmtDateTime(a.start)} · ${APPT_LABEL[a.status]}`} />
        ))}
        {jobs.map((j) => (
          <Row key={j.id} onPress={() => router.push({ pathname: '/m/services/jobs/[id]', params: { id: j.id } })} title={`${j.no} · ${j.title}`} sub={JOB_LABEL[j.status]} />
        ))}
      </Card>
    </Section>
  )
}

/** On a bill: the booking, repair or project it settles. */
export function BillServicesPanel({ bill }: { bill: Bill }) {
  const router = useRouter()
  const data = useApp((s) => s.data)
  const link = linkOf(bill)
  const a = link.appointmentId ? data.appointments?.[link.appointmentId] : undefined
  const j = link.jobCardId ? data.jobCards?.[link.jobCardId] : undefined
  const p = link.projectId ? data.projects?.[link.projectId] : undefined
  if (!a && !j && !p) return null
  return (
    <Section title="Came from" style={{ marginTop: 6 }}>
      <Card padded={false}>
        {a ? <Row onPress={() => router.push({ pathname: '/m/services/appointments/[id]', params: { id: a.id } })} title={`Appointment ${a.no}`} sub={`${apptTitle(a)} · ${fmtDateTime(a.start)}`} /> : null}
        {j ? <Row onPress={() => router.push({ pathname: '/m/services/jobs/[id]', params: { id: j.id } })} title={`Job card ${j.no}`} sub={`${j.title}${j.identifier ? ` · ${j.identifier}` : ''}`} /> : null}
        {p ? <Row onPress={() => router.push({ pathname: '/m/services/projects/[id]', params: { id: p.id } })} title={`Project ${p.no}`} sub={p.name} /> : null}
      </Card>
    </Section>
  )
}
