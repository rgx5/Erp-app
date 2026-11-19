import { Link, type ErrorComponentProps } from '@tanstack/react-router'
import { TriangleAlert } from 'lucide-react'
import { Button } from './primitives'

/**
 * What a screen shows when something in it breaks: a plain explanation, a way to try again and a way out, with the technical text tucked away
 * for whoever supports the business. (It replaces the library's raw "Something went wrong" page.)
 */
export function ErrorPage({ error, reset }: ErrorComponentProps) {
  const text = error instanceof Error ? error.message : String(error)
  return (
    <div role="alert" className="mx-auto mt-16 flex max-w-lg flex-col items-center gap-3 rounded-lg border border-line bg-surface p-8 text-center">
      <TriangleAlert className="size-8 text-warn" aria-hidden />
      <h1 className="page-title">This screen ran into a problem</h1>
      <p className="text-sm text-muted">Nothing you have already saved or sold is lost. Try again; if it keeps happening, tell whoever looks after your software and give them the details below.</p>
      <div className="mt-1 flex gap-2">
        <Button onClick={reset}>Try again</Button>
        <Link to="/" className="inline-flex h-8 items-center rounded-md border border-line-strong bg-surface px-3 text-[13px] font-medium hover:bg-sunken">Go to the start screen</Link>
      </div>
      <details className="mt-2 w-full text-left text-xs text-muted"><summary className="cursor-pointer">Details for support</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap rounded bg-sunken p-2">{text}</pre></details>
    </div>
  )
}
