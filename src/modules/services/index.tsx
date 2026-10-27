/**
 * Services & projects — where it appears in the app. Appointments with a day and week calendar, prepaid packages and memberships,
 * repair job cards, projects with timesheets, and field visits.
 *   replication.ts  collections, permissions, package counters (pure; the server loads it)   postings.ts  deferred revenue for packages (pure; tested)
 *   logic/…  ops*.ts  hooks.ts  rules, operations and the bill hook (pure; tested)
 *   this file       the Services app, Reports hub, Home notices, the "package" way to pay, customer and bill panels, receipt lines
 *   src/app/m/services/…  its screens
 */
import React from 'react'
import { currentUser, useApp } from '@/data/store'
import { can } from '@/domain/permissions'
import { Briefcase, CalendarClock, CalendarDays, ChartColumn, ClipboardList, Clock, Gift, MapPin, Settings, Users, Wrench } from '@/ui/icons'
import { registerBillHook, registerModule, registerPanel, registerPaymentMethod, registerReceiptExtra, type HomeNotice } from '../registry'
import { EXT, receiptFooter, receiptHeader, servicesBillHook } from './hooks'
import { openJobs } from './logic/jobs'
import { usableCount } from './logic/packages'
import { daySummary } from './logic/appointments'
import { serviceAlerts } from './logic/reports'
import { runningTimer } from './logic/projects'
import { BillServicesPanel, CustomerServicesPanel } from './ui/Panels'
import './replication'

registerBillHook(servicesBillHook)
registerReceiptExtra({ id: EXT, header: receiptHeader, footer: receiptFooter })

/** A session of the customer's package pays for the bill — offered only to a customer who has one to use. */
registerPaymentMethod({ id: 'package', label: 'Package session', icon: Gift, order: 45, enabled: (s, cart) => !!cart.customerId && usableCount(s, cart.customerId, Date.now()) > 0 })

const viewer = (perm: string) => can(currentUser(useApp.getState())?.role, perm)
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

registerModule({
  id: 'services', name: 'Services & projects', tagline: 'Appointments, job cards and projects', icon: Wrench, tone: 'success', order: 80, needsKosh: true,
  features: [
    { id: 'svc-appointments', label: 'Appointments', sub: 'Day and week calendar, reminders, no-shows', icon: CalendarDays, tone: 'primary', to: '/m/services/appointments', perm: 'services', section: 'Bookings',
      badge: (s) => daySummary(s, Date.now()).booked || null },
    { id: 'svc-packages', label: 'Packages & memberships', sub: 'Sell prepaid sessions and use them up', icon: Gift, tone: 'accent', to: '/m/services/packages', perm: 'services', section: 'Bookings',
      badge: (s) => serviceAlerts(s, Date.now()).expiringPackages || null },
    { id: 'svc-jobs', label: 'Job cards', sub: 'Repairs: estimate, approval, parts, delivery', icon: ClipboardList, tone: 'warning', to: '/m/services/jobs', perm: 'services', section: 'Work',
      badge: (s) => openJobs(s).length || null },
    { id: 'svc-visits', label: 'Field visits', sub: 'Check in, notes, report and customer signature', icon: MapPin, tone: 'success', to: '/m/services/visits', perm: 'services', section: 'Work' },
    { id: 'svc-projects', label: 'Projects & timesheets', sub: 'Tasks, hours and billing', icon: Briefcase, tone: 'primary', to: '/m/services/projects', perm: 'services', section: 'Work',
      badge: (s) => (runningTimer(s, currentUser(useApp.getState())?.id ?? '') ? 1 : null) },
    { id: 'svc-staff', label: 'Staff & resources', sub: 'The columns of your calendar and their hours', icon: Users, tone: 'default', to: '/m/services/resources', perm: 'servicesManage', section: 'Set-up' },
    { id: 'svc-settings', label: 'Service settings', sub: 'Hours, services and how long they take', icon: Settings, tone: 'default', to: '/m/services/settings', perm: 'servicesManage', section: 'Set-up' },
  ],
  reports: [
    { id: 'svc-rep-appointments', label: 'Appointments & no-shows', sub: 'Bookings, who did not turn up', icon: CalendarClock, tone: 'primary', to: '/m/services/reports?tab=appointments', group: 'Services', perm: 'services' },
    { id: 'svc-rep-utilisation', label: 'Staff & resource utilisation', sub: 'Booked time against working time', icon: ChartColumn, tone: 'success', to: '/m/services/reports?tab=utilisation', group: 'Services', perm: 'services' },
    { id: 'svc-rep-packages', label: 'Package liability', sub: 'Money held for unused sessions (deferred revenue)', icon: Gift, tone: 'warning', to: '/m/services/reports?tab=packages', group: 'Accounts', perm: 'services' },
    { id: 'svc-rep-jobs', label: 'Repairs by age', sub: 'Open job cards and how long they have waited', icon: ClipboardList, tone: 'warning', to: '/m/services/reports?tab=jobs', group: 'Services', perm: 'services' },
    { id: 'svc-rep-projects', label: 'Project hours & billing', sub: 'Hours, unbilled amounts, fixed fees', icon: Briefcase, tone: 'primary', to: '/m/services/reports?tab=projects', group: 'Services', perm: 'services' },
    { id: 'svc-rep-timesheet', label: 'Timesheets', sub: 'Hours by person and day', icon: Clock, tone: 'accent', to: '/m/services/reports?tab=timesheets', group: 'People', perm: 'services' },
    { id: 'svc-rep-visits', label: 'Field visit log', sub: 'Who visited whom, when and for how long', icon: MapPin, tone: 'success', to: '/m/services/reports?tab=visits', group: 'People', perm: 'services' },
  ],
  // These run on every change, so each one first checks who is looking.
  notices: [
    (s, now): HomeNotice | null => {
      if (!viewer('services')) return null
      const a = serviceAlerts(s, now)
      if (a.overdueBookings) return { id: 'svc-overdue', tone: 'warning', title: `${plural(a.overdueBookings, 'booking')} passed without anyone arriving`, body: 'Mark them as done or as no-shows', action: 'Open', to: '/m/services/appointments' }
      return a.reminders ? { id: 'svc-reminders', tone: 'primary', title: `${plural(a.reminders, 'appointment reminder')} to send`, body: 'Bookings coming up that have not been reminded', action: 'Send', to: '/m/services/appointments' } : null
    },
    (s, now): HomeNotice | null => {
      if (!viewer('services')) return null
      const a = serviceAlerts(s, now)
      return a.uncollectedJobs ? { id: 'svc-uncollected', tone: 'warning', title: `${plural(a.uncollectedJobs, 'repair')} ready for days, not collected`, body: 'Call the customers', action: 'Open', to: '/m/services/jobs' } : null
    },
    (s, now): HomeNotice | null => {
      if (!viewer('services')) return null
      const a = serviceAlerts(s, now)
      if (a.lapsedPackages) return { id: 'svc-lapsed', tone: 'warning', title: `${plural(a.lapsedPackages, 'package')} ran out of time with sessions unused`, body: 'Let them lapse to record the income', action: 'Open', to: '/m/services/packages' }
      return a.expiringPackages ? { id: 'svc-expiring', tone: 'primary', title: `${plural(a.expiringPackages, 'package')} expire within 2 weeks`, body: 'Remind the customers to use their sessions', action: 'Open', to: '/m/services/packages' } : null
    },
    (s, now): HomeNotice | null => {
      if (!viewer('services')) return null
      const mine = runningTimer(s, currentUser(useApp.getState())?.id ?? '')
      return mine && now - (mine.runningSince ?? now) > 10 * 3_600_000 ? { id: 'svc-timer', tone: 'warning', title: 'A timer has been running for over 10 hours', body: 'Stop it and correct the time', action: 'Open', to: '/m/services/projects' } : null
    },
    (s, now): HomeNotice | null => {
      if (!viewer('services')) return null
      const a = serviceAlerts(s, now)
      return a.missedVisits ? { id: 'svc-visits', tone: 'warning', title: `${plural(a.missedVisits, 'field visit')} not checked in`, body: 'The planned time has passed', action: 'Open', to: '/m/services/visits' } : null
    },
  ],
})

/** On a customer's page: package balance, upcoming bookings, repairs in progress. */
registerPanel({ id: 'services.customer', slot: 'customer', order: 25, perm: 'services', needsKosh: true, component: ({ customer }) => <CustomerServicesPanel customer={customer} /> })
registerPanel({ id: 'services.bill', slot: 'bill', order: 25, perm: 'services', needsKosh: true, component: ({ bill }) => <BillServicesPanel bill={bill} /> })

