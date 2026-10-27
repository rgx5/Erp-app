/** 'HH:MM' on a 24-hour clock. */
export type Hhmm = string

// ───────────────────────────── set-up ─────────────────────────────

/** The shop's settings for this module (one document, id 'services'). */
export interface ServiceSettings {
  id: 'services'
  /** Default working hours and days (0 = Sunday) of the calendar; each staff member / resource may have their own. */
  openTime: Hhmm
  closeTime: Hhmm
  workDays: number[]
  /** Calendar granularity and the step of the free-slot finder. */
  slotMinutes: number
  /** How long before an appointment the reminder is due. */
  reminderLeadHours: number
  /** A customer with this many no-shows is not booked without a manager's say-so. 0 = never refuse. */
  maxNoShows: number
  /** A closing line added to reminder texts (address, cancellation policy…). */
  reminderNote: string
  /** Hourly rate a new project starts with. */
  defaultHourlyRate: number
  /** The no-stock items that "Labour" (job cards) and "Project hours" (timesheets) are billed on; created when first needed. */
  labourVariantId?: string
  hoursVariantId?: string
}

/** What is known about a service beyond its item (name, price, GST come from the item). The id is the item's variant id. */
export interface ServiceItem {
  id: string
  variantId: string
  durationMin: number
  /** Cleaning-up time kept free after it. */
  bufferMin: number
  active: boolean
}

export type ResourceKind = 'staff' | 'resource'

/** A column of the calendar: a stylist, a technician, a chair, a room, a bay. */
export interface ServiceResource {
  id: string
  name: string
  kind: ResourceKind
  /** The login this person uses (staff). */
  userId?: string
  phone?: string
  color?: string
  /** Own working hours / days, if different from the shop's. */
  openTime?: Hhmm
  closeTime?: Hhmm
  workDays?: number[]
  /** `YYYY-MM-DD` days off (leave, holiday). */
  daysOff: string[]
  /** Items (variant ids) this column can do; empty = everything. */
  variantIds: string[]
  active: boolean
  createdAt: number
}

// ───────────────────────────── appointments ─────────────────────────────

export type ApptStatus = 'booked' | 'confirmed' | 'arrived' | 'in_service' | 'completed' | 'cancelled' | 'no_show'

export interface ApptService { variantId: string; name: string; durationMin: number; price: number }

export interface Appointment {
  id: string
  /** AP-0001 */
  no: string
  customerId: string | null
  partyName: string
  partyPhone: string
  resourceId: string
  services: ApptService[]
  start: number
  end: number
  status: ApptStatus
  notes: string
  createdBy: string
  createdAt: number
  confirmedAt?: number
  arrivedAt?: number
  completedAt?: number
  cancelledAt?: number
  cancelReason?: string
  noShowAt?: number
  /** A reminder text was sent (shared) at this time. */
  remindedAt?: number
  /** The bill this became. */
  billId?: string
  /** The package session that paid for it (instead of a bill). */
  packageUseId?: string
  branchId?: string
}

// ───────────────────────────── packages & memberships ─────────────────────────────

export interface PackagePlan {
  id: string
  name: string
  /** What the customer pays, GST included. */
  price: number
  /** Visits / sessions in the package. */
  sessions: number
  /** Days the package can be used for after it is sold; 0 = never expires. */
  validityDays: number
  /** Items (variant ids) it covers; empty = any service. */
  variantIds: string[]
  gstRate: number
  active: boolean
  notes: string
  createdAt: number
}

export type PackageMode = 'cash' | 'upi' | 'card' | 'bank'

/** A package sold: money received, held as a liability (advance from the customer) until sessions are used. Posted once. */
export interface PackageSale {
  id: string
  /** PK-0001 */
  no: string
  customerId: string
  planId: string
  name: string
  sessions: number
  /** GST included. */
  price: number
  gstRate: number
  /** The price without GST: what is earned as sessions are used. */
  taxable: number
  mode: PackageMode
  ref: string
  date: number
  expiresAt?: number
  variantIds: string[]
  userId: string
  branchId?: string
}

export type PackageStatus = 'active' | 'frozen' | 'expired'

/** What a customer holds. `sessionsUsed` and `recognised` are kept by the server from `packageUses` (owned). The id is the sale's id. */
export interface CustomerPackage {
  id: string
  saleId: string
  no: string
  customerId: string
  planId: string
  name: string
  sessions: number
  sessionsUsed: number
  price: number
  taxable: number
  /** Revenue earned so far (of `taxable`). */
  recognised: number
  variantIds: string[]
  soldAt: number
  expiresAt?: number
  status: PackageStatus
  note: string
}

export type PackageUseKind = 'use' | 'reversal' | 'expiry'

/** Sessions consumed (or given back, or lapsed) and the revenue that becomes earned with them. Posted once; a mistake is reversed by a new one. */
export interface PackageUse {
  id: string
  customerPackageId: string
  customerId: string
  kind: PackageUseKind
  /** Signed: a use is positive, a reversal negative, an expiry the sessions that lapsed. */
  sessions: number
  /** Signed revenue recognised with it (GST excluded). */
  value: number
  /** Signed GST released with it (the share of the GST in the price that belongs to these sessions). */
  tax: number
  date: number
  variantId?: string
  serviceName?: string
  appointmentId?: string
  billId?: string
  visitId?: string
  jobCardId?: string
  /** The use this one reverses. */
  reverses?: string
  note: string
  userId: string
  branchId?: string
}

// ───────────────────────────── job cards ─────────────────────────────

export type JobStatus = 'received' | 'estimated' | 'approved' | 'in_work' | 'ready' | 'delivered' | 'rejected' | 'cancelled'
export type JobKind = 'device' | 'vehicle' | 'appliance' | 'other'

export interface JobLine {
  id: string
  kind: 'labour' | 'part'
  name: string
  qty: number
  /** One unit, priced like the counter prices (GST included unless the shop adds it). */
  price: number
  /** A part is an item in stock. */
  variantId?: string
  /** How much of a part has been taken out of stock for this job. */
  issued?: number
}

export interface JobCard {
  id: string
  /** JC-0001 */
  no: string
  customerId: string | null
  partyName: string
  partyPhone: string
  kind: JobKind
  /** Make and model. */
  title: string
  /** IMEI / serial / registration number. */
  identifier: string
  /** Odometer reading, battery health… */
  reading: string
  accessories: string
  condition: string
  problem: string
  /** Photo files on this phone (from the picker). */
  photos: string[]
  status: JobStatus
  lines: JobLine[]
  /** The total (GST included) the customer approved; more work on top of it needs a new approval. */
  approvedTotal?: number
  assignedTo?: string
  receivedAt: number
  promisedAt?: number
  estimatedAt?: number
  approvedAt?: number
  /** Who approved the estimate and how ("Meera by phone"). */
  approvedBy?: string
  rejectReason?: string
  startedAt?: number
  readyAt?: number
  deliveredAt?: number
  /** Who took the item away. */
  receivedBy?: string
  billId?: string
  notes: string
  createdBy: string
  branchId?: string
}

// ───────────────────────────── projects & timesheets ─────────────────────────────

export type ProjectStatus = 'active' | 'on_hold' | 'completed' | 'cancelled'
export type ProjectBilling = 'hourly' | 'fixed'

export interface Project {
  id: string
  /** PR-0001 */
  no: string
  name: string
  customerId: string | null
  status: ProjectStatus
  billing: ProjectBilling
  hourlyRate: number
  /** Fixed-price projects: the agreed fee (GST included). */
  fixedAmount: number
  /** Fixed-price projects: how much of the fee has been invoiced. */
  fixedInvoiced: number
  budgetHours: number
  startDate?: number
  dueDate?: number
  notes: string
  createdAt: number
  branchId?: string
}

export type TaskStatus = 'todo' | 'doing' | 'done'

export interface ProjectTask {
  id: string
  projectId: string
  title: string
  assigneeId?: string
  status: TaskStatus
  estHours: number
  dueDate?: number
  billable: boolean
  createdAt: number
  doneAt?: number
}

export interface TimeEntry {
  id: string
  projectId: string
  taskId?: string
  /** Who worked. */
  userId: string
  /** Start of the day worked. */
  date: number
  minutes: number
  billable: boolean
  /** ₹ per hour at the time (kept, so a later rate change does not rewrite old invoices). */
  rate: number
  note: string
  /** Set while a timer is running; `minutes` is added when it stops. */
  runningSince?: number
  /** The invoice this was billed on. */
  billId?: string
  createdAt: number
  branchId?: string
}

// ───────────────────────────── field visits ─────────────────────────────

export type VisitStatus = 'planned' | 'checked_in' | 'completed' | 'cancelled'

export interface VisitReport { summary: string; workDone: string; issues: string; nextSteps: string }

export interface VisitSignature {
  kind: 'typed' | 'drawn'
  /** Who signed. */
  name: string
  /** A drawn signature: SVG path data, one entry per stroke, on a `width` × `height` pad. */
  strokes?: string[]
  width?: number
  height?: number
  signedAt: number
}

export interface FieldVisit {
  id: string
  /** FV-0001 */
  no: string
  customerId: string | null
  partyName: string
  partyPhone: string
  address: string
  purpose: string
  /** The person visiting. */
  userId: string
  plannedAt: number
  status: VisitStatus
  checkInAt?: number
  /** Where they checked in: a typed place, or coordinates when the phone could give them. */
  checkInPlace?: string
  lat?: number
  lng?: number
  checkOutAt?: number
  notes: string
  report: VisitReport
  photos: string[]
  signature?: VisitSignature
  /** A package session used for this visit. */
  packageUseId?: string
  projectId?: string
  jobCardId?: string
  createdAt: number
  branchId?: string
}

declare module '@/data/state' {
  interface CollMap {
    serviceSettings: ServiceSettings
    serviceItems: ServiceItem
    serviceResources: ServiceResource
    appointments: Appointment
    packagePlans: PackagePlan
    packageSales: PackageSale
    customerPackages: CustomerPackage
    packageUses: PackageUse
    jobCards: JobCard
    projects: Project
    projectTasks: ProjectTask
    timeEntries: TimeEntry
    fieldVisits: FieldVisit
  }
}
