import { useMemo } from 'react'
import { stateName } from '@/domain/india'
import { useWorkspace } from '@/features/organization/workspace'
import { useRetailSettings } from '@/features/retail/queries'
import type { Seller } from './invoiceHtml'

/** The business's own name, GSTIN and address as they print on a document issued under one GST registration. */
export function useSeller(gstRegistrationId: string | undefined): Seller | null {
  const ws = useWorkspace()
  const retail = useRetailSettings(ws.company?.id)
  return useMemo(() => {
    if (!gstRegistrationId || !ws.company) return null
    const reg = ws.registrations.find((r) => r.id === gstRegistrationId)
    const loc = ws.locations.find((l) => l.gstRegistrationId === gstRegistrationId && l.isPrincipalPlace) ?? ws.locations.find((l) => l.gstRegistrationId === gstRegistrationId)
    return {
      name: reg?.legalName ?? ws.company.legalName, tradeName: reg?.tradeName ?? ws.company.tradeName, gstin: reg?.gstin ?? '', stateCode: reg?.stateCode ?? '',
      address: loc ? [loc.address.line1, loc.address.line2 ?? '', loc.address.city, stateName(loc.address.stateCode), loc.address.pincode].filter(Boolean) : [], upiId: retail.data?.upiId ?? null,
    }
  }, [gstRegistrationId, ws.company, ws.registrations, ws.locations, retail.data?.upiId])
}
