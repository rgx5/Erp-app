import { Link } from '@tanstack/react-router'
import { useT } from '@/i18n'
import { useVisibleNav } from '@/ui/useNav'

/** What each settings page is for, grouped the way people look for them. A page appears only when the person may open it and their plan includes it. */
const GROUPS: { title: string; blurb: string; pages: Record<string, string> }[] = [
  { title: 'Your business', blurb: 'Who you are and the rules your documents follow.', pages: {
    '/organization/companies': 'Companies, GST registrations, locations and warehouses.',
    '/setup': 'The steps to get a new business ready to bill.',
    '/masterdata/tax-codes': 'GST rates and tax codes used on items and documents.',
    '/masterdata/units': 'Units of measure and their conversions.',
    '/masterdata/payment-terms': 'Credit periods offered and taken.' } },
  { title: 'People and access', blurb: 'Who can sign in and what they may do.', pages: {
    '/admin/users': 'Add people, reset passwords, turn two-step sign-in on.',
    '/admin/roles': 'What each kind of person is allowed to do.',
    '/admin/api-keys': 'Keys for other software to connect.',
    '/admin/audit': 'Who changed what, and when.',
    '/account': 'Your own password, layout and display.' } },
  { title: 'Modules', blurb: 'Set-up that belongs to one area of work, kept out of the way of daily pages.', pages: {
    '/leads/settings': 'Stages, assignment, territories and the fields you collect on a lead.',
    '/leads/sources': 'Connect your website, Meta and Google lead forms.',
    '/payroll/setup': 'Salary components, statutory rules and pay groups.',
    '/pos/admin': 'Counters, shifts, printers and drawers.' } },
]

export function SettingsPage() {
  const t = useT()
  const { items } = useVisibleNav()
  const byPath = new Map(items.map((n) => [n.to, n]))
  return (
    <div className="flex flex-col gap-5">
      <div><h1 className="page-title">Settings</h1><p className="page-sub">Everything you set up once and change rarely is here, so the daily pages stay clean.</p></div>
      {GROUPS.map((g) => {
        const shown = Object.entries(g.pages).filter(([to]) => byPath.has(to))
        if (shown.length === 0) return null
        return (
          <section key={g.title} aria-label={g.title}>
            <h2 className="text-sm font-semibold">{t(g.title)}</h2><p className="mb-2 text-xs text-muted">{g.blurb}</p>
            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
              {shown.map(([to, text]) => {
                const n = byPath.get(to)!
                return (
                  <Link key={to} to={to as never} className="flex items-start gap-3 rounded-lg border border-line bg-surface p-3.5 hover:border-brand">
                    <span className="grid size-8 shrink-0 place-items-center rounded-md bg-brand-soft text-brand"><n.icon className="size-4" aria-hidden /></span>
                    <span><span className="block text-[13px] font-semibold">{t(n.label)}</span><span className="mt-0.5 block text-xs text-muted">{text}</span></span>
                  </Link>)
              })}
            </div>
          </section>)
      })}
    </div>
  )
}
