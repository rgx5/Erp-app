import { useState } from 'react'
import { ApiError } from '@/api/errors'
import type { GiftCard } from '@/api/schemas'
import { bridge } from '@/bridge'
import { isValid } from '@/domain/money'
import { formatInr } from '@/domain/format'
import { useWorkspace } from '@/features/organization/workspace'
import { Drawer } from '@/ui/Drawer'
import { Alert, Button, SelectField, TextField } from '@/ui/primitives'
import { giftCardHtml } from './giftCardHtml'
import { useIssueGiftCard } from './queries'

/** Sells a gift card to the person at the counter and prints the slip with its code. */
export function GiftCardDrawer({ shiftId, onClose }: { shiftId: string; onClose: () => void }) {
  const ws = useWorkspace(); const issue = useIssueGiftCard()
  const [amount, setAmount] = useState(''); const [method, setMethod] = useState('cash'); const [holder, setHolder] = useState(''); const [expires, setExpires] = useState('')
  const [problem, setProblem] = useState<string | null>(null); const [card, setCard] = useState<GiftCard | null>(null)
  const key = useState(() => crypto.randomUUID())[0]
  const ready = isValid(amount) && Number(amount) > 0
  async function sell() {
    setProblem(null)
    try { setCard(await issue.mutateAsync({ key, body: { shiftId, amount, method, ...(holder.trim() ? { holderName: holder.trim() } : {}), ...(expires ? { expiresOn: expires } : {}) } })) }
    catch (e) { setProblem(e instanceof ApiError ? e.message : 'Could not sell the gift card.') }
  }
  return (
    <Drawer title="Sell a gift card" onClose={onClose}>
      <div className="flex flex-col gap-3">
        {card ? (
          <>
            <Alert tone="info">Sold. Code <b>{card.code}</b> holds {formatInr(card.balance)}.</Alert>
            <div className="flex gap-2"><Button onClick={() => void bridge.document.savePdf(giftCardHtml(card, ws.company?.legalName ?? ''), `gift-card-${card.code}`)}>{window.onesync ? 'Save slip as PDF' : 'Print slip'}</Button><Button variant="ghost" onClick={onClose}>Done</Button></div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted">The money is kept as what you owe the holder until the card is spent. It is not counted as sales yet.</p>
            <TextField label="Amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <SelectField label="Paid by" value={method} onChange={(e) => setMethod(e.target.value)} options={[{ value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI' }, { value: 'card', label: 'Card' }]} />
            <TextField label="Name on the card (optional)" value={holder} onChange={(e) => setHolder(e.target.value)} />
            <TextField label="Valid until (optional)" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
            {problem ? <Alert>{problem}</Alert> : null}
            <div className="flex gap-2"><Button busy={issue.isPending} disabled={!ready} onClick={() => void sell()}>Sell gift card</Button><Button variant="ghost" onClick={onClose}>Cancel</Button></div>
          </>
        )}
      </div>
    </Drawer>
  )
}
