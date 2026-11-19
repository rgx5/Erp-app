import { useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { useSession } from '@/auth/session'
import { Alert, Button, Card, TextField } from '@/ui/primitives'
import { Logo } from '@/ui/Logo'

export function ConnectPage() {
  const connect = useSession((s) => s.connect)
  const saved = useSession((s) => s.server?.url ?? '')
  const navigate = useNavigate()
  const [url, setUrl] = useState(saved)
  const [remote, setRemote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await connect(url, remote)
      await navigate({ to: '/login' })
    } catch (err) {
      setError(err instanceof Error ? (err.name === 'ApiError' ? 'That address answered, but it is not a OneSyncERP server.' : err.message) : 'Could not connect.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex h-full flex-col items-center justify-center p-6">
      <div className="mb-5 flex flex-col items-center gap-2"><Logo className="size-14 drop-shadow-sm" /><p className="text-lg font-semibold tracking-tight">OneSyncERP</p></div>
      <Card className="w-full max-w-md" title="Connect to your server">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <TextField label="Server address" placeholder="erp.yourcompany.com" value={url} onChange={(e) => setUrl(e.target.value)} autoFocus required hint="The address your administrator gave you." />
          <TextField label="Remote address (optional)" placeholder="yourshop.remote.example.in" value={remote} onChange={(e) => setRemote(e.target.value)} hint="Used only when you are away and the office address cannot be reached." />
          {error ? <Alert>{error}</Alert> : null}
          <Button type="submit" busy={busy}>Continue</Button>
        </form>
      </Card>
    </main>
  )
}
