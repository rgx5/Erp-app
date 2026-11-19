import { useState } from 'react'
import { z } from 'zod'
import { ApiError } from '@/api/errors'
import { useSession } from '@/auth/session'
import { useFlash } from '@/ui/flash'
import { useLayout, type Layout } from '@/ui/layout'
import { SimpleForm } from '@/ui/SimpleForm'
import { Alert, Button, Card, TextField } from '@/ui/primitives'
import { setMyPin } from '@/features/pos/queries'
import { can } from '@/auth/permissions'
import { changePassword, mfaActivate, mfaDisable, mfaEnroll } from './queries'

const msg = (e: unknown, f: string): string => (e instanceof ApiError ? e.message : f)

export function AccountPage() {
  const me = useSession((s) => s.me)
  const refresh = useSession((s) => s.refreshMe)
  const flash = useFlash()
  const [pin, setPin] = useState('')
  const layout = useLayout((l) => l.layout)
  const setLayout = useLayout((l) => l.set)
  const [enrol, setEnrol] = useState<{ secret: string; otpauthUri: string } | null>(null)
  const [code, setCode] = useState('')
  const [codes, setCodes] = useState<string[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [off, setOff] = useState({ password: '', code: '' })
  const enabled = me?.user?.mfaEnabled === true
  const schema = z.object({ currentPassword: z.string().min(1, 'Required'), newPassword: z.string().min(12, 'At least 12 characters'), again: z.string() }).refine((v) => v.newPassword === v.again, { path: ['again'], message: 'The two do not match' })
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <h1 className="page-title">My account</h1>
      <p className="text-sm text-muted">{me?.user?.displayName} · {me?.user?.email}</p>
      <Card title="Appearance">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-xs font-medium text-muted">Layout (kept on this computer)</legend>
          {([['classic', 'Sidebar', 'A menu down the left, grouped by area.'], ['command', 'Command centre', 'A slim rail of areas, the pages of each area as tabs, a search box (Ctrl+K), and the record you open beside the list instead of over it.']] as [Layout, string, string][]).map(([id, name, text]) => (
            <label key={id} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${layout === id ? 'border-brand bg-brand-soft' : 'border-line'}`}>
              <input type="radio" name="layout" className="mt-1" checked={layout === id} onChange={() => setLayout(id)} /><span><span className="block text-sm font-medium">{name}</span><span className="block text-xs text-muted">{text}</span></span>
            </label>))}
        </fieldset>
      </Card>
      {can(me?.permissions ?? [], 'pos:sell') ? (
        <Card title="Counter PIN">
          <div className="flex items-end gap-3"><div className="flex-1"><TextField label="PIN (4 to 8 digits)" type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} hint="Managers use it to approve a large discount at the counter." /></div>
            <Button variant="secondary" disabled={!/^\d{4,8}$/.test(pin)} onClick={async () => { try { await setMyPin(pin); setPin(''); flash.show('Counter PIN saved.') } catch (e) { flash.show(msg(e, 'Could not save the PIN.'), 'error') } }}>Save PIN</Button></div>
        </Card>) : null}
      <Card title="Change password">
        <SimpleForm schema={schema} defaults={{ currentPassword: '', newPassword: '', again: '' }} fields={['currentPassword', 'newPassword', 'again']} label="Change password"
          submit={async (v) => { try { await changePassword(v.currentPassword, v.newPassword); flash.show('Password changed.') } catch (e) { throw new Error(msg(e, 'Could not change the password.')) } }}>
          {({ register, errors }) => (<><TextField label="Current password" type="password" error={errors.currentPassword?.message as string | undefined} {...register('currentPassword')} /><TextField label="New password" type="password" hint="At least 12 characters" error={errors.newPassword?.message as string | undefined} {...register('newPassword')} /><TextField label="New password again" type="password" error={errors.again?.message as string | undefined} {...register('again')} /></>)}
        </SimpleForm>
      </Card>
      <Card title="Two-step sign-in">
        {codes ? (
          <div className="flex flex-col gap-3"><Alert tone="info">Two-step sign-in is on. Keep these recovery codes somewhere safe: each works once if you lose your authenticator app. They are not shown again.</Alert>
            <pre className="rounded border border-line bg-canvas p-3 text-sm" aria-label="Recovery codes">{codes.join('\n')}</pre><Button variant="secondary" className="self-start" onClick={() => setCodes(null)}>I have saved them</Button></div>
        ) : enabled ? (
          <div className="flex flex-col gap-3"><p className="text-sm">Two-step sign-in is <b>on</b>. To turn it off, confirm with your password and a current code.</p>
            <TextField label="Password" type="password" value={off.password} onChange={(e) => setOff({ ...off, password: e.target.value })} /><TextField label="6-digit code" value={off.code} onChange={(e) => setOff({ ...off, code: e.target.value })} />
            {problem ? <Alert>{problem}</Alert> : null}
            <Button variant="secondary" className="self-start" disabled={!off.password || !off.code} onClick={async () => { setProblem(null); try { await mfaDisable(off.password, off.code); await refresh(); flash.show('Two-step sign-in turned off.') } catch (e) { setProblem(msg(e, 'Could not turn it off.')) } }}>Turn off</Button></div>
        ) : enrol ? (
          <div className="flex flex-col gap-3"><p className="text-sm">In your authenticator app add an account with this key, then enter the 6-digit code it shows.</p>
            <code className="break-all rounded border border-line bg-canvas p-3 text-sm" aria-label="Authenticator key">{enrol.secret}</code>
            <TextField label="6-digit code" value={code} onChange={(e) => setCode(e.target.value)} />
            {problem ? <Alert>{problem}</Alert> : null}
            <Button disabled={!/^\d{6}$/.test(code)} onClick={async () => { setProblem(null); try { const r = await mfaActivate(code); setCodes(r.recoveryCodes); setEnrol(null); setCode(''); await refresh() } catch (e) { setProblem(msg(e, 'That code is not right.')) } }}>Turn on</Button></div>
        ) : (
          <div className="flex flex-col gap-3"><p className="text-sm">Add a second step to signing in: a code from an authenticator app. It protects the account if the password is stolen.</p>
            {problem ? <Alert>{problem}</Alert> : null}<Button variant="secondary" className="self-start" onClick={async () => { setProblem(null); try { setEnrol(await mfaEnroll()) } catch (e) { setProblem(msg(e, 'Could not start.')) } }}>Set up</Button></div>
        )}
      </Card>
    </div>
  )
}
