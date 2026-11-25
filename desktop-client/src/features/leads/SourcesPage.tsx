import { useState } from 'react'
import { z } from 'zod'
import { useSession } from '@/auth/session'
import { Drawer } from '@/ui/Drawer'
import { useFlash } from '@/ui/flash'
import { SimpleForm } from '@/ui/SimpleForm'
import { Alert, Button, Card, SelectField, Spinner, TextField } from '@/ui/primitives'
import { ago, useConnectors, useDeliveries, useLeadActions, type Connector } from './queries'

const KINDS: { value: Connector['kind']; label: string; blurb: string }[] = [
  { value: 'website', label: 'Website form', blurb: 'Enquiries from a form on your website or landing pages.' },
  { value: 'meta', label: 'Facebook and Instagram lead ads', blurb: 'Leads from lead forms on your Facebook or Instagram ads, within seconds.' },
  { value: 'google', label: 'Google Ads lead forms', blurb: 'Leads from lead form extensions on your Google Ads campaigns.' },
  { value: 'webhook', label: 'Another system', blurb: 'IndiaMART, a chatbot, Zapier or your own software: anything that can send a web request.' },
]
const copy = async (text: string, flash: (m: string) => void): Promise<void> => { try { await navigator.clipboard.writeText(text); flash('Copied.') } catch { flash('Could not copy: select the text and copy it.') } }

const snippet = (url: string): string => `<form id="enquiry">
  <input name="name" placeholder="Your name" required>
  <input name="phone" placeholder="Mobile number" required>
  <input name="city" placeholder="City">
  <input name="message" placeholder="What are you looking for?">
  <input name="_hp" style="display:none" tabindex="-1" autocomplete="off">
  <label><input type="checkbox" name="consent" value="yes" required> I agree to be contacted about my enquiry</label>
  <button>Get a free quote</button>
</form>
<script>
(function () {
  var f = document.getElementById('enquiry');
  f.addEventListener('submit', function (e) {
    e.preventDefault();
    var d = {}; new FormData(f).forEach(function (v, k) { d[k] = v; });
    var q = new URLSearchParams(location.search);
    ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','fbclid'].forEach(function (k) { if (q.get(k)) d[k] = q.get(k); });
    d.page_url = location.href;
    fetch('${url}', { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(d) })
      .then(function () { f.reset(); alert('Thank you! We will call you shortly.'); });
  });
})();
</script>`

const addSchema = z.object({ kind: z.string(), name: z.string().trim().min(1, 'Give it a name').max(100), allowedDomains: z.string().trim(), pageId: z.string().trim().max(40), pageAccessToken: z.string().trim().max(1000), appSecret: z.string().trim().max(200), defaultCampaign: z.string().trim().max(200) })

function AddDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: (c: Connector) => void }) {
  const a = useLeadActions(); const [kind, setKind] = useState<Connector['kind']>('website')
  return (
    <Drawer title="Add a lead source" onClose={onClose} width={560}>
      <div className="flex flex-col gap-3">
        <SelectField label="What kind of source?" value={kind} onChange={(e) => setKind(e.target.value as Connector['kind'])} options={KINDS.map((k) => ({ value: k.value, label: k.label }))} />
        <p className="text-sm text-muted">{KINDS.find((k) => k.value === kind)?.blurb}</p>
        <SimpleForm schema={addSchema} defaults={{ kind: 'website', name: '', allowedDomains: '', pageId: '', pageAccessToken: '', appSecret: '', defaultCampaign: '' }} fields={['name', 'pageAccessToken']} label="Create"
          submit={async (v) => {
            const c = await a.createConnector.mutateAsync({ kind, name: v.name, ...(v.allowedDomains ? { allowedDomains: v.allowedDomains.split(/[\s,]+/).filter(Boolean) } : {}), ...(kind === 'meta' ? { ...(v.pageId ? { pageId: v.pageId } : {}), pageAccessToken: v.pageAccessToken, ...(v.appSecret ? { appSecret: v.appSecret } : {}) } : {}), ...(v.defaultCampaign ? { defaultCampaign: v.defaultCampaign } : {}) })
            onCreated(c)
          }}>
          {({ register, errors }) => (<>
            <TextField label="Name" placeholder={kind === 'meta' ? 'Facebook solar page' : kind === 'google' ? 'Google solar campaign' : 'Main website'} error={errors.name?.message as string | undefined} {...register('name')} />
            {kind === 'website' || kind === 'webhook' ? <TextField label="Allowed websites (optional)" placeholder="example.in, shop.example.in" hint="If set, only forms on these sites are accepted." {...register('allowedDomains')} /> : null}
            {kind === 'meta' ? (<>
              <TextField label="Facebook page ID" {...register('pageId')} />
              <TextField label="Page access token" type="password" error={errors.pageAccessToken?.message as string | undefined} hint="A long-lived token with the leads_retrieval permission. It is stored encrypted and never shown again." {...register('pageAccessToken')} />
              <TextField label="App secret" type="password" hint="From your Meta app's settings. Used to check that calls really come from Meta." {...register('appSecret')} />
            </>) : null}
            <TextField label="Campaign name when the form does not say (optional)" {...register('defaultCampaign')} />
          </>)}
        </SimpleForm>
      </div>
    </Drawer>
  )
}

function Setup({ c, base, flash }: { c: Connector; base: string; flash: (m: string) => void }) {
  const url = `${base}${c.path}`
  const row = (label: string, value: string) => (
    <div className="flex items-center gap-2"><span className="w-32 shrink-0 text-xs text-muted">{label}</span><code className="min-w-0 flex-1 truncate rounded bg-sunken px-2 py-1 text-xs">{value}</code><Button variant="ghost" onClick={() => void copy(value, flash)}>Copy</Button></div>
  )
  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3 text-sm">
      {c.kind === 'website' || c.kind === 'webhook' ? (<>
        {row('Address', url)}
        <p className="text-muted">Send an HTTP POST with JSON or form fields: <code>name</code>, <code>phone</code> (or <code>email</code>), <code>city</code>, <code>pincode</code> and anything else; extra fields are kept, and filed under your own detail fields when their names match. <code>utm_*</code>, <code>gclid</code> and <code>fbclid</code> are kept.</p>
        <details><summary className="cursor-pointer underline">Copy-paste form for your website</summary>
          <pre className="mt-2 max-h-64 overflow-auto rounded bg-sunken p-2 text-xs">{snippet(url)}</pre><Button variant="secondary" className="mt-2" onClick={() => void copy(snippet(url), flash)}>Copy the form</Button></details>
      </>) : null}
      {c.kind === 'google' ? (<>
        {row('Webhook URL', url)}{row('Key', c.config.googleKey ?? '')}
        <ol className="list-decimal pl-5 text-muted"><li>In Google Ads, open your lead form asset and choose <b>Webhook integration</b>.</li><li>Paste the webhook URL and the key above.</li><li>Press <b>Send test data</b> in Google Ads, then use Test below to see a lead arrive here.</li></ol>
      </>) : null}
      {c.kind === 'meta' ? (<>
        {row('Callback URL', url)}{row('Verify token', c.config.verifyToken ?? '')}
        <ol className="list-decimal pl-5 text-muted"><li>In your Meta app (developers.facebook.com), add <b>Webhooks</b>, choose <b>Page</b>, and subscribe to <b>leadgen</b>.</li><li>Paste the callback URL and verify token above, and save. Meta checks the address at once.</li><li>Subscribe the app to your page, and make sure the page access token has <b>leads_retrieval</b> and <b>pages_manage_metadata</b>.</li><li>Live ads need the app to have Meta's approval for lead retrieval. Until then it works for people who have a role on the app.</li></ol>
      </>) : null}
    </div>
  )
}

function Card1({ c, base }: { c: Connector; base: string }) {
  const a = useLeadActions(); const flash = useFlash()
  const [open, setOpen] = useState(false); const [log, setLog] = useState(false); const [problem, setProblem] = useState<string | null>(null)
  const del = useDeliveries(log ? c.id : null)
  const kind = KINDS.find((k) => k.value === c.kind)
  const run = async (f: () => Promise<unknown>, m?: string): Promise<void> => { setProblem(null); try { await f(); if (m) flash.show(m) } catch (e) { setProblem(e instanceof Error ? e.message : 'Something went wrong.') } }
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{c.name} <span className={`ml-2 rounded px-2 py-0.5 text-xs font-medium ${c.status === 'active' ? 'bg-good/15 text-good' : 'bg-warn/15 text-warn'}`}>{c.status === 'active' ? 'On' : 'Paused'}</span></h2>
          <p className="text-xs text-muted">{kind?.label} · {c.leadCount} lead{c.leadCount === 1 ? '' : 's'}{c.lastLeadAt ? ` · last ${ago(c.lastLeadAt)}` : ' · none yet'}</p>
          {c.lastError ? <p className="mt-1 text-xs text-bad">Last problem: {c.lastError}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setOpen(!open)}>{open ? 'Hide setup' : 'Setup'}</Button>
          <Button variant="secondary" busy={a.testConnector.isPending} onClick={() => void run(() => a.testConnector.mutateAsync(c.id), 'A test lead was created.')}>Send test lead</Button>
          <Button variant="secondary" onClick={() => setLog(!log)}>Recent deliveries</Button>
          <Button variant="secondary" onClick={() => void run(() => a.updateConnector.mutateAsync({ id: c.id, body: { status: c.status === 'active' ? 'paused' : 'active' } }))}>{c.status === 'active' ? 'Pause' : 'Resume'}</Button>
          <Button variant="ghost" onClick={() => { if (window.confirm(`Remove ${c.name}? Its leads stay; the address stops working.`)) void run(() => a.deleteConnector.mutateAsync(c.id)) }}>Remove</Button>
        </div>
      </div>
      {problem ? <div className="mt-2"><Alert>{problem}</Alert></div> : null}
      {open ? <Setup c={c} base={base} flash={flash.show} /> : null}
      {log ? (
        <div className="mt-3 border-t border-line pt-3 text-sm">
          {del.isPending ? <Spinner /> : (del.data ?? []).length === 0 ? <p className="text-muted">Nothing has arrived yet.</p> : (
            <ul className="max-h-60 overflow-auto">{(del.data ?? []).map((d) => <li key={d.id} className="flex justify-between gap-3 border-b border-line/60 py-1"><span><b className={d.outcome === 'error' || d.outcome === 'rejected' ? 'text-bad' : ''}>{d.outcome}</b>{d.detail ? ` · ${d.detail}` : ''}</span><span className="text-xs text-muted">{ago(d.createdAt)}</span></li>)}</ul>)}
        </div>
      ) : null}
    </Card>
  )
}

/** Where leads come from: connect the website, Facebook and Instagram lead ads, Google Ads lead forms, or any system. */
export function SourcesPage() {
  const q = useConnectors(); const base = useSession((s) => s.server?.url ?? '').replace(/\/$/, '')
  const [adding, setAdding] = useState(false); const [fresh, setFresh] = useState<Connector | null>(null)
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <div className="flex items-center justify-between"><div><h1 className="page-title">Lead sources</h1><p className="page-sub">Connect where your enquiries come from. Each source has its own address; enquiries arrive as leads within seconds.</p></div><Button onClick={() => setAdding(true)}>Add a source</Button></div>
      {q.isPending ? <Spinner /> : q.error ? <Alert>{q.error.message}</Alert> : (q.data ?? []).length === 0 ? <Alert tone="info">No sources yet. Add your website form first: it takes a minute.</Alert> : (q.data ?? []).map((c) => <Card1 key={c.id} c={c} base={base} />)}
      <p className="text-xs text-muted">Sources need this server to be reachable from the internet. Enquiries are checked for a phone number or email, and the same person asking twice is kept as one lead.</p>
      {adding ? <AddDrawer onClose={() => setAdding(false)} onCreated={(c) => { setAdding(false); setFresh(c) }} /> : null}
      {fresh ? <Drawer title={`${fresh.name} is ready`} onClose={() => setFresh(null)} width={620}><div className="flex flex-col gap-3"><Alert tone="info">Now finish the setup on the other side. You can open this again any time with Setup.</Alert><Setup c={fresh} base={base} flash={(m) => window.alert(m)} /></div></Drawer> : null}
    </div>
  )
}
