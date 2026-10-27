/**
 * Customers & CRM — where it appears in the app. Segments and groups, leads and a pipeline, tasks and notes, campaigns (messages
 * opened one by one in WhatsApp / SMS), complaints / tickets / warranty claims with a due time, feedback and a recommend score,
 * membership tiers and referral rewards, and shareable invoice links (OneSync server only).
 *   replication.ts  collections, permission, the referral-reward effect (pure; the server loads it too)
 *   stats / segments / leads / tasks / campaigns / tickets / feedback / referrals / share / reports .ts   rules (pure; tested)
 *   ops.ts          operations (pure; tested)
 *   this file       the Customers app, reports, Home notices and the customer / bill panels
 *   src/app/m/crm/…  its screens
 */
import React from 'react'
import { inr } from '@/domain/money'
import { Contact, Gift, Handshake, ListTodo, Megaphone, MessageSquare, Settings, Star, Ticket, Users } from '@/ui/icons'
import { registerModule, registerPanel } from '../registry'
import { leadsToFollowUp } from './leads'
import { crmAlerts } from './reports'
import { ticketSummary } from './tickets'
import { CustomerCrmPanel, BillSharePanel } from './ui/Panels'
import './replication'

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

registerModule({
  id: 'crm', name: 'Customers', tagline: 'People, loyalty, follow-ups and campaigns', icon: Contact, tone: 'success', order: 50,
  features: [
    { id: 'crm-home', label: 'Customer CRM', sub: 'Today’s follow-ups, tickets and scores', icon: Contact, tone: 'success', to: '/m/crm', perm: 'customers', section: 'Relationships',
      badge: (s) => { const a = crmAlerts(s, Date.now()); return a.tasksOverdue + a.tasksToday + a.leadsDue + a.ticketsBreached || null } },
    { id: 'crm-segments', label: 'Segments & groups', sub: 'Lapsed, high value, birthdays, your own', icon: Users, tone: 'success', to: '/m/crm/segments', perm: 'customers', section: 'Relationships' },
    { id: 'crm-leads', label: 'Leads & pipeline', sub: 'Stages, follow-up dates, make a customer', icon: Handshake, tone: 'primary', to: '/m/crm/leads', perm: 'customers', section: 'Relationships',
      badge: (s) => leadsToFollowUp(s, Date.now()).length || null },
    { id: 'crm-tasks', label: 'Tasks & reminders', sub: 'Calls, visits and to-dos', icon: ListTodo, tone: 'warning', to: '/m/crm/tasks', perm: 'customers', section: 'Relationships',
      badge: (s) => { const a = crmAlerts(s, Date.now()); return a.tasksOverdue + a.tasksToday || null } },
    { id: 'crm-campaigns', label: 'Campaigns', sub: 'WhatsApp or SMS to a segment', icon: Megaphone, tone: 'accent', to: '/m/crm/campaigns', perm: 'crm', section: 'Engagement' },
    { id: 'crm-referrals', label: 'Referrals & membership', sub: 'Codes, rewards and tiers', icon: Gift, tone: 'accent', to: '/m/crm/referrals', perm: 'customers', section: 'Engagement',
      badge: (s) => crmAlerts(s, Date.now()).referralsReady || null },
    { id: 'crm-tickets', label: 'Complaints & warranty', sub: 'Tickets with a due time', icon: Ticket, tone: 'warning', to: '/m/crm/tickets', perm: 'customers', section: 'After the sale',
      badge: (s) => ticketSummary(s, Date.now()).breached || null },
    { id: 'crm-feedback', label: 'Feedback & ratings', sub: 'Ask after a sale, track the score', icon: MessageSquare, tone: 'success', to: '/m/crm/feedback', perm: 'customers', section: 'After the sale' },
    { id: 'crm-settings', label: 'CRM settings', sub: 'Ticket times, warranty, tiers, rewards', icon: Settings, tone: 'primary', to: '/m/crm/settings', perm: 'crm', section: 'Settings' },
  ],
  reports: [
    { id: 'crm-segments-report', label: 'Customer segments', sub: 'Who is lapsed, high value or due a wish', icon: Users, tone: 'success', to: '/m/crm/segments', group: 'People', perm: 'customers' },
    { id: 'crm-pipeline-report', label: 'Sales pipeline', sub: 'Open value, likely value and win rate', icon: Handshake, tone: 'primary', to: '/m/crm/leads', group: 'Sales', perm: 'customers' },
    { id: 'crm-tickets-report', label: 'Complaints & service levels', sub: 'Open, late and settled in time', icon: Ticket, tone: 'warning', to: '/m/crm/tickets', group: 'People', perm: 'customers' },
    { id: 'crm-nps-report', label: 'Recommend score & ratings', sub: 'What customers say after a sale', icon: Star, tone: 'success', to: '/m/crm/feedback', group: 'People', perm: 'customers' },
  ],
  notices: [
    (s, now) => {
      const a = crmAlerts(s, now)
      const n = a.tasksOverdue + a.tasksToday + a.leadsDue
      return n ? { id: 'crm-followups', tone: a.tasksOverdue ? 'warning' : 'primary', title: `${plural(n, 'follow-up')} to do today`, body: [a.tasksOverdue ? `${a.tasksOverdue} late` : '', a.leadsDue ? plural(a.leadsDue, 'lead') : ''].filter(Boolean).join(' · ') || 'Tasks and leads', action: 'Open', to: '/m/crm/tasks' } : null
    },
    (s, now) => {
      const a = crmAlerts(s, now)
      return a.ticketsBreached ? { id: 'crm-tickets-late', tone: 'danger', title: `${plural(a.ticketsBreached, 'ticket')} past the due time`, body: 'A customer is waiting for an answer', action: 'Open', to: '/m/crm/tickets' } : null
    },
    (s, now) => {
      const a = crmAlerts(s, now)
      return a.referralsReady ? { id: 'crm-referrals-ready', tone: 'accent', title: `${plural(a.referralsReady, 'referral reward')} ready to give`, body: `Reward is ${inr(s.crmSettings?.crm?.referrerCredit ?? 100, 0)} credit to the referrer`, action: 'Give', to: '/m/crm/referrals' } : null
    },
    (s, now) => {
      const a = crmAlerts(s, now)
      return a.birthdaysToday ? { id: 'crm-birthdays', tone: 'accent', title: `${plural(a.birthdaysToday, 'customer has', 'customers have')} a birthday today`, body: 'Send them a wish', action: 'Open', to: '/m/crm/segments/preset:birthday-week' } : null
    },
  ],
})

// On a customer's page: tier, open tasks and tickets, and the way into notes, groups and the referral code.
registerPanel({ id: 'crm.customer', slot: 'customer', order: 20, perm: 'customers', needsKosh: true, component: ({ customer }) => <CustomerCrmPanel customer={customer} /> })
// On a bill: a shareable invoice link (hides itself unless this phone is connected to a OneSync server).
registerPanel({ id: 'crm.bill', slot: 'bill', order: 20, perm: 'pos', needsKosh: true, component: ({ bill }) => <BillSharePanel bill={bill} /> })
