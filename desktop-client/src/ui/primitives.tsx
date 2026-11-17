import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'
import { cn } from './cn'

export function Button({ variant = 'primary', busy, className, children, disabled, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost'; busy?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      className={cn(
        'inline-flex h-9 items-center justify-center gap-2 rounded-md px-3.5 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60',
        variant === 'primary' && 'bg-brand text-brand-ink hover:opacity-90',
        variant === 'secondary' && 'border border-line bg-surface text-ink hover:bg-canvas',
        variant === 'ghost' && 'text-muted hover:bg-canvas hover:text-ink',
        className,
      )}
    >
      {busy ? <Spinner /> : null}
      {children}
    </button>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <span role="status" aria-label="Loading" className={cn('inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent', className)} />
}

export const TextField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string | undefined; hint?: string }>(function TextField({ label, error, hint, className, ...rest }, ref) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-muted">{label}</label>
      <input
        id={id}
        ref={ref}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        {...rest}
        className={cn('h-9 rounded-md border bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30', error ? 'border-bad' : 'border-line', className)}
      />
      {error ? <p id={`${id}-error`} className="text-xs text-bad">{error}</p> : hint ? <p id={`${id}-hint`} className="text-xs text-muted">{hint}</p> : null}
    </div>
  )
})

export function Card({ title, action, children, className }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-lg border border-line bg-surface', className)}>
      {title ? (
        <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          {action}
        </header>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  )
}

export function Alert({ tone = 'error', children }: { tone?: 'error' | 'info'; children: ReactNode }) {
  return <div role={tone === 'error' ? 'alert' : 'status'} className={cn('rounded-md border px-3 py-2 text-sm', tone === 'error' ? 'border-bad/40 bg-bad/10 text-bad' : 'border-brand/30 bg-brand/10 text-ink')}>{children}</div>
}
