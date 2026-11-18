import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import { cn } from './cn'

export function Button({ variant = 'primary', busy, className, children, disabled, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost'; busy?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      className={cn(
        'inline-flex h-8 items-center justify-center gap-2 rounded-md px-3 text-[13px] font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'bg-brand text-brand-ink shadow-card hover:brightness-110 active:brightness-95',
        variant === 'secondary' && 'border border-line bg-surface text-ink shadow-card hover:border-[#cbd3e1] hover:bg-canvas',
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

export const TextField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string | undefined; hint?: string | undefined }>(function TextField({ label, error, hint, className, ...rest }, ref) {
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
        className={cn('h-8 rounded-md border bg-surface px-2.5 text-[13px] outline-none placeholder:text-muted/60 hover:border-[#cbd3e1] focus:border-brand focus:ring-2 focus:ring-brand/20', error ? 'border-bad' : 'border-line', className)}
      />
      {error ? <p id={`${id}-error`} className="text-xs text-bad">{error}</p> : hint ? <p id={`${id}-hint`} className="text-xs text-muted">{hint}</p> : null}
    </div>
  )
})

export function Card({ title, action, children, className }: { title?: string | undefined; action?: ReactNode; children: ReactNode; className?: string | undefined }) {
  return (
    <section className={cn('rounded-lg border border-line bg-surface shadow-card', className)}>
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
  return <div role={tone === 'error' ? 'alert' : 'status'} className={cn('rounded-lg border px-3.5 py-2.5 text-sm', tone === 'error' ? 'border-bad/30 bg-[#fdf2f1] text-bad' : 'border-brand/20 bg-brand-soft text-ink')}>{children}</div>
}

export const SelectField = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string | undefined; options: readonly { value: string; label: string }[] }>(function SelectField({ label, error, options, className, ...rest }, ref) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-muted">{label}</label>
      <select id={id} ref={ref} aria-invalid={error ? true : undefined} {...rest} className={cn('h-8 rounded-md border bg-surface px-2 text-[13px] outline-none hover:border-[#cbd3e1] focus:border-brand focus:ring-2 focus:ring-brand/20', error ? 'border-bad' : 'border-line', className)}>
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
      <input id={id} ref={ref} type="checkbox" className="mt-0.5 size-4" {...rest} />
      <label htmlFor={id} className="text-sm">{label}{hint ? <span className="block text-xs text-muted">{hint}</span> : null}</label>
    </div>
  )
})

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-end gap-3">{children}</div>
}
