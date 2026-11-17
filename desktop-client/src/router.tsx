import { createRootRoute, createRoute, createRouter, Outlet, redirect } from '@tanstack/react-router'
import { useSession } from '@/auth/session'
import { ConnectPage } from '@/features/auth/ConnectPage'
import { LoginPage } from '@/features/auth/LoginPage'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { CompaniesPage } from '@/features/organization/CompaniesPage'
import { SetupPage } from '@/features/setup/SetupPage'
import { ItemsPage } from '@/features/masterdata/ItemsPage'
import { PartiesPage } from '@/features/masterdata/PartiesPage'
import { PriceListsPage } from '@/features/masterdata/PriceListsPage'
import { PaymentTermsPage, TaxCodesPage, UnitsPage } from '@/features/masterdata/ReferencePages'
import { Shell } from '@/ui/Shell'

const root = createRootRoute({ component: Outlet })

const connect = createRoute({ getParentRoute: () => root, path: '/connect', component: ConnectPage })
const login = createRoute({
  getParentRoute: () => root,
  path: '/login',
  beforeLoad: () => {
    const s = useSession.getState()
    if (s.status === 'authenticated') throw redirect({ to: '/' })
    if (!s.server) throw redirect({ to: '/connect' })
  },
  component: LoginPage,
})

/** Everything behind sign-in. */
const app = createRoute({
  getParentRoute: () => root,
  id: 'app',
  beforeLoad: () => {
    const s = useSession.getState()
    if (s.status !== 'authenticated') throw redirect({ to: s.server ? '/login' : '/connect' })
  },
  component: Shell,
})
const dashboard = createRoute({ getParentRoute: () => app, path: '/', component: DashboardPage })
const companies = createRoute({ getParentRoute: () => app, path: '/organization/companies', component: CompaniesPage })

const setup = createRoute({ getParentRoute: () => app, path: '/setup', component: SetupPage })
const items = createRoute({ getParentRoute: () => app, path: '/masterdata/items', component: ItemsPage })
const customers = createRoute({ getParentRoute: () => app, path: '/masterdata/customers', component: () => <PartiesPage role="customer" /> })
const suppliers = createRoute({ getParentRoute: () => app, path: '/masterdata/suppliers', component: () => <PartiesPage role="supplier" /> })
const taxCodes = createRoute({ getParentRoute: () => app, path: '/masterdata/tax-codes', component: TaxCodesPage })
const units = createRoute({ getParentRoute: () => app, path: '/masterdata/units', component: UnitsPage })
const paymentTerms = createRoute({ getParentRoute: () => app, path: '/masterdata/payment-terms', component: PaymentTermsPage })
const priceLists = createRoute({ getParentRoute: () => app, path: '/masterdata/price-lists', component: PriceListsPage })
const tree = root.addChildren([connect, login, app.addChildren([dashboard, setup, companies, items, customers, suppliers, taxCodes, units, paymentTerms, priceLists])])

// A hash history works the same on a custom app:// origin and in a browser, with no server-side route fallback to configure.
import { createHashHistory } from '@tanstack/react-router'
export const router = createRouter({ routeTree: tree, history: createHashHistory(), defaultPreload: 'intent' })

declare module '@tanstack/react-router' {
  interface Register { router: typeof router }
}
