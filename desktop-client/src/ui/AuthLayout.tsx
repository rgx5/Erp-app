import { Check } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Logo } from './Logo'

const POINTS = [
  'A billing counter that keeps selling when the internet does not',
  'GST returns prepared and ready to file',
  'Stock, purchases and accounts that always agree',
  'Payroll and production when you are ready to grow',
]

/** The entrance to the app (connect and sign in): a brand panel on the left, the form on the right. Inside the desktop shell the top edge drags the window. */
export function AuthLayout({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState<string | null>(null)
  useEffect(() => { void window.onesync?.info().then((i) => setVersion(i.version)) }, [])
  return (
    <div className="grid h-full lg:grid-cols-[minmax(360px,44%)_1fr]">
      {window.onesync ? <div className="window-drag-strip" aria-hidden /> : null}
      <aside className="relative hidden flex-col justify-between overflow-hidden p-10 text-white lg:flex" style={{ background: 'linear-gradient(155deg, #0449f7 0%, #0338c4 62%, #022a94 100%)' }} aria-hidden>
        <div className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 size-96 rounded-full bg-white/5" />
        <div className="relative flex items-center gap-3"><Logo className="size-11 drop-shadow" /><span className="text-xl font-semibold tracking-tight">OneSyncERP</span></div>
        <div className="relative max-w-md">
          <p className="text-[28px] font-semibold leading-tight tracking-tight">Your whole business, in one place.</p>
          <ul className="mt-6 flex flex-col gap-3.5 text-[14px] text-white/90">
            {POINTS.map((p) => <li key={p} className="flex gap-3"><span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-white/20"><Check className="size-3" /></span>{p}</li>)}
          </ul>
        </div>
        <div className="relative text-xs text-white/70">{version && version !== 'web' ? `Version ${version} · ` : ''}© OneSyncERP</div>
      </aside>
      <main className="relative flex h-full flex-col items-center justify-center overflow-auto p-6">
        <div className="mb-5 flex flex-col items-center gap-2 lg:hidden"><Logo className="size-14 drop-shadow-sm" /><h1 className="text-lg font-semibold tracking-tight">OneSyncERP</h1></div>
        <div className="w-full max-w-md">{children}</div>
        <p className="mt-6 text-center text-xs text-faint">Need help signing in? Ask your administrator.</p>
      </main>
    </div>
  )
}
