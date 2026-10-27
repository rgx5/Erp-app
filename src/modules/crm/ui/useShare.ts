import { useCallback, useState } from 'react'
import { getToken } from '@/data/auth'
import { getKoshApi } from '@/data/kosh/auth'
import { perform, useApp } from '@/data/store'
import { saveInvoiceLink } from '../ops'
import { requestShareLink } from '../share'

/** Whether this phone is connected to a OneSync server — the only place a shareable invoice link can come from. */
export const useKoshConnected = () => useApp((s) => s.workspace?.mode === 'remote' && s.workspace.backend === 'kosh')

/** Makes (or reuses) the public link for a bill. Throws a readable Error when the server cannot be reached. */
export function useInvoiceLink(billId: string) {
  const saved = useApp((s) => s.data.invoiceLinks?.[billId])
  const [busy, setBusy] = useState(false)
  const get = useCallback(async (): Promise<string> => {
    if (saved) return saved.url
    const api = getKoshApi(getToken)
    if (!api) throw new Error('Connect to a OneSync server to share invoice links.')
    setBusy(true)
    try {
      const link = await requestShareLink(api, billId)
      perform((s, ctx) => saveInvoiceLink(s, billId, link, ctx))
      return link.url
    } finally { setBusy(false) }
  }, [saved, billId])
  return { saved, busy, get }
}
