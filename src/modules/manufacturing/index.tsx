/**
 * Manufacturing — registration of what this module adds to the Production app: recipes (bill of materials) with live costing,
 * work orders, quality checks, job work / made-to-order, and the production reports.
 *   replication.ts  collections, permission, posting rule (pure; the server loads it)
 *   bom.ts / production.ts / jobs.ts / reports.ts / posting.ts / ops.ts   rules and operations (pure; tested)
 *   src/app/m/manufacturing/…  its screens
 */
import { listOf } from '@/data/state'
import { ChartColumn, ClipboardCheck, ClipboardList, Factory, Hourglass, Layers, Scissors } from '@/ui/icons'
import { registerModule } from '../registry'
import { jobsNotice, lateOrdersNotice, readyJobsNotice } from './notices'
import { isOpen } from './production'
import { isOpenJob } from './jobs'
import './replication'

registerModule({
  id: 'manufacturing', name: 'Production', tagline: 'Recipes, work orders and job work', icon: Factory, tone: 'accent', order: 70, needsKosh: true,
  features: [
    { id: 'mf-recipes', label: 'Recipes & costing', sub: 'Bill of materials, wastage and what it costs to make', icon: Layers, tone: 'accent', to: '/m/manufacturing/recipes', perm: 'manufacturing', section: 'Plan' },
    { id: 'mf-orders', label: 'Work orders', sub: 'Plan, issue material, receive finished goods', icon: ClipboardList, tone: 'primary', to: '/m/manufacturing/orders', perm: 'inventory', section: 'Shop floor', badge: (s) => listOf(s.workOrders).filter(isOpen).length || null },
    { id: 'mf-quality', label: 'Quality checks', sub: 'Inspect against the checklist; scrap or rework rejects', icon: ClipboardCheck, tone: 'success', to: '/m/manufacturing/quality', perm: 'inventory', section: 'Shop floor' },
    { id: 'mf-jobs', label: 'Job work & orders', sub: 'Made to order, or work on a customer’s material', icon: Scissors, tone: 'warning', to: '/m/manufacturing/jobs', perm: 'pos', section: 'Customers', badge: (s) => listOf(s.jobOrders).filter(isOpenJob).length || null },
    { id: 'mf-reports', label: 'Production reports', sub: 'Cost per unit, variance, yield and work in progress', icon: ChartColumn, tone: 'primary', to: '/m/manufacturing/reports', perm: 'manufacturing', section: 'Reports' },
  ],
  reports: [
    { id: 'mf-r-cost', label: 'Production cost & variance', sub: 'Cost per unit made against standard', icon: ChartColumn, tone: 'primary', to: '/m/manufacturing/reports?tab=cost', group: 'Production', perm: 'manufacturing' },
    { id: 'mf-r-yield', label: 'Yield & wastage', sub: 'Planned against actual output and material use', icon: Layers, tone: 'accent', to: '/m/manufacturing/reports?tab=yield', group: 'Production', perm: 'manufacturing' },
    { id: 'mf-r-wip', label: 'Work in progress', sub: 'Orders on the floor and material tied up in them', icon: Hourglass, tone: 'warning', to: '/m/manufacturing/reports?tab=wip', group: 'Production', perm: 'manufacturing' },
  ],
  notices: [lateOrdersNotice, jobsNotice, readyJobsNotice],
})
