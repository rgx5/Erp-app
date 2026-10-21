import React, { useMemo } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { inrShort } from '@/domain/money'
import { useApp, useCan } from '@/data/store'
import { listOf } from '@/data/state'
import { Screen } from '@/ui/Screen'
import { Group } from '@/ui/primitives'
import { ListRow, Section, StatTile } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { ChartPie, Gift, Handshake, ListTodo, Megaphone, MessageSquare, Settings, Star, Ticket, Users } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { npsSummary } from '@/modules/crm/feedback'
import { pipelineSummary } from '@/modules/crm/leads'
import { crmAlerts } from '@/modules/crm/reports'
import { taskCounts } from '@/modules/crm/tasks'
import { ticketSummary } from '@/modules/crm/tickets'

/** Customers & CRM: what needs attention today, and the way into segments, leads, tasks, campaigns, tickets and feedback. */
export default function CrmHome() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('customers')
  const manage = useCan('crm')
  const data = useApp((s) => s.data)
  const now = Date.now()
  const fig = useMemo(() => ({
    tasks: taskCounts(data, now), pipe: pipelineSummary(data, now), tickets: ticketSummary(data, now), nps: npsSummary(listOf(data.crmFeedback ?? {})), alerts: crmAlerts(data, now),
    campaigns: listOf(data.crmCampaigns ?? {}).filter((x) => !x.closedAt).length,
  }), [data, now])

  if (!can) return <Screen title="Customers & CRM" back><T tone="mute">The customer tools are for people who use the billing counter.</T></Screen>
  const go = (to: string) => () => router.push(to as never)
  const due = fig.tasks.overdue + fig.tasks.today

  return (
    <Screen title="Customers & CRM" back>
      <View style={{ gap: 14, paddingBottom: 24 }}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <StatTile label="Tasks due" value={String(due)} tone={fig.tasks.overdue ? 'danger' : 'primary'} foot={fig.tasks.overdue ? `${fig.tasks.overdue} late` : 'Today and late'} icon={<ListTodo size={16} color={fig.tasks.overdue ? c.danger : c.primary} />} style={{ flex: 1 }} onPress={go('/m/crm/tasks')} />
          <StatTile label="Open tickets" value={String(fig.tickets.open)} tone={fig.tickets.breached ? 'danger' : 'primary'} foot={fig.tickets.breached ? `${fig.tickets.breached} past due time` : 'All within time'} icon={<Ticket size={16} color={fig.tickets.breached ? c.danger : c.primary} />} style={{ flex: 1 }} onPress={go('/m/crm/tickets')} />
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <StatTile label="Pipeline" value={inrShort(fig.pipe.open.value)} tone="accent" foot={`${fig.pipe.open.count} open lead${fig.pipe.open.count === 1 ? '' : 's'}`} icon={<Handshake size={16} color={c.accent} />} style={{ flex: 1 }} onPress={go('/m/crm/leads')} />
          <StatTile label="Recommend score" value={fig.nps.score === null ? '—' : String(fig.nps.score)} tone="success" foot={fig.nps.scored ? `${fig.nps.scored} replies` : 'No scores yet'} icon={<Star size={16} color={c.success} />} style={{ flex: 1 }} onPress={go('/m/crm/feedback')} />
        </View>

        <Section title="Customers" style={{ marginTop: 6 }}>
          <Group>
            <ListRow icon={<Users size={20} color="#fff" />} iconTone="success" title="Segments & groups" subtitle="Lapsed, high value, birthdays — and your own" onPress={go('/m/crm/segments')} />
            <ListRow icon={<Gift size={20} color="#fff" />} iconTone="accent" title="Referrals & membership" subtitle={fig.alerts.referralsReady ? `${fig.alerts.referralsReady} reward${fig.alerts.referralsReady === 1 ? '' : 's'} ready to give` : 'Codes, rewards and tiers'} onPress={go('/m/crm/referrals')} />
          </Group>
        </Section>
        <Section title="Selling" style={{ marginTop: 6 }}>
          <Group>
            <ListRow icon={<Handshake size={20} color="#fff" />} title="Leads & pipeline" subtitle={fig.pipe.overdue + fig.pipe.dueToday ? `${fig.pipe.overdue + fig.pipe.dueToday} follow-up${fig.pipe.overdue + fig.pipe.dueToday === 1 ? '' : 's'} due` : 'Stages and follow-up dates'} onPress={go('/m/crm/leads')} />
            <ListRow icon={<ListTodo size={20} color="#fff" />} title="Tasks & reminders" subtitle={`${fig.tasks.overdue} late · ${fig.tasks.today} today · ${fig.tasks.upcoming} later`} onPress={go('/m/crm/tasks')} />
            {manage ? <ListRow icon={<Megaphone size={20} color="#fff" />} iconTone="warning" title="Campaigns" subtitle={fig.campaigns ? `${fig.campaigns} still being sent` : 'WhatsApp or SMS to a segment'} onPress={go('/m/crm/campaigns')} /> : null}
          </Group>
        </Section>
        <Section title="After the sale" style={{ marginTop: 6 }}>
          <Group>
            <ListRow icon={<Ticket size={20} color="#fff" />} iconTone="warning" title="Complaints & warranty" subtitle="Tickets with a due time" onPress={go('/m/crm/tickets')} />
            <ListRow icon={<MessageSquare size={20} color="#fff" />} iconTone="success" title="Feedback & ratings" subtitle="Ask after a sale, track the score" onPress={go('/m/crm/feedback')} />
          </Group>
        </Section>
        {manage ? (
          <Group>
            <ListRow icon={<Settings size={20} color="#fff" />} iconTone="primary" title="CRM settings" subtitle="Ticket times, warranty, tiers, referral rewards" onPress={go('/m/crm/settings')} />
          </Group>
        ) : null}
        <T v="caption" tone="mute"><ChartPie size={12} color={c.inkMute} /> Messages open in WhatsApp or the messages app for a person to press send. Sending on its own needs the WhatsApp Business service or an SMS provider with your own keys.</T>
      </View>
    </Screen>
  )
}
