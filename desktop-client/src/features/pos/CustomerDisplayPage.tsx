import { useEffect, useState } from 'react'
import { formatInr } from '@/domain/format'
import { Logo } from '@/ui/Logo'
import { listenDisplay, publishDisplay, type DisplayMessage } from './customerDisplay'

/** The screen that faces the customer: the bill as it is rung up, the total in large type, and a thank-you. It needs no sign-in: it only shows what the counter sends it. */
export function CustomerDisplayPage() {
  const [m, setM] = useState<DisplayMessage>({ type: 'idle', shop: '' })
  useEffect(() => {
    const off = listenDisplay((msg) => { if (msg.type !== 'hello') setM(msg) })
    publishDisplay({ type: 'hello' }) // ask the counter to show what it has now
    return off
  }, [])
  useEffect(() => { if (m.type === 'done') { const t = setTimeout(() => setM({ type: 'idle', shop: m.shop }), 9000); return () => clearTimeout(t) } return undefined }, [m])
  const shop = m.type === 'hello' ? '' : m.shop
  return (
    <main className="flex h-full flex-col bg-white p-10 text-ink" aria-label="Customer display">
      <header className="flex items-center gap-3"><Logo className="size-12" /><span className="text-2xl font-semibold tracking-tight">{shop || 'Welcome'}</span></header>
      {m.type === 'cart' && m.lines.length > 0 ? (
        <>
          <ul className="mt-8 flex-1 overflow-auto text-2xl" aria-label="Your items">
            {m.lines.map((l, i) => <li key={i} className="flex items-baseline justify-between gap-6 border-b border-line py-3"><span className="min-w-0 truncate">{l.name} <span className="text-muted">× {l.qty}</span></span><span className="num shrink-0">{formatInr(l.amount, { symbol: false })}</span></li>)}
          </ul>
          <div className="mt-6 flex items-baseline justify-between border-t-2 border-ink pt-4"><span className="text-3xl font-semibold">Total</span><span className="num text-6xl font-bold" aria-label="Total">{formatInr(m.total)}</span></div>
        </>
      ) : m.type === 'done' ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <p className="text-6xl font-bold">Thank you!</p>
          <p className="text-3xl text-muted">Total {formatInr(m.total)}</p>
          {Number(m.change) > 0 ? <p className="text-4xl font-semibold">Change {formatInr(m.change)}</p> : null}
        </div>
      ) : <div className="flex flex-1 items-center justify-center text-4xl text-muted">Welcome</div>}
    </main>
  )
}
