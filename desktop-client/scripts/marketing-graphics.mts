// Turns the raw product screenshots into marketing graphics. Run from desktop-client/ (it has playwright):
//   npx tsx ../marketing/build-graphics.mts
import { chromium } from '@playwright/test'
import { readFileSync } from 'node:fs'

const RAW = '/home/user/Erp-app/marketing/raw/'
const OUT = '/home/user/Erp-app/marketing/graphics/'
const b64 = (p: string) => `data:image/png;base64,${readFileSync(p).toString('base64')}`
const icon = b64('/home/user/Erp-app/desktop-client/build/icon.png')

interface G { file: string; w: number; h: number; theme: 'dark' | 'light'; layout: 'split' | 'center' | 'trio'; eyebrow: string; title: string; sub: string; shots: string[]; pills?: string[]; pos?: string }

const css = (g: G) => `
*{box-sizing:border-box;margin:0}
body{width:${g.w}px;height:${g.h}px;overflow:hidden;font-family:Inter,'Segoe UI',system-ui,sans-serif;position:relative;
 background:${g.theme === 'dark' ? 'radial-gradient(1000px 640px at 100% 0%,#2b59ff2e,transparent 62%),radial-gradient(800px 520px at 0% 100%,#2b59ff1a,transparent 60%),linear-gradient(135deg,#eef3ff,#e4ecff)' : 'radial-gradient(900px 560px at 95% 0%,#2b59ff1c,transparent 60%),#f8f9fd'};
 color:#0e1220}
.brand{display:flex;align-items:center;gap:16px;font-weight:700;font-size:${g.w > 1500 ? 38 : 32}px;letter-spacing:-.01em}
.brand img{width:${g.w > 1500 ? 46 : 40}px;height:${g.w > 1500 ? 46 : 40}px;border-radius:12px;background:#2b59ff;padding:5px}
.eyebrow{font-weight:700;letter-spacing:.14em;text-transform:uppercase;font-size:${g.w > 1500 ? 19 : 17}px;color:#ff8a1f}
h1{font-weight:800;letter-spacing:-.035em;line-height:1.04}
.sub{color:#4a5266;line-height:1.45}
h1 em{font-style:normal;color:#2b59ff}
.pills{display:flex;flex-wrap:wrap;gap:12px}
.pill{padding:10px 18px;border-radius:999px;font-weight:700;font-size:${g.w > 1500 ? 20 : 17}px;background:#fff;color:#2b59ff;border:1.5px solid #c9d6ff}
.win{position:absolute;border-radius:18px;overflow:hidden;background:#fff;box-shadow:0 36px 80px #0c174733,0 0 0 1px #0000001a}
.win .bar{height:34px;background:#eceff7;display:flex;align-items:center;gap:8px;padding:0 14px}
.win .bar i{width:12px;height:12px;border-radius:50%;display:block}
.win img{display:block;width:100%}
.url{position:absolute;bottom:${g.w > 1500 ? 34 : 28}px;font-weight:600;font-size:${g.w > 1500 ? 22 : 19}px;color:#2b59ff}
.note{position:absolute;font-size:14px;color:#7c859c}
`
const win = (src: string, style: string, pos = 'top left') => `<div class="win" style="${style}"><div class="bar"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></div><div style="overflow:hidden"><img src="${src}" style="width:100%;height:auto"></div></div>`

const accent = (t: string): string => t.replace(/\{([^}]+)\}/g, '<em>$1</em>')

function html(g: G): string {
  const pills = (g.pills ?? []).map((p) => `<span class="pill">${p}</span>`).join('')
  const logo = `<div class="brand"><svg viewBox="0 0 1254 1254" width="${g.w > 1500 ? 64 : 54}" height="${g.w > 1500 ? 64 : 54}"><rect x="63" y="67" width="1127" height="1123" rx="215" fill="#0449f7"/><g fill="#fff" stroke="#fff" stroke-width="16" stroke-linejoin="round"><path d="M652 323A351 351 0 1 0 972 642L860 642A239 239 0 1 1 652 451Z"/><path d="M660 272L660 526L824 400Z"/></g><rect x="842" y="441" width="168" height="166" rx="42" fill="#ff981f"/></svg>OneSyncERP</div>`
  const shots = g.shots.map(b64)
  let body = ''
  if (g.layout === 'split') {
    body = `<div style="position:absolute;left:96px;top:84px">${logo}</div>
      <div style="position:absolute;left:96px;top:250px;width:640px"><h1 style="font-size:78px;margin:0 0 26px">${accent(g.title)}</h1><p class="sub" style="font-size:27px;margin-bottom:34px">${g.sub}</p><div class="pills">${pills}</div></div>
      ${win(shots[0]!, 'left:800px;top:190px;width:1030px;', g.pos)}
      <div class="url" style="left:96px">onesyncerp.com</div><div class="note" style="left:96px;bottom:12px">Sample data shown</div>`
  } else if (g.layout === 'center') {
    const sq = g.w === g.h
    body = `<div style="position:absolute;left:0;right:0;top:${sq ? 56 : 64}px;display:flex;justify-content:center">${logo}</div>
      <div style="position:absolute;left:0;right:0;top:${sq ? 150 : 170}px;text-align:center;padding:0 ${sq ? 70 : 200}px" class="center"><h1 style="font-size:${sq ? 70 : 84}px;margin:0 0 20px">${accent(g.title)}</h1><p class="sub" style="font-size:${sq ? 26 : 29}px;max-width:1100px;margin:0 auto">${g.sub}</p></div>
      ${win(shots[0]!, sq ? 'left:90px;top:500px;width:900px;' : 'left:260px;top:520px;width:1400px;', g.pos)}
      `
  } else {
    body = `<div style="position:absolute;left:96px;top:70px">${logo}</div>
      <div style="position:absolute;left:96px;top:170px;width:1000px"><h1 style="font-size:72px;margin-top:0">${accent(g.title)}</h1></div>
      <p class="sub" style="position:absolute;right:96px;top:196px;width:620px;font-size:25px">${g.sub}</p>
      ${win(shots[0]!, 'left:96px;top:390px;width:1080px;', g.pos)}
      ${win(shots[1]!, 'left:900px;top:520px;width:920px;', 'top left')}
      <div class="url" style="left:96px;bottom:14px;display:none"></div>`
  }
  return `<!doctype html><meta charset="utf-8"><style>${css(g)}</style><body>${body}</body>`
}

const P = (n: string) => `${RAW}${n}.png`
const graphics: G[] = [
  { file: '01-hero-dashboard', w: 1920, h: 1080, theme: 'dark', layout: 'split', eyebrow: 'Billing · Stock · Accounts · GST', title: 'Your whole business, {one desktop app.}', sub: 'Invoices, counter sales, stock, purchases and accounts in one calm place, built for Indian businesses.', pills: ['GST ready', 'Works at the counter', 'Hindi · Marathi · Gujarati'], shots: [P('dashboard')] },
  { file: '02-invoicing', w: 1920, h: 1080, theme: 'light', layout: 'center', eyebrow: 'Sales', title: 'GST invoices in {seconds.}', sub: 'Pick a customer, add items, and the tax, totals and place of supply are worked out for you.', shots: [P('invoice-new')] },
  { file: '03-counter', w: 1920, h: 1080, theme: 'dark', layout: 'split', eyebrow: 'Point of sale', title: 'A billing counter that {keeps up} with the queue.', sub: 'Scan or type, split the payment, print the receipt. Sales are saved even if the internet drops.', pills: ['Barcode scanning', 'UPI · cash · card', 'Offline ready'], shots: [P('counter')] },
  { file: '04-dues-and-cheques', w: 1920, h: 1080, theme: 'light', layout: 'trio', eyebrow: 'Collections', title: 'Always know {who owes you.}', sub: 'Ageing of dues, cheques due this week, one-tap reminders. Money you are owed stops slipping away.', shots: [P('receivables'), P('cheques')] },
  { file: '05-gst', w: 1920, h: 1080, theme: 'dark', layout: 'center', eyebrow: 'Compliance', title: 'GST returns, {ready} when you are.', sub: 'GSTR-1 and GSTR-3B working, ITC register and 2B reconciliation, straight from your books.', shots: [P('gst')] },
  { file: '06-switch-from-vyapar', w: 1920, h: 1080, theme: 'light', layout: 'split', eyebrow: 'Switching', title: 'Moving from Vyapar? {Bring everything.}', sub: 'Upload your Vyapar backup. Your business, parties, items, stock and opening balances come across, after you review them.', pills: ['Nothing changes in your old program', 'Review before it is saved'], shots: [P('migrate')], pos: 'top left' },
  { file: '07-reports', w: 1920, h: 1080, theme: 'dark', layout: 'split', eyebrow: 'Accounts', title: 'Books that {balance themselves.}', sub: 'Every sale, receipt and purchase posts to proper double-entry books. Trial balance, profit and loss, balance sheet and cash flow, always up to date.', pills: ['Double entry', 'Period lock', 'Export to CSV'], shots: [P('reports')] },
  { file: '08-stock', w: 1920, h: 1080, theme: 'light', layout: 'split', eyebrow: 'Inventory', title: 'Stock you can {trust.}', sub: 'On hand by warehouse, average cost, batches and serial numbers, reorder alerts before you run out.', pills: ['Batches & serials', 'Reorder alerts', 'Multi-warehouse'], shots: [P('inventory')] },
  // social squares
  { file: 'social-01-square-hero', w: 1080, h: 1080, theme: 'dark', layout: 'center', eyebrow: 'Billing · Stock · GST', title: 'Your whole business, {one app.}', sub: 'Invoices, counter, stock and accounts in one calm place.', shots: [P('dashboard')] },
  { file: 'social-02-square-invoice', w: 1080, h: 1080, theme: 'light', layout: 'center', eyebrow: 'Sales', title: 'GST invoices in {seconds.}', sub: 'Tax and totals worked out as you type.', shots: [P('invoice-new')] },
  { file: 'social-03-square-counter', w: 1080, h: 1080, theme: 'dark', layout: 'center', eyebrow: 'Point of sale', title: 'Fast at the counter. {Safe offline.}', sub: 'Scan, split the payment, print. Sales keep saving even without internet.', shots: [P('counter')] },
  { file: 'social-04-square-switch', w: 1080, h: 1080, theme: 'light', layout: 'center', eyebrow: 'Switching', title: 'Leaving Vyapar? {Bring it all.}', sub: 'Upload your backup, review, done.', shots: [P('migrate')] },
]

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
for (const g of graphics) {
  const page = await (await browser.newContext({ viewport: { width: g.w, height: g.h }, deviceScaleFactor: 1 })).newPage()
  await page.setContent(html(g), { waitUntil: 'load' })
  await page.screenshot({ path: `${OUT}${g.file}.png` })
  await page.close(); console.log(g.file)
}
await browser.close()
