import { useEffect, useState } from 'react'
import { ApiError } from '@/api/errors'
import type { Party } from '@/api/schemas'
import { formatInr } from '@/domain/format'
import { PartyPicker } from '@/features/masterdata/PartyPicker'
import { useCustomerWallet, validateCoupon } from '@/features/retail/queries'
import { Alert, Button, Card, TextField } from '@/ui/primitives'
import { type WalletChoice, noWallet } from './wallet'

/** The customer's wallet at the counter: store credit, loyalty points and a coupon code. Needs the server, so it is off while offline. */
export function WalletPanel({ companyId, gross, choice, onChange, offline, pointsDiscount }: { companyId: string; gross: string; choice: WalletChoice; onChange: (c: WalletChoice) => void; offline: boolean; pointsDiscount: bigint }) {
  const [customer, setCustomer] = useState<Party | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (!choice.customerId) setCustomer(null) }, [choice.customerId]) // the sale was charged: the picker clears with it
  const wallet = useCustomerWallet(companyId, choice.customerId || undefined)
  const w = wallet.data
  const hasCredit = w ? Number(w.storeCredit) > 0 : false
  const worth = w ? Number(w.loyalty.rupeesPerPoint) : 0

  async function apply() {
    const code = choice.code.trim()
    if (!code) return
    setBusy(true); setProblem(null)
    try { const r = await validateCoupon({ companyId, code, billTotal: gross }); onChange({ ...choice, code: r.code, coupon: { code: r.code, discount: r.discount } }) }
    catch (e) { onChange({ ...choice, coupon: null }); setProblem(e instanceof ApiError ? e.message : 'Could not check the coupon.') }
    finally { setBusy(false) }
  }

  return (
    <Card title="Customer wallet">
      <div className="flex flex-col gap-2">
        {offline ? <Alert tone="info">The wallet needs a connection.</Alert> : (<>
          <PartyPicker label="Customer (for credit, points and coupons)" role="customer" value={customer} onPick={(p) => { setCustomer(p); setProblem(null); onChange({ ...noWallet(), customerId: p?.id ?? '', code: choice.code, coupon: choice.coupon }) }} />
          {choice.customerId && wallet.isPending ? <p className="text-sm text-muted">Loading…</p> : null}
          {w ? (
            <dl className="text-sm" aria-label="Wallet balance">
              <div className="flex justify-between"><dt className="text-muted">Store credit</dt><dd className="num">{formatInr(w.storeCredit)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Points</dt><dd className="num">{w.loyalty.points}{worth > 0 ? ` (worth ${formatInr(w.loyalty.value)})` : ''}</dd></div>
            </dl>) : null}
          {hasCredit ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={choice.useCredit} onChange={(e) => onChange({ ...choice, useCredit: e.target.checked })} /> Use store credit</label> : null}
          {w && worth > 0 && Number(w.loyalty.points) > 0 ? <TextField label="Points to redeem" inputMode="decimal" value={choice.points} hint={pointsDiscount > 0n ? `Takes ${formatInr(String(Number(pointsDiscount) / 10_000))} off` : undefined} onChange={(e) => onChange({ ...choice, points: e.target.value })} error={choice.points !== '' && (!/^\d{1,8}(\.\d{1,2})?$/.test(choice.points) || Number(choice.points) > Number(w.loyalty.points)) ? 'More than the customer has, or not a number' : undefined} /> : null}
          <div className="flex items-end gap-2"><div className="flex-1"><TextField label="Coupon code" value={choice.code} onChange={(e) => onChange({ ...choice, code: e.target.value, coupon: null })} /></div><Button variant="secondary" busy={busy} disabled={!choice.code.trim() || choice.coupon !== null} onClick={() => void apply()}>Apply</Button></div>
          {choice.coupon ? <p className="text-sm text-good" role="status">Coupon {choice.coupon.code} takes {formatInr(choice.coupon.discount)} off.</p> : null}
          {problem ? <Alert>{problem}</Alert> : null}
        </>)}
      </div>
    </Card>
  )
}
