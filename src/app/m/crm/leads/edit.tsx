import React, { useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { perform, useApp, useCan } from '@/data/store'
import { Button } from '@/ui/Button'
import { Field, MoneyField, Select } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Chip } from '@/ui/primitives'
import { T } from '@/ui/Text'
import { toast } from '@/ui/overlays'
import { saveLead } from '@/modules/crm/ops'
import { DateField, dateText, dateValue, failWith } from '@/modules/crm/ui/forms'

const SOURCES = ['Walk-in', 'Referral', 'Instagram', 'WhatsApp', 'Phone call', 'Website']

/** Add or change a lead. */
export default function LeadEdit() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id?: string }>()
  const can = useCan('customers')
  const existing = useApp((s) => (id ? s.data.crmLeads?.[id] : undefined))
  const users = useApp((s) => Object.values(s.data.users).filter((u) => u.active))
  const [name, setName] = useState(existing?.name ?? '')
  const [phone, setPhone] = useState(existing?.phone ?? '')
  const [email, setEmail] = useState(existing?.email ?? '')
  const [source, setSource] = useState(existing?.source ?? '')
  const [value, setValue] = useState(existing?.value ? String(existing.value) : '')
  const [follow, setFollow] = useState(dateText(existing?.nextFollowUp))
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [assignee, setAssignee] = useState(existing?.assignedTo ?? '')

  if (!can) return <Screen title="Lead" back><T tone="mute">Leads are for people who use the billing counter.</T></Screen>
  function save() {
    try {
      const r = perform((s, ctx) => saveLead(s, { name, phone, email, source, value: Number(value) || 0, notes, ...(dateValue(follow) !== undefined ? { nextFollowUp: dateValue(follow) } : {}), ...(assignee ? { assignedTo: assignee } : {}) }, id, ctx))
      toast(existing ? 'Lead saved' : `${r.lead.no} added`, 'ok')
      if (existing) router.back(); else router.replace({ pathname: '/m/crm/leads/[id]', params: { id: r.lead.id } })
    } catch (e) { failWith(e) }
  }
  return (
    <Screen title={existing ? 'Edit lead' : 'New lead'} back footer={<Button label="Save lead" size="lg" block onPress={save} />}>
      <View style={{ gap: 14, paddingBottom: 12 }}>
        <Field label="Name" value={name} onChangeText={setName} autoCapitalize="words" />
        <Field label="Mobile number" value={phone} onChangeText={(t) => setPhone(t.replace(/[^\d+ ]/g, ''))} keyboardType="phone-pad" placeholder="10 digits" />
        <Field label="Email (optional)" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
        <View style={{ gap: 8 }}>
          <Field label="Where did they come from?" value={source} onChangeText={setSource} autoCapitalize="sentences" />
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>{SOURCES.map((x) => <Chip key={x} label={x} selected={source === x} onPress={() => setSource(x)} />)}</View>
        </View>
        <MoneyField label="What might they spend? (optional)" value={value} onChange={setValue} />
        <DateField label="Follow up on" value={follow} onChange={setFollow} hint="You will be reminded on this day." />
        {users.length > 1 ? <Select label="Looked after by" value={assignee} placeholder="Anyone" options={[{ value: '', label: 'Anyone' }, ...users.map((u) => ({ value: u.id, label: u.name }))]} onChange={setAssignee} /> : null}
        <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline autoCapitalize="sentences" />
      </View>
    </Screen>
  )
}
