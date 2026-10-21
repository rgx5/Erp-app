/**
 * People & payroll — where it appears in the app. Staff are people first (profile, documents, shifts, attendance, leave) and a
 * payroll second (pay terms, a monthly run from attendance, payslips, bank file, advances recovered from salary, sales incentives).
 *   replication.ts  the collections and who may read them (hr, payroll, hrSelf); posting rules in postings.ts (pure; the server loads them)
 *   logic/…         attendance, leave accrual, payroll, targets, reports (pure; tested)   ops.ts / payrollOps.ts   operations
 *   this file       the Apps screen, the Reports hub and Home notices
 *   src/app/m/hr/…  its screens
 */
import { Banknote, Briefcase, CalendarCheck, CalendarDays, ChartColumn, ClipboardCheck, Clock, FileText, HandCoins, Receipt, Settings, Target, UserPlus, Users, WalletCards } from '@/ui/icons'
import { currentUser, useApp } from '@/data/store'
import { can } from '@/domain/permissions'
import { registerModule, type HomeNotice } from '../registry'
import { expiringDocs, payrollOverdue, waitingApprovals } from './notices'
import './replication'

const viewer = (perm: string) => can(currentUser(useApp.getState())?.role, perm)

registerModule({
  id: 'hr', name: 'People & payroll', tagline: 'Staff, attendance, leave and salaries', icon: Briefcase, tone: 'primary', order: 60, needsKosh: true,
  features: [
    { id: 'hr-employees', label: 'Employees', sub: 'Profiles, documents and who is on which shift', icon: Users, tone: 'primary', to: '/m/hr/employees', perm: 'hr', section: 'People' },
    { id: 'hr-recruitment', label: 'Recruitment', sub: 'Openings, candidates and joining checklist', icon: UserPlus, tone: 'accent', to: '/m/hr/recruitment', perm: 'hr', section: 'People' },
    { id: 'hr-attendance', label: 'Attendance', sub: 'Punch in and out, mark days, fix mistakes', icon: Clock, tone: 'success', to: '/m/hr/attendance', perm: 'hrSelf', section: 'Time',
      badge: (s) => waitingApprovals(s).regularisations || null },
    { id: 'hr-shifts', label: 'Shifts, rosters & holidays', sub: 'Who works when, and the days off', icon: CalendarDays, tone: 'primary', to: '/m/hr/shifts', perm: 'hr', section: 'Time' },
    { id: 'hr-leave', label: 'Leave', sub: 'Ask for leave, approve it, see balances', icon: CalendarCheck, tone: 'warning', to: '/m/hr/leave', perm: 'hrSelf', section: 'Time', badge: (s) => waitingApprovals(s).leave || null },
    { id: 'hr-payroll', label: 'Payroll', sub: 'Run the month, payslips, bank file', icon: WalletCards, tone: 'success', to: '/m/hr/payroll', perm: 'payroll', section: 'Money' },
    { id: 'hr-advances', label: 'Advances & loans', sub: 'Given to staff, taken back from salary', icon: HandCoins, tone: 'warning', to: '/m/hr/advances', perm: 'payroll', section: 'Money' },
    { id: 'hr-targets', label: 'Targets & incentives', sub: 'Sales by each person against their target', icon: Target, tone: 'accent', to: '/m/hr/targets', perm: 'hr', section: 'Money' },
    { id: 'hr-claims', label: 'Expense claims', sub: 'Staff spend to approve and pay back', icon: Receipt, tone: 'primary', to: '/m/hr/claims', perm: 'hrSelf', section: 'Money', badge: (s) => waitingApprovals(s).claims || null },
    { id: 'hr-settings', label: 'Payroll settings', sub: 'PF, ESI, professional tax, TDS and pay rules', icon: Settings, tone: 'default', to: '/m/hr/payroll/settings', perm: 'payroll', section: 'Money' },
  ],
  reports: [
    { id: 'hr-rep-attendance', label: 'Attendance sheet', sub: 'Present, leave, late and overtime by person', icon: ClipboardCheck, tone: 'success', to: '/m/hr/reports/attendance', group: 'People', perm: 'hr' },
    { id: 'hr-rep-payroll', label: 'Payroll register', sub: 'Every payslip of a month', icon: WalletCards, tone: 'primary', to: '/m/hr/reports/payroll', group: 'People', perm: 'payroll' },
    { id: 'hr-rep-statutory', label: 'PF, ESI, PT & TDS', sub: 'What is owed to the offices for a month', icon: FileText, tone: 'warning', to: '/m/hr/reports/statutory', group: 'People', perm: 'payroll' },
    { id: 'hr-rep-bank', label: 'Salary bank file', sub: 'Transfer list for the bank (CSV)', icon: Banknote, tone: 'primary', to: '/m/hr/reports/bank', group: 'People', perm: 'payroll' },
    { id: 'hr-rep-leave', label: 'Leave balances', sub: 'Days left by person and type', icon: CalendarCheck, tone: 'accent', to: '/m/hr/reports/leave', group: 'People', perm: 'hr' },
    { id: 'hr-rep-scorecards', label: 'Staff scorecards', sub: 'Sales, target, attendance and incentive', icon: Target, tone: 'accent', to: '/m/hr/reports/scorecards', group: 'People', perm: 'hr' },
    { id: 'hr-rep-claims', label: 'Expense claims', sub: 'Claimed, approved and paid', icon: Receipt, tone: 'primary', to: '/m/hr/reports/claims', group: 'People', perm: 'hr' },
    { id: 'hr-rep-advances', label: 'Advances outstanding', sub: 'What staff still owe back', icon: ChartColumn, tone: 'warning', to: '/m/hr/reports/advances', group: 'People', perm: 'payroll' },
  ],
  // These run on every change and read people's records, so each one first checks who is looking.
  notices: [
    (s): HomeNotice | null => {
      if (!viewer('hr')) return null
      const w = waitingApprovals(s)
      return w.total ? { id: 'hr-waiting', tone: 'warning', title: `${w.total} staff ${w.total === 1 ? 'request is' : 'requests are'} waiting`, body: [w.leave && `${w.leave} leave`, w.claims && `${w.claims} expense`, w.regularisations && `${w.regularisations} attendance`].filter(Boolean).join(' · '), action: 'Review', to: w.leave ? '/m/hr/leave' : w.claims ? '/m/hr/claims' : '/m/hr/attendance/requests' } : null
    },
    (s, now): HomeNotice | null => {
      if (!viewer('payroll')) return null
      const p = payrollOverdue(s, now)
      return p ? { id: 'hr-payroll-due', tone: 'warning', title: `${p.label} salary has not been run`, body: `${p.people} ${p.people === 1 ? 'person is' : 'people are'} waiting`, action: 'Run payroll', to: '/m/hr/payroll' } : null
    },
    (s, now): HomeNotice | null => {
      if (!viewer('hr')) return null
      const d = expiringDocs(s, now)
      return d.expired + d.soon ? { id: 'hr-docs', tone: d.expired ? 'danger' : 'warning', title: d.expired ? `${d.expired} staff ${d.expired === 1 ? 'document has' : 'documents have'} expired` : `${d.soon} staff ${d.soon === 1 ? 'document expires' : 'documents expire'} within 30 days`, action: 'Open', to: '/m/hr/employees' } : null
    },
  ],
})

