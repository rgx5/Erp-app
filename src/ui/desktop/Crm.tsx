import React, { useMemo, type ComponentType } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { useRouter } from 'expo-router'
import { inrShort } from '@/domain/money'
import { useApp, useCan } from '@/data/store'
import { listOf } from '@/data/state'
import { npsSummary } from '@/modules/crm/feedback'
import { pipelineSummary } from '@/modules/crm/leads'
import { crmAlerts } from '@/modules/crm/reports'
import { taskCounts } from '@/modules/crm/tasks'
import { ticketSummary } from '@/modules/crm/tickets'
import { T } from '@/ui/Text'
import { Gift, Handshake, ListTodo, Megaphone, MessageSquare, Settings, Ticket, Users, type IconProps } from '@/ui/icons'
import { toneColor, toneTint, useTheme, type Tone } from '@/ui/theme'
import { DeskPage, dtext, KpiStrip, KpiTile, Toolbar } from './kit'

interface Card { icon: ComponentType<IconProps>; tone: Tone; title: string; sub: string; to: string }

/**
 * The desktop CRM home: the same headline KPIs as the phone screen's two rows of `StatTile`s, as a `KpiStrip`, then
 * the same grouped ListRow sections ("Customers", "Selling", "After the sale", settings) as a wrapping card grid —
 * the "module hub" treatment every desktop module home gets (see `WarehouseHome`/`DesktopModulePage`). Reads its own
 * data directly, exactly like `DesktopWarehouseHome`: every figure comes from the same `taskCounts`/`pipelineSummary`/
 * `ticketSummary`/`npsSummary`/`crmAlerts` the phone `m/crm/index.tsx` calls — nothing here is passed down from the
 * phone route, which keeps its body unchanged.
 */
export function DesktopCrmHome() {
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

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Customers & CRM" />}>
        <View style={{ padding: 20 }}><T tone="mute">The customer tools are for people who use the billing counter.</T></View>
      </DeskPage>
    )
  }

  const go = (to: string) => () => router.push(to as never)
  const due = fig.tasks.overdue + fig.tasks.today

  const sections: Array<{ name: string; cards: Card[] }> = [
    {
      name: 'Customers',
      cards: [
        { icon: Users, tone: 'success', title: 'Segments & groups', sub: 'Lapsed, high value, birthdays — and your own', to: '/m/crm/segments' },
        { icon: Gift, tone: 'accent', title: 'Referrals & membership', sub: fig.alerts.referralsReady ? `${fig.alerts.referralsReady} reward${fig.alerts.referralsReady === 1 ? '' : 's'} ready to give` : 'Codes, rewards and tiers', to: '/m/crm/referrals' },
      ],
    },
    {
      name: 'Selling',
      cards: [
        { icon: Handshake, tone: 'primary', title: 'Leads & pipeline', sub: fig.pipe.overdue + fig.pipe.dueToday ? `${fig.pipe.overdue + fig.pipe.dueToday} follow-up${fig.pipe.overdue + fig.pipe.dueToday === 1 ? '' : 's'} due` : 'Stages and follow-up dates', to: '/m/crm/leads' },
        { icon: ListTodo, tone: 'primary', title: 'Tasks & reminders', sub: `${fig.tasks.overdue} late · ${fig.tasks.today} today · ${fig.tasks.upcoming} later`, to: '/m/crm/tasks' },
        ...(manage ? [{ icon: Megaphone, tone: 'warning' as Tone, title: 'Campaigns', sub: fig.campaigns ? `${fig.campaigns} still being sent` : 'WhatsApp or SMS to a segment', to: '/m/crm/campaigns' }] : []),
      ],
    },
    {
      name: 'After the sale',
      cards: [
        { icon: Ticket, tone: 'warning', title: 'Complaints & warranty', sub: 'Tickets with a due time', to: '/m/crm/tickets' },
        { icon: MessageSquare, tone: 'success', title: 'Feedback & ratings', sub: 'Ask after a sale, track the score', to: '/m/crm/feedback' },
      ],
    },
    ...(manage ? [{ name: 'Settings', cards: [{ icon: Settings, tone: 'primary' as Tone, title: 'CRM settings', sub: 'Ticket times, warranty, tiers, referral rewards', to: '/m/crm/settings' }] }] : []),
  ]

  return (
    <DeskPage toolbar={<Toolbar title="Customers & CRM" />}>
      <KpiStrip>
        <KpiTile label="Tasks due" value={String(due)} tone={fig.tasks.overdue ? 'danger' : 'primary'} delta={fig.tasks.overdue ? `${fig.tasks.overdue} late` : 'Today and late'} onPress={go('/m/crm/tasks')} />
        <KpiTile label="Open tickets" value={String(fig.tickets.open)} tone={fig.tickets.breached ? 'danger' : 'primary'} delta={fig.tickets.breached ? `${fig.tickets.breached} past due time` : 'All within time'} onPress={go('/m/crm/tickets')} />
        <KpiTile label="Pipeline" value={inrShort(fig.pipe.open.value)} tone="accent" delta={`${fig.pipe.open.count} open lead${fig.pipe.open.count === 1 ? '' : 's'}`} onPress={go('/m/crm/leads')} />
        <KpiTile label="Recommend score" value={fig.nps.score === null ? '—' : String(fig.nps.score)} tone="success" delta={fig.nps.scored ? `${fig.nps.scored} replies` : 'No scores yet'} onPress={go('/m/crm/feedback')} />
      </KpiStrip>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, gap: 20 }}>
        {sections.map((sec) => (
          <View key={sec.name} style={{ gap: 10 }}>
            <SectionLabel name={sec.name} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {sec.cards.map((card) => <FeatureCard key={card.title} card={card} onOpen={go(card.to)} />)}
            </View>
          </View>
        ))}
        <T style={[dtext.tiny, { color: c.inkMute }]}>Messages open in WhatsApp or the messages app for a person to press send. Sending on its own needs the WhatsApp Business service or an SMS provider with your own keys.</T>
      </ScrollView>
    </DeskPage>
  )
}

function SectionLabel({ name }: { name: string }) {
  const { c } = useTheme()
  return <T style={[dtext.label, { color: c.inkMute }]}>{name}</T>
}

function FeatureCard({ card, onOpen }: { card: Card; onOpen: () => void }) {
  const { c } = useTheme()
  const [hovered, setHovered] = React.useState(false)
  const Icon = card.icon
  return (
    <Pressable
      onPress={onOpen}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={{
        minWidth: 260, maxWidth: 360, flexGrow: 1, flexBasis: 260,
        flexDirection: 'row', alignItems: 'flex-start', gap: 12,
        padding: 14, backgroundColor: hovered ? c.sunken : c.surface,
        borderWidth: 1, borderColor: hovered ? c.lineStrong : c.line, borderRadius: 8,
      }}
    >
      <View style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: toneTint(c, card.tone), alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={18} color={toneColor(c, card.tone)} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{card.title}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={2}>{card.sub}</T>
      </View>
    </Pressable>
  )
}
