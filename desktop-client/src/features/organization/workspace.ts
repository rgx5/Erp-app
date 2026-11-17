import { useChosenCompany, useCompanies } from './queries'
import { useGstRegistrations, useLocations, useWarehouses } from '@/features/setup/queries'

/** The company the person is working in, with the pieces every document needs (GST registrations, places of business, warehouses). */
export function useWorkspace() {
  const companies = useCompanies()
  const { companyId, choose } = useChosenCompany()
  const list = companies.data ?? []
  const company = list.find((c) => c.id === companyId) ?? list[0]
  const registrations = useGstRegistrations(company?.id)
  const locations = useLocations(company?.id)
  const warehouses = useWarehouses(company?.id, (locations.data ?? []).map((l) => l.id))
  return {
    loading: companies.isPending || Boolean(company && (registrations.isPending || locations.isPending)),
    company, companies: list, choose,
    registrations: (registrations.data ?? []).filter((r) => r.status === 'active'),
    locations: locations.data ?? [], warehouses: warehouses.data ?? [],
  }
}
