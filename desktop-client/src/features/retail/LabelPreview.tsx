import { Printer } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { bridge } from '@/bridge'
import { Drawer } from '@/ui/Drawer'
import { Alert, Button, SelectField } from '@/ui/primitives'
import type { LabelSize } from './labels'

const KEY = 'onesync.labelPrinter'
const remembered = (): string => { try { return localStorage.getItem(KEY) ?? '' } catch { return '' } }
const remember = (v: string): void => { try { localStorage.setItem(KEY, v) } catch { /* not remembered */ } }
const ASK = ''

/** What the labels will look like, before anything is printed, with a straight-to-the-printer button and a PDF. */
export function LabelPreview({ html, size, count, onClose }: { html: string; size: LabelSize; count: number; onClose: () => void }) {
  const [printers, setPrinters] = useState<{ name: string; isDefault: boolean }[]>([])
  const [printer, setPrinter] = useState(remembered)
  const [busy, setBusy] = useState(false); const [problem, setProblem] = useState<string | null>(null); const [done, setDone] = useState<string | null>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const desktop = typeof window !== 'undefined' && window.onesync !== undefined
  useEffect(() => { if (desktop) void bridge.printer.list().then((l) => { setPrinters(l); setPrinter((cur) => (cur && l.some((p) => p.name === cur) ? cur : '')) }).catch(() => undefined) }, [desktop])

  async function printNow() {
    setProblem(null); setDone(null); setBusy(true)
    try {
      if (desktop) {
        const sheet = size.perRow > 1
        await bridge.printer.printDocument(html, { ...(printer ? { printerName: printer } : {}), ...(sheet ? {} : { widthMm: size.widthMm, heightMm: size.heightMm }) })
        setDone(printer ? `Sent to ${printer}.` : 'Sent to the print window.')
      } else { frame.current?.contentWindow?.focus(); frame.current?.contentWindow?.print() }
    } catch (e) { setProblem(e instanceof Error ? e.message : 'Could not print.') } finally { setBusy(false) }
  }
  async function savePdf() {
    setProblem(null); setBusy(true)
    try { await bridge.document.savePdf(html, 'labels') } catch (e) { setProblem(e instanceof Error ? e.message : 'Could not make the PDF.') } finally { setBusy(false) }
  }

  return (
    <Drawer title="Label preview" onClose={onClose} width={760}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">{count.toLocaleString('en-IN')} label{count === 1 ? '' : 's'} on {size.name}. This is how they will print.</p>
        <iframe ref={frame} title="Label preview" sandbox="allow-same-origin allow-modals" srcDoc={html} className="h-[52vh] w-full rounded-md border border-line bg-white" />
        {desktop ? (
          <div className="w-80"><SelectField label="Printer" value={printer} onChange={(e) => { setPrinter(e.target.value); remember(e.target.value) }} options={[{ value: ASK, label: 'Choose when printing' }, ...printers.map((p) => ({ value: p.name, label: p.isDefault ? `${p.name} (default)` : p.name }))]} /></div>
        ) : null}
        {problem ? <Alert>{problem}</Alert> : null}
        {done ? <Alert tone="info">{done}</Alert> : null}
        <div className="flex gap-2">
          <Button busy={busy} onClick={() => void printNow()}><Printer className="size-4" aria-hidden /> {printer ? 'Print now' : 'Print'}</Button>
          <Button variant="secondary" disabled={busy} onClick={() => void savePdf()}>{desktop ? 'Open as PDF' : 'Save as PDF'}</Button>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Drawer>
  )
}
