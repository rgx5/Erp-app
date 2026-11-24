import { FileText, Paperclip, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '@/api/errors'
import { Alert, Button } from '@/ui/primitives'
import { fetchAttachmentBlob, listAttachments, removeAttachment, uploadAttachment, type AttachmentMeta, type EntityType } from './files'

const size = (n: number): string => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

function Thumb({ id, alt, className }: { id: string; alt: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let live = true; let made: string | null = null
    void fetchAttachmentBlob(id).then((b) => { if (live) { made = URL.createObjectURL(b); setUrl(made) } }).catch(() => undefined)
    return () => { live = false; if (made) URL.revokeObjectURL(made) }
  }, [id])
  return url ? <img src={url} alt={alt} className={className} /> : <div className={className} aria-hidden />
}

/** Files attached to a record (a scanned bill, a purchase order copy): add, open, remove. */
export function AttachmentsPanel({ entityType, entityId, canWrite, title = 'Attachments' }: { entityType: EntityType; entityId: string; canWrite: boolean; title?: string }) {
  const [files, setFiles] = useState<AttachmentMeta[] | null>(null); const [busy, setBusy] = useState(false); const [problem, setProblem] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const load = useCallback(async () => { try { setFiles((await listAttachments(entityType, entityId)).filter((f) => f.kind === 'file')) } catch { setFiles([]) } }, [entityType, entityId])
  useEffect(() => { void load() }, [load])
  const msg = (e: unknown): string => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Something went wrong.')
  async function add(list: FileList | null) {
    if (!list?.length) return
    setBusy(true); setProblem(null)
    try { for (const f of Array.from(list)) await uploadAttachment(entityType, entityId, 'file', f); await load() } catch (e) { setProblem(msg(e)) } finally { setBusy(false); if (input.current) input.current.value = '' }
  }
  async function open(f: AttachmentMeta) {
    try { const url = URL.createObjectURL(await fetchAttachmentBlob(f.id)); const a = document.createElement('a'); a.href = url; a.download = f.filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10_000) } catch (e) { setProblem(msg(e)) }
  }
  return (
    <section className="flex flex-col gap-2 border-t border-line pt-3" aria-label={title}>
      <div className="flex items-center justify-between"><h3 className="flex items-center gap-1.5 text-sm font-semibold"><Paperclip className="size-4 text-muted" aria-hidden />{title}</h3>
        {canWrite ? <><input ref={input} type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" aria-label="Choose files to attach" onChange={(e) => void add(e.target.files)} /><Button variant="secondary" busy={busy} onClick={() => input.current?.click()}>Attach a file</Button></> : null}</div>
      {problem ? <Alert>{problem}</Alert> : null}
      {files === null ? null : files.length === 0 ? <p className="text-xs text-muted">Nothing attached.</p> : (
        <ul className="flex flex-col gap-1">{files.map((f) => (
          <li key={f.id} className="flex items-center gap-2 rounded border border-line px-2 py-1.5 text-sm">
            {f.contentType.startsWith('image/') ? <Thumb id={f.id} alt="" className="size-8 shrink-0 rounded object-cover" /> : <FileText className="size-5 shrink-0 text-muted" aria-hidden />}
            <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => void open(f)}>{f.filename}</button>
            <span className="shrink-0 text-xs text-muted">{size(f.sizeBytes)}</span>
            {canWrite ? <button type="button" aria-label={`Remove ${f.filename}`} className="shrink-0 text-muted hover:text-bad" onClick={async () => { try { await removeAttachment(f.id); await load() } catch (e) { setProblem(msg(e)) } }}><Trash2 className="size-4" aria-hidden /></button> : null}
          </li>))}</ul>)}
    </section>
  )
}

/** One photo of an item: shown, replaced with a new one, or removed. */
export function ItemPhoto({ itemId, canWrite }: { itemId: string; canWrite: boolean }) {
  const [photo, setPhoto] = useState<AttachmentMeta | null | undefined>(undefined); const [busy, setBusy] = useState(false); const [problem, setProblem] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const load = useCallback(async () => { try { setPhoto((await listAttachments('item', itemId)).find((f) => f.kind === 'photo') ?? null) } catch { setPhoto(null) } }, [itemId])
  useEffect(() => { void load() }, [load])
  async function choose(list: FileList | null) {
    const f = list?.[0]; if (!f) return
    setBusy(true); setProblem(null)
    try { await uploadAttachment('item', itemId, 'photo', f); await load() } catch (e) { setProblem(e instanceof Error ? e.message : 'Could not add the photo.') } finally { setBusy(false); if (input.current) input.current.value = '' }
  }
  return (
    <section className="flex items-center gap-4" aria-label="Photo">
      {photo ? <Thumb key={photo.id} id={photo.id} alt="Item photo" className="size-24 rounded-lg border border-line object-cover" /> : <div className="grid size-24 place-items-center rounded-lg border border-dashed border-line text-xs text-muted">{photo === undefined ? '' : 'No photo'}</div>}
      <div className="flex flex-col gap-2">
        {canWrite ? <><input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Choose a photo" onChange={(e) => void choose(e.target.files)} />
          <div className="flex gap-2"><Button variant="secondary" busy={busy} onClick={() => input.current?.click()}>{photo ? 'Change photo' : 'Add a photo'}</Button>
            {photo ? <Button variant="ghost" onClick={async () => { try { await removeAttachment(photo.id); await load() } catch (e) { setProblem(e instanceof Error ? e.message : 'Could not remove it.') } }}>Remove</Button> : null}</div></> : null}
        {problem ? <Alert>{problem}</Alert> : null}
      </div>
    </section>
  )
}
