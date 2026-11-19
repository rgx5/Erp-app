import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import { cn } from './cn'

export function Button({ variant = 'primary', busy, className, children, disabled, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; busy?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      className={cn(
        'inline-flex h-8 shrink-0 select-none items-center justify-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-[background-color,border-color,color,transform] duration-100 active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'bg-brand text-brand-ink hover:bg-[#1a44bd] active:bg-[#173ca3]',
        variant === 'secondary' && 'border border-line-strong bg-surface text-ink hover:bg-sunken hover:border-faint',
        variant === 'ghost' && 'text-muted hover:bg-line/60 hover:text-ink',
        variant === 'danger' && 'border border-bad/40 bg-surface text-bad hover:bg-bad-soft',
        className,
      )}
    >
      {busy ? <Spinner className="size-3.5" /> : null}
      {children}
    </button>
  )
}

/** Inside a button (given a size) it is a small ring; on its own, while a screen's data loads, it is a quiet skeleton of the page so nothing jumps when the data arrives. */
export function Spinner({ className }: { className?: string }) {
  if (className) return <span role="status" aria-label="Loading" className={cn('inline-block animate-spin rounded-full border-2 border-current border-t-transparent', className)} />
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-3">
      <div className="skeleton h-7 w-56" />
      <div className="rounded-lg border border-line bg-surface p-3">
        {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="skeleton my-2.5 h-3.5" style={{ width: `${96 - i * 7}%` }} />)}
      </div>
    </div>
  )
}

/** The page title block every screen opens with: a title, one line of context under it, and the screen's main actions at the right. */
export function PageHeader({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div className="min-w-0"><h1 className="page-title truncate">{title}</h1>{sub ? <p className="page-sub mt-0.5">{sub}</p> : null}</div>
      {children ? <div className="flex shrink-0 items-center gap-2">{children}</div> : null}
    </div>
  )
}

/** A small state tag: a coloured dot and the word, so a column of them reads at a glance without a block of colour. */
export function Tag({ tone = 'neutral', children }: { tone?: 'good' | 'bad' | 'warn' | 'info' | 'neutral'; children: ReactNode }) {
  const dot = { good: 'bg-good', bad: 'bg-bad', warn: 'bg-warn', info: 'bg-brand', neutral: 'bg-faint' }[tone]
  const text = { good: 'text-good', bad: 'text-bad', warn: 'text-warn', info: 'text-brand', neutral: 'text-muted' }[tone]
  return <span className={cn('inline-flex items-center gap-1.5 text-[12px] font-medium', text)}><span className={cn('size-1.5 rounded-full', dot)} aria-hidden />{children}</span>
}

export const TextField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string | undefined; hint?: string | undefined }>(function TextField({ label, error, hint, className, ...rest }, ref) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[12px] font-medium text-muted">{label}</label>
      <input
        id={id}
        ref={ref}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        {...rest}
        className={cn('h-8 w-full min-w-0 rounded-md border bg-surface px-2.5 text-[13px] outline-none placeholder:text-faint hover:border-faint focus:border-brand focus:ring-[3px] focus:ring-brand/15', error ? 'border-bad' : 'border-line-strong', className)}
      />
      {error ? <p id={`${id}-error`} className="text-xs text-bad">{error}</p> : hint ? <p id={`${id}-hint`} className="text-xs text-muted">{hint}</p> : null}
    </div>
  )
})

export function Card({ title, action, children, className }: { title?: string | undefined; action?: ReactNode; children: ReactNode; className?: string | undefined }) {
  return (
    <section className={cn('rounded-lg border border-line bg-surface', className)}>
      {title ? (
        <header className="flex h-10 items-center justify-between border-b border-line px-4">
          <h2 className="text-[12.5px] font-semibold text-ink">{title}</h2>
          {action}
        </header>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  )
}

export function Alert({ tone = 'error', children }: { tone?: 'error' | 'info'; children: ReactNode }) {
  return <div role={tone === 'error' ? 'alert' : 'status'} className={cn('rounded-md border border-l-[3px] px-3.5 py-2.5 text-[13px]', tone === 'error' ? 'border-bad/25 border-l-bad bg-bad-soft text-ink' : 'border-brand/20 border-l-brand bg-brand-soft text-ink')}>{children}</div>
}

export const SelectField = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string | undefined; options: readonly { value: string; label: string }[] }>(function SelectField({ label, error, options, className, ...rest }, ref) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[12px] font-medium text-muted">{label}</label>
      <select id={id} ref={ref} aria-invalid={error ? true : undefined} {...rest} className={cn('h-8 w-full min-w-0 rounded-md border bg-surface px-2 text-[13px] outline-none hover:border-faint focus:border-brand focus:ring-[3px] focus:ring-brand/15', error ? 'border-bad' : 'border-line-strong', className)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {error ? <p className="text-xs text-bad">{error}</p> : null}
    </div>
  )
})

export const CheckField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }>(function CheckField({ label, hint, ...rest }, ref) {
  const id = useId()
  return (
    <div className="flex items-start gap-2">
      <input id={id} ref={ref} type="checkbox" className="mt-0.5 size-3.5" {...rest} />
      <label htmlFor={id} className="text-sm">{label}{hint ? <span className="block text-xs text-muted">{hint}</span> : null}</label>
    </div>
  )
})

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="filterbar">{children}</div>
}
