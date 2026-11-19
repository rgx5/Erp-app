import { cn } from './cn'

/** The OneSyncERP mark: a blue tile with a white sync arrow and one orange block. Sized by the caller (`size-8` and so on). */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 1254 1254" className={cn('shrink-0', className)} role="img" aria-label="OneSyncERP">
      <rect x="63" y="67" width="1127" height="1123" rx="215" fill="#0449f7" />
      <g fill="#fff" stroke="#fff" strokeWidth="16" strokeLinejoin="round">
        <path d="M652 323A351 351 0 1 0 972 642L860 642A239 239 0 1 1 652 451Z" />
        <path d="M660 272L660 526L824 400Z" />
      </g>
      <rect x="842" y="441" width="168" height="166" rx="42" fill="#ff981f" />
    </svg>
  )
}
