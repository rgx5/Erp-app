import React, { useState } from 'react'
import { Linking, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { fmtDate } from '@/domain/dates'
import { inr } from '@/domain/money'
import { perform, useApp, useCan } from '@/data/store'
import { whatsApp } from '@/features/share'
import { Button } from '@/ui/Button'
import { Field } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Badge, Card, Chip } from '@/ui/primitives'
import { KV, Notice, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Check, MessageCircle, Pencil, Phone, Trash } from '@/ui/icons'
import { ask, toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'
import { followUpState, isOpenLead, stagesFrom, STAGE_LABEL } from '@/modules/crm/leads'
import { convertLead, deleteLead, moveLead, setFollowUp } from '@/modules/crm/ops'
import { DateField, dateText, dateValue, failWith } from '@/modules/crm/ui/forms'
import { STAGE_TONE } from '@/modules/crm/ui/tones'
import { NotesSection, TasksSection } from '@/modules/crm/ui/Work'

/** One lead: where it stands, what to do next, and the button that turns it into a customer. */
export default function LeadView() {
  const { c } = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const can = useCan('customers')
  const lead = useApp((s) => s.data.crmLeads?.[id])
  const shop = useApp((s) => s.data.store?.name ?? 'our shop')
  const [losing, setLosing] = useState(false)
  const [reason, setReason] = useState('')
  const [follow, setFollow] = useState('')
  const [dating, setDating] = useState(false)

  if (!can) return <Screen title="Lead" back><T tone="mute">Leads are for people who use the billing counter.</T></Screen>
  if (!lead) return <Screen title="Not found" back><T tone="mute">This lead is no longer here.</T></Screen>
  const open = isOpenLead(lead)
  const f = followUpState(lead, Date.now())

  const move = (stage: Parameters<typeof moveLead>[2], why = '') => {
    try { perform((s, ctx) => moveLead(s, lead.id, stage, ctx, why)); setLosing(false); setReason('') } catch (e) { failWith(e) }
  }
  function convert() {
    try {
      const r = perform((s, ctx) => convertLead(s, lead!.id, ctx))
      toast(r.existed ? `${r.customer.name} was already a customer — linked` : `${r.customer.name} is now a customer`, 'ok')
      router.replace({ pathname: '/customers/[id]', params: { id: r.customer.id } })
    } catch (e) { failWith(e) }
  }
  function saveDate(clear = false) {
    try { perform((s, ctx) => setFollowUp(s, lead!.id, clear ? null : dateValue(follow) ?? null, ctx)); setDating(false) } catch (e) { failWith(e) }
  }
  async function remove() {
    if (!(await ask({ title: 'Delete this lead?', message: 'Its notes stay in the log.', confirm: 'Delete', danger: true }))) return
    try { perform((s, ctx) => deleteLead(s, lead!.id, ctx)); router.back() } catch (e) { failWith(e) }
  }

  return (
    <Screen title={lead.name} subtitle={lead.no} back right={open ? <Button label="Edit" kind="soft" size="sm" icon={<Pencil size={15} color={c.primary} />} onPress={() => router.push({ pathname: '/m/crm/leads/edit', params: { id: lead.id } })} /> : undefined}>
      <View style={{ gap: 14, paddingBottom: 28 }}>
        <Card>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Badge tone={STAGE_TONE[lead.stage]}>{STAGE_LABEL[lead.stage]}</Badge>
            {lead.source ? <Badge>{lead.source}</Badge> : null}
          </View>
          <View style={{ marginTop: 8 }}>
            {lead.phone ? <KV k="Mobile" v={lead.phone} /> : null}
            {lead.email ? <KV k="Email" v={lead.email} /> : null}
            {lead.value > 0 ? <KV k="Might spend" v={inr(lead.value, 0)} /> : null}
            <KV k="Added" v={fmtDate(lead.createdAt)} />
            {lead.nextFollowUp !== undefined && open ? <KV k="Follow up" v={fmtDate(lead.nextFollowUp)} tone={f === 'overdue' ? 'danger' : f === 'today' ? 'warning' : undefined} /> : null}
            {lead.lostReason ? <KV k="Lost because" v={lead.lostReason} /> : null}
            {lead.notes ? <KV k="Notes" v={lead.notes} /> : null}
          </View>
          {lead.phone ? (
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              <Button label="Call" kind="soft" size="sm" icon={<Phone size={15} color={c.primary} />} onPress={() => void Linking.openURL(`tel:${lead.phone}`)} />
              <Button label="WhatsApp" kind="success" size="sm" icon={<MessageCircle size={15} color="#fff" />} onPress={() => void whatsApp(`Hello ${lead.name.split(' ')[0]}, this is ${shop}. Thank you for your interest.`, lead.phone)} />
            </View>
          ) : null}
        </Card>

        {f === 'overdue' || f === 'today' ? <Notice tone={f === 'overdue' ? 'danger' : 'warning'} title={f === 'overdue' ? 'Follow-up is late' : 'Follow up today'} body="Call or message them, then set the next date." action="Set date" onAction={() => { setFollow(dateText(lead.nextFollowUp)); setDating(true) }} /> : null}

        {lead.customerId ? (
          <Button label="Open the customer" kind="soft" block onPress={() => router.push({ pathname: '/customers/[id]', params: { id: lead.customerId as string } })} />
        ) : null}

        {open ? (
          <Section title="Move along" style={{ marginTop: 0 }}>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {stagesFrom(lead).filter((s) => s !== 'lost').map((s) => <Chip key={s} label={STAGE_LABEL[s]} onPress={() => move(s)} />)}
              <Chip label="Follow-up date" onPress={() => { setFollow(dateText(lead.nextFollowUp)); setDating(true) }} />
              <Chip label="Lost" tone="danger" onPress={() => setLosing(true)} />
            </View>
            <Button label="Make a customer (won)" size="lg" block icon={<Check size={18} color={c.onPrimary} />} onPress={convert} style={{ marginTop: 12 }} />
          </Section>
        ) : lead.stage === 'lost' ? (
          <Button label="Reopen this lead" kind="soft" block onPress={() => move('new')} />
        ) : null}

        <TasksSection target={{ leadId: lead.id }} />
        <NotesSection target={{ leadId: lead.id }} />
        <Button label="Delete lead" kind="ghost" icon={<Trash size={16} color={c.danger} />} onPress={() => void remove()} />
      </View>

      <Sheet visible={losing} onClose={() => setLosing(false)} title="Why was it lost?" footer={<Button label="Mark as lost" kind="danger" size="lg" block onPress={() => move('lost', reason)} />}>
        <Field value={reason} onChangeText={setReason} autoCapitalize="sentences" placeholder="Too expensive, bought elsewhere…" />
      </Sheet>
      <Sheet visible={dating} onClose={() => setDating(false)} title="Follow up on" footer={<Button label="Save date" size="lg" block onPress={() => saveDate()} />}>
        <View style={{ gap: 12, paddingBottom: 8 }}>
          <DateField label="Date" value={follow} onChange={setFollow} />
          <Button label="Clear the date" kind="ghost" size="sm" onPress={() => saveDate(true)} />
        </View>
      </Sheet>
    </Screen>
  )
}
