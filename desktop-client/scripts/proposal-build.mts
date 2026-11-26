// Builds the proposal PDF:  npx tsx ../proposals/build.mts   (run from desktop-client/, which has playwright)
import { chromium } from '@playwright/test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const D = '/home/user/Erp-app/proposals/'
// ---- the things to fill in --------------------------------------------------------------------------------------------
const CLIENT = process.env['CLIENT'] ?? 'Client Company Name'
const ATTN = process.env['ATTN'] ?? 'Sir / Madam'
const DATE = process.env['DATE'] ?? '26 November 2026'
const SIGNER = 'Rohan Gosavi'
const money = (v: string | undefined) => v ?? '₹ __________'
const P = { build: money(process.env['P_BUILD']), setup: money(process.env['P_SETUP']), yearly: money(process.env['P_YEARLY']) }
// -----------------------------------------------------------------------------------------------------------------------
const img = (f: string, mime: string) => `data:${mime};base64,${readFileSync(D + 'assets/' + f).toString('base64')}`
const logo = img('logo.png', 'image/png')
const hasPhoto = existsSync(D + 'assets/solar.jpg')
const photo = hasPhoto ? img('solar.jpg', 'image/jpeg') : ''
const credit = existsSync(D + 'assets/credit.txt') ? readFileSync(D + 'assets/credit.txt', 'utf8').trim() : ''

const panels = Array.from({ length: 6 * 14 }, () => '<i></i>').join('')

const css = `
@page{size:A4;margin:0}
*{box-sizing:border-box;margin:0;padding:0}
:root{--ink:#0f1a2b;--muted:#556176;--blue:#1377d3;--deep:#0b4f94;--soft:#eef5fc;--line:#dbe4ef}
body{font-family:Inter,'Segoe UI',system-ui,sans-serif;color:var(--ink);font-size:11.2pt;line-height:1.55;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:210mm;height:297mm;position:relative;overflow:hidden;page-break-after:always;background:#fff}
.page:last-child{page-break-after:auto}
.pad{padding:22mm 20mm 18mm}
.logo{height:15mm}
h1{font-size:34pt;line-height:1.1;font-weight:800;letter-spacing:-.02em}
h2{font-size:19pt;line-height:1.2;font-weight:800;letter-spacing:-.01em;margin-bottom:3.5mm}
h3{font-size:12.5pt;font-weight:700;margin-bottom:1.5mm;color:var(--deep)}
p{margin-bottom:3.2mm}
.muted{color:var(--muted)}
.blue{color:var(--blue)}
.foot{position:absolute;left:20mm;right:20mm;bottom:10mm;display:flex;justify-content:space-between;font-size:8.5pt;color:#8793a6;border-top:1px solid var(--line);padding-top:3mm}
/* cover */
.cover .top{padding:20mm 20mm 0}
.cover .mid{padding:0 20mm;margin-top:36mm}
.cover .tag{font-size:12pt;color:var(--muted);margin-bottom:6mm}
.cover h1 span{color:var(--blue)}
.cover .meta{margin-top:16mm;display:grid;grid-template-columns:1fr 1fr;gap:6mm 14mm;max-width:150mm}
.cover .meta small{display:block;font-size:8.5pt;text-transform:uppercase;letter-spacing:.1em;color:#8793a6;margin-bottom:1mm}
.cover .meta b{font-size:12pt}
.grid{position:absolute;left:0;right:0;bottom:0;height:78mm;background:linear-gradient(180deg,#fff 0%,var(--soft) 100%);overflow:hidden}
.grid div{position:absolute;left:-12mm;right:-12mm;bottom:-14mm;display:grid;grid-template-columns:repeat(14,1fr);gap:2.2mm;transform:perspective(900px) rotateX(48deg);transform-origin:bottom}
.grid i{display:block;aspect-ratio:1.5;background:linear-gradient(135deg,#1c86e3,#0b4f94);border-radius:1.2mm;box-shadow:inset 0 0 0 .5mm #ffffff40,inset 0 0 0 .5mm #ffffff00;background-image:linear-gradient(90deg,#ffffff22 1px,transparent 1px),linear-gradient(#ffffff22 1px,transparent 1px),linear-gradient(135deg,#1c86e3,#0b4f94);background-size:33% 100%,100% 33%,100% 100%}
.rule{height:1.6mm;background:var(--blue);position:absolute;left:0;right:0;bottom:78mm}
/* letter */
.hero{height:96mm;background:${hasPhoto ? `url(${photo}) 80% 92%/cover` : 'linear-gradient(135deg,#1c86e3,#0b4f94)'};position:relative}
.hero:after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,#0b4f9433,transparent 40%,#0b1a2b33)}
.hero img{position:absolute;left:20mm;top:14mm;height:13mm;background:#fff;padding:2mm 4mm;border-radius:2mm;z-index:2}
.credit{position:absolute;right:6mm;bottom:2mm;color:#fff;font-size:6.8pt;opacity:.85;z-index:2}
.letter{padding:12mm 20mm 0}
.letter p{margin-bottom:3.4mm}
.sig{margin-top:7mm}
.sig b{display:block}
/* body pages */
.head{display:flex;justify-content:space-between;align-items:center;padding:12mm 20mm 0}
.head img{height:9mm}
.head span{font-size:8.5pt;color:#8793a6}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:5mm 9mm}
.card{border:1px solid var(--line);border-radius:3mm;padding:4.2mm 5mm;background:#fff;break-inside:avoid}
.card p{font-size:10.2pt;margin:0;color:#2a3850}
.card .n{display:inline-block;width:7mm;height:7mm;border-radius:50%;background:var(--soft);color:var(--blue);font-weight:800;text-align:center;line-height:7mm;font-size:10pt;margin-bottom:2mm}
.step{display:grid;grid-template-columns:11mm 1fr;gap:4mm;padding:2.7mm 0;border-bottom:1px solid var(--line)}
.step:last-child{border-bottom:0}
.step .n{width:9mm;height:9mm;border-radius:50%;background:var(--blue);color:#fff;font-weight:800;text-align:center;line-height:9mm}
.step p{margin:0;font-size:10pt}
.step h3{margin-bottom:.5mm}
.say{background:var(--soft);border-left:1.6mm solid var(--blue);border-radius:2mm;padding:4mm 5.5mm;margin:5mm 0;font-size:10.2pt}
table{width:100%;border-collapse:collapse;font-size:10.2pt}
th{text-align:left;font-size:8.5pt;text-transform:uppercase;letter-spacing:.08em;color:#8793a6;border-bottom:1.5px solid var(--ink);padding:2mm 2mm}
td{padding:2.2mm 2mm;border-bottom:1px solid var(--line);vertical-align:top}
td.r{text-align:right;white-space:nowrap;font-weight:700}
.blank{color:#8793a6;font-weight:600}
.line3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:5mm;margin-top:3mm}
.line3 div{border-top:2px solid var(--blue);padding-top:2.5mm;font-size:10pt}
.line3 b{display:block;font-size:11pt}
.small{font-size:9.2pt;color:var(--muted)}
`

const foot = (n: number) => `<div class="foot"><span>Rapid Rabbit Labs Private Limited · Pune</span><span>Proposal for ${CLIENT} · Page ${n}</span></div>`
const head = (t: string) => `<div class="head"><img src="${logo}"><span>${t}</span></div>`

const html = `<!doctype html><meta charset="utf-8"><style>${css}</style><body>

<!-- 1 · cover -->
<section class="page cover">
  <div class="top"><img class="logo" src="${logo}"></div>
  <div class="mid">
    <div class="tag">Proposal</div>
    <h1>One system for<br>your whole <span>solar business.</span></h1>
    <p class="muted" style="font-size:13pt;margin-top:7mm;max-width:130mm">From the first enquiry to the last service visit, kept in one place and easy for your whole team to use.</p>
    <div class="meta">
      <div><small>Prepared for</small><b>${CLIENT}</b></div>
      <div><small>Prepared by</small><b>Rapid Rabbit Labs Private Limited</b></div>
      <div><small>Date</small><b>${DATE}</b></div>
      <div><small>Valid for</small><b>30 days</b></div>
    </div>
  </div>
  <div class="rule"></div>
  <div class="grid"><div>${panels}</div></div>
</section>

<!-- 2 · cover letter -->
<section class="page">
  <div class="hero"><img src="${logo}">${credit ? `<div class="credit">${credit}</div>` : ''}</div>
  <div class="letter">
    <p class="muted" style="margin-bottom:5mm">${DATE}</p>
    <p>Dear ${ATTN},</p>
    <p>Thank you for the time you gave us to understand how ${CLIENT} works. A solar business does a lot at once: talking to homeowners and companies, visiting roofs, preparing proposals, following up on subsidies, buying panels and inverters, sending crews out, and still looking after the customer years after the installation.</p>
    <p>Most of that is held together today by spreadsheets, WhatsApp groups, a separate proposal tool and a billing program that don't talk to each other. It works because your people make it work. But it also means a lot depends on memory, and simple questions take too long to answer. How many installations are waiting for a net meter? How much subsidy is still to come? Which customer's panels carry which warranty?</p>
    <p>This proposal sets out what we will build for you: one place where an enquiry becomes a proposal, a proposal becomes a project, and a finished project becomes an invoice that is paid and a service visit that is in the diary. We have kept to what a solar business needs. There is no factory floor, no shop counter and nothing you would pay for and never open.</p>
    <p>We'd like to build this with your team, not just for them. The people who survey roofs and run installations know best what will help, so we will sit with them before we start and again before every stage goes live.</p>
    <p>If anything here doesn't match how you work, tell us. It is much easier to change a page than a system.</p>
    <p class="sig">With thanks,<br><br><b>${SIGNER}</b>Rapid Rabbit Labs Private Limited, Pune</p>
  </div>
</section>

<!-- 3 · understanding -->
<section class="page">
  ${head('Proposal for ' + CLIENT)}
  <div class="pad" style="padding-top:12mm">
    <h2>How we understand your business</h2>
    <p class="muted">This is what we heard from you. If we have got any of it wrong, please mark it up and send it back.</p>
    <div style="margin-top:4mm">
      <div class="step"><div class="n">1</div><div><h3>An enquiry comes in</h3><p>From an advertisement, a reference or a channel partner. Today it sits in a phone, a notebook or a sheet, and follow-ups depend on someone remembering.</p></div></div>
      <div class="step"><div class="n">2</div><div><h3>Someone visits the site</h3><p>The roof, the shade, the electricity bill and the sanctioned load are noted down, usually on paper or in photos scattered across phones.</p></div></div>
      <div class="step"><div class="n">3</div><div><h3>A proposal is prepared</h3><p>A long, branded document that takes real time to put together, in a separate tool, with prices kept somewhere else.</p></div></div>
      <div class="step"><div class="n">4</div><div><h3>The customer says yes</h3><p>An advance is taken, and the paperwork starts: electricity company application, net meter, and the subsidy.</p></div></div>
      <div class="step"><div class="n">5</div><div><h3>Material is bought and the crew goes out</h3><p>Panels, inverters, structures and cables are ordered. Everything has to reach the right site, and the serial numbers have to be recorded for the warranty.</p></div></div>
      <div class="step"><div class="n">6</div><div><h3>The system is switched on, and billed</h3><p>Payment comes in stages. The subsidy arrives weeks later, to the customer, and you need to know when.</p></div></div>
      <div class="step"><div class="n">7</div><div><h3>Then the customer needs you again</h3><p>Cleaning, a fault, a warranty claim, a yearly maintenance contract. That is where a good name is built, and it is easy to lose track of.</p></div></div>
    </div>
    <div class="say"><b>The common thread:</b> each step is handled well by someone, but the information doesn't travel with the customer. We want a customer's whole story, from first call to last visit, to be one click away.</div>
  </div>
  ${foot(3)}
</section>

<!-- 4 · what we build (1) -->
<section class="page">
  ${head('Proposal for ' + CLIENT)}
  <div class="pad" style="padding-top:12mm">
    <h2>What we will build for you</h2>
    <p class="muted">Everything below is made around the way a solar company works. The same people, the same customers and the same prices show up wherever you look.</p>
    <div class="cols" style="margin-top:4mm">
      <div class="card"><div class="n">1</div><h3>Enquiries and site visits</h3><p>Every enquiry goes in one list with its source, who is handling it, and when to call next. A site visit form on the phone captures the roof, shade, electricity bill and photos in one go, so nothing is retyped later.</p></div>
      <div class="card"><div class="n">2</div><h3>Proposals that look the part</h3><p>Choose the system size, and the proposal is built for you: what is included, the expected savings and payback, the subsidy, the finance option, and your branding. Several versions of the same proposal can sit side by side, and it can go to the customer as a PDF or on WhatsApp.</p></div>
      <div class="card"><div class="n">3</div><h3>Quotations from ready-made kits</h3><p>Set up your 3 kW, 5 kW or 10 kW packages once, with the panels, inverter, structure and cables you usually use. A quotation then takes a minute, and your margin on each one is visible to you.</p></div>
      <div class="card"><div class="n">4</div><h3>Projects, step by step</h3><p>Once an order is confirmed it becomes a project with its own checklist: survey, design, electricity company application, material, installation, commissioning, net meter, handover. You see at a glance what is stuck, and where.</p></div>
      <div class="card"><div class="n">5</div><h3>Subsidy tracking</h3><p>For every customer: which scheme, the application number, the current status, the amount expected and the date it arrived. No more asking around about who is still waiting.</p></div>
      <div class="card"><div class="n">6</div><h3>Documents and photos in one place</h3><p>Application forms, certificates, test reports, and the installation photos the subsidy process asks for, all filed against the customer's project, ready to download when needed.</p></div>
    </div>
  </div>
  ${foot(4)}
</section>

<!-- 5 · what we build (2) -->
<section class="page">
  ${head('Proposal for ' + CLIENT)}
  <div class="pad" style="padding-top:12mm">
    <div class="cols">
      <div class="card"><div class="n">7</div><h3>Stock and purchases</h3><p>See what is in your godown and what is set aside for which customer. Panels and inverters are recorded by serial number, so a warranty question is answered in seconds. Orders to your suppliers, and what you owe them, are tracked as well.</p></div>
      <div class="card"><div class="n">8</div><h3>Billing in stages</h3><p>Advance, material delivery, commissioning: each invoice is raised at the right moment, with GST handled the way your accountant needs it. You always know who has paid, who hasn't, and how long it has been.</p></div>
      <div class="card"><div class="n">9</div><h3>Cheques, bank loans and payments</h3><p>Customer cheques are followed until they clear. For customers on a bank loan, you see what is approved, released and pending.</p></div>
      <div class="card"><div class="n">10</div><h3>Accounts and GST</h3><p>Sales, purchases and expenses flow into your books on their own. Your accountant gets clean records and the working for your GST returns, without retyping.</p></div>
      <div class="card"><div class="n">11</div><h3>After-sales and yearly service</h3><p>Yearly maintenance contracts, cleaning visits and complaints are scheduled and tracked. Warranty claims on the manufacturer are logged with the serial numbers ready.</p></div>
      <div class="card"><div class="n">12</div><h3>Money made, project by project</h3><p>What each project earned after material, labour and commission. Plus the numbers you check every week: enquiries and conversions, kilowatts sold and installed, subsidies pending, projects waiting for a net meter, and payments due.</p></div>
    </div>
    <div class="say" style="margin-top:6mm"><b>For your site team:</b> a simple phone app for the people on the roof. They fill the site visit, take photos, tick the installation checklist and get the customer's signature on handover. It also works when the signal is poor, and sends everything across later.</div>
    <p class="muted" style="margin-top:5mm;font-size:10pt"><b style="color:var(--ink)">What you won't see:</b> factory production, counter sales and other things that belong to other kinds of businesses. We don't switch them on. <b style="color:var(--ink)">What you will see on day one:</b> your own customers, items and open balances, brought across from your present billing program or sheets.</p>
  </div>
  ${foot(5)}
</section>

<!-- 6 · how, cost, next -->
<section class="page">
  ${head('Proposal for ' + CLIENT)}
  <div class="pad" style="padding-top:12mm">
    <h2>How we'll do it</h2>
    <table>
      <tr><th style="width:30mm">Stage</th><th>What happens</th><th style="width:28mm">Proposed time</th></tr>
      <tr><td><b>1 · Listen</b></td><td>We spend time with your sales, accounts and site teams, and look at your current proposals, price lists and checklists.</td><td>1–2 weeks</td></tr>
      <tr><td><b>2 · Enquiries to billing</b></td><td>Enquiries, site visits, quotations, projects, stock and billing, with your data loaded. Your team uses it on real work.</td><td>6–8 weeks</td></tr>
      <tr><td><b>3 · Proposals and subsidy</b></td><td>The proposal maker in your branding, subsidy tracking, documents and the phone app for the site team.</td><td>4–6 weeks</td></tr>
      <tr><td><b>4 · Service and reports</b></td><td>After-sales, yearly maintenance contracts and the reports you check every week.</td><td>3–4 weeks</td></tr>
    </table>
    <p class="small" style="margin-top:2mm">Times are estimates, to be confirmed after stage 1. You see working versions every couple of weeks, not only at the end.</p>

    <h2 style="margin-top:6mm">Cost</h2>
    <table>
      <tr><th>Item</th><th style="width:44mm;text-align:right">Amount (excl. GST)</th></tr>
      <tr><td><b>Build and set-up</b><br><span class="small">Everything in this proposal, your data moved across, tested with your team.</span></td><td class="r ${process.env['P_BUILD'] ? '' : 'blank'}">${P.build}</td></tr>
      <tr><td><b>Training and going live</b><br><span class="small">Hands-on sessions for each team, and our people with you during the first weeks.</span></td><td class="r ${process.env['P_SETUP'] ? '' : 'blank'}">${P.setup}</td></tr>
      <tr><td><b>Yearly support and hosting</b><br><span class="small">Starts after go-live. Fixes, help when you need it, backups, and small changes.</span></td><td class="r ${process.env['P_YEARLY'] ? '' : 'blank'}">${P.yearly}</td></tr>
    </table>
    <p class="small" style="margin-top:2mm">Payment: 40% to start, 40% when the first stage is in your hands, 20% when you go live. GST as applicable. Anything you ask for beyond this is quoted separately, and nothing is added without your yes.</p>

    <div class="say" style="margin-top:4mm"><b>Next steps.</b> Tell us what to change. Once you're happy, we sign, we set a start date, and we begin with an hour with each of your teams.</div>
    <div class="line3">
      <div><b>${SIGNER}</b>Rapid Rabbit Labs Private Limited</div>
      <div><b>Accepted by</b>Name &amp; signature</div>
      <div><b>For ${CLIENT}</b>Date</div>
    </div>
  </div>
  ${foot(6)}
</section>
</body>`

writeFileSync(D + 'proposal.html', html)
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage()
await page.setContent(html, { waitUntil: 'load' })
await page.pdf({ path: D + 'Rapid-Rabbit-Labs-Solar-Proposal.pdf', format: 'A4', printBackground: true, preferCSSPageSize: true })
for (let i = 0; i < 6; i++) { /* page previews below */ }
await browser.close()
console.log('done')
