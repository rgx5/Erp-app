import { CheckCircle2, CircleAlert, X } from 'lucide-react'
import { useEffect } from 'react'
import { cn } from './cn'
import { useFlash } from './flash'

/** The message a screen leaves behind (“Invoice posted”): a toast at the bottom right that goes by itself, instead of a banner that pushes the page down. */
export function Toasts() {
  const flash = useFlash()
  useEffect(() => {
    if (!flash.message) return
    const t = setTimeout(flash.clear, flash.tone === 'error' ? 9000 : 4500)
    return () => clearTimeout(t)
  }, [flash.message, flash.tone, flash.clear])
  if (!flash.message) return null
  const bad = flash.tone === 'error'
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-50 flex max-w-[420px] justify-end" aria-live="polite">
      <div role={bad ? 'alert' : 'status'} className={cn('toast pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-surface py-2.5 pl-3 pr-2 text-[13px] shadow-pop', bad ? 'border-bad/30' : 'border-line')}>
        {bad ? <CircleAlert className="mt-0.5 size-4 shrink-0 text-bad" aria-hidden /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-good" aria-hidden />}
        <span className="min-w-0 flex-1 leading-snug">{flash.message}</span>
        <button type="button" aria-label="Dismiss" onClick={flash.clear} className="grid size-6 shrink-0 place-items-center rounded text-muted hover:bg-sunken hover:text-ink"><X className="size-3.5" aria-hidden /></button>
      </div>
    </div>
  )
}
