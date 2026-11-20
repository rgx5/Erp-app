import { useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { ApiError } from '@/api/errors'
import { useSession } from '@/auth/session'
import { Alert, Button, Card, TextField } from '@/ui/primitives'
import { AuthLayout } from '@/ui/AuthLayout'

export function LoginPage() {
  const { login, server, tenant: savedTenant, email: savedEmail } = useSession()
  const navigate = useNavigate()
  const [tenant, setTenant] = useState(savedTenant)
  const [email, setEmail] = useState(savedEmail)
  const [password, setPassword] = useState('')
  const [mfaCode, setMfaCode] = useState('')
  const [needsCode, setNeedsCode] = useState(false)
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login({ tenant, email, password, remember, ...(needsCode ? { mfaCode } : {}) })
      await navigate({ to: '/' })
    } catch (err) {
      if (err instanceof ApiError && err.code === 'mfa_required') { setNeedsCode(true); setError(null) }
      else setError(err instanceof ApiError && err.status === 429 ? 'Too many attempts. Wait a few minutes and try again.' : err instanceof Error ? err.message : 'Sign-in failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout>
      <Card className="w-full" title="Sign in">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <p className="text-xs text-muted">Server: {server?.url} · <button type="button" className="underline" onClick={() => void navigate({ to: '/connect' })}>change</button></p>
          <TextField label="Business code" value={tenant} onChange={(e) => setTenant(e.target.value)} autoFocus={!savedTenant} required autoCapitalize="off" hint="The short name of your business on this server." />
          <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus={Boolean(savedTenant) && !savedEmail} required />
          <TextField label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus={Boolean(savedEmail)} required />
          {needsCode ? <TextField label="Authenticator code" inputMode="numeric" value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} autoFocus required hint="Six digits from your authenticator app, or a recovery code." /> : null}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Keep me signed in on this computer</label>
          {!remember || (typeof window !== 'undefined' && !window.onesync) ? <p className="text-xs text-muted">{window.onesync ? 'You will be asked for your password next time.' : 'In a browser window you will be asked again when you reopen it.'}</p> : null}
          {error ? <Alert>{error}</Alert> : null}
          <Button type="submit" busy={busy}>Sign in</Button>
        </form>
      </Card>
    </AuthLayout>
  )
}
