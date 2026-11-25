import { ApiError } from '@/api/errors'
import { isValidGstin, panOfGstin, STATES } from '@/domain/india'
import { codeFromName } from '@/features/import/mapping'
import { resolveTax, resolveUnit } from '@/features/import/resolvers'
import type { VyData, VyItem, VyParty } from './vyapar'

/** What the engine needs from the server: plain JSON in and out, so it can run against the real API or a fake one in tests. */
export interface Server {
  get(path: string, query?: Record<string, string | number>): Promise<unknown>
  post(path: string, body: unknown, key: string): Promise<unknown>
}
export interface Choices { business: boolean; catalogue: boolean; parties: boolean; banks: boolean; stock: boolean; /** A party with no state in the file is taken to be in the business's own state (this decides CGST+SGST or IGST on its invoices). */ assumeBusinessState?: boolean; /** Bring in what customers owe and what is owed to suppliers, as opening balances on this date. */ openingBalances?: boolean; asOf?: string; /** A GSTIN to use when the one in the file does not pass the check. */ gstin?: string }
export interface PhaseResult { phase: string; created: number; skipped: number; failed: number; notes: string[] }
export interface Problem { phase: string; record: string; message: string }
export interface Report { phases: PhaseResult[]; problems: Problem[]; companyId: string | null }
export type Progress = (phase: string, done: number, total: number) => void

type J = Record<string, unknown>
const asRows = (v: unknown): J[] => ((v as { items?: J[] } | null)?.items ?? [])
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const today = (): string => new Date().toISOString().slice(0, 10)
const fyStart = (date: string): string => { const y = Number(date.slice(0, 4)); const m = Number(date.slice(5, 7)); return `${m >= 4 ? y : y - 1}-04-01` }
const money = (n: number): string => (Math.round(n * 10_000) / 10_000).toFixed(4).replace(/\.?0+$/, '') || '0'
const messageOf = (e: unknown): string => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e))
/** A record that already exists (same code) is not an error in a migration that may be run twice. */
const isDuplicate = (e: unknown): boolean => e instanceof ApiError && (e.status === 409 || /already (exists|used|taken)|duplicate|in use/i.test(e.message))

async function all(server: Server, path: string, query: Record<string, string | number> = {}): Promise<J[]> {
  const out: J[] = []; let cursor: string | undefined
  do {
    const page = (await server.get(path, { limit: 200, ...query, ...(cursor ? { cursor } : {}) })) as { items?: J[]; nextCursor?: string | null }
    out.push(...(page.items ?? [])); cursor = page.nextCursor ?? undefined
  } while (cursor)
  return out
}

/** Runs `work` over `list` a few at a time and reports progress. */
async function pool<T>(list: T[], width: number, phase: string, progress: Progress, work: (x: T) => Promise<void>): Promise<void> {
  let next = 0; let done = 0
  progress(phase, 0, list.length)
  await Promise.all(Array.from({ length: Math.min(width, list.length) }, async () => {
    for (;;) { const i = next++; if (i >= list.length) return; await work(list[i] as T); progress(phase, ++done, list.length) }
  }))
}

/** The GST rate Vyapar's tax entry stands for: a group "GST@18%" is 18, a component "SGST@9%" is half of it. */
export function rateOfTax(name: string, rate: number): number | null {
  if (/^exempt/i.test(name)) return 0
  if (/^(sgst|cgst|utgst)/i.test(name)) return rate * 2
  return rate
}

export async function migrateVyapar(server: Server, data: VyData, choices: Choices, batch: string, progress: Progress, shouldStop: () => boolean = () => false): Promise<Report> {
  const phases: PhaseResult[] = []; const problems: Problem[] = []
  const begin = (phase: string): PhaseResult => { const p: PhaseResult = { phase, created: 0, skipped: 0, failed: 0, notes: [] }; phases.push(p); return p }
  const fail = (p: PhaseResult, record: string, e: unknown): void => { p.failed++; problems.push({ phase: p.phase, record, message: messageOf(e) }) }
  const key = (kind: string, id: string | number): string => `vyapar-${batch}-${kind}-${id}`
  let companyId: string | null = null

  // ---- the business ------------------------------------------------------------------------------------------------------------------
  const biz = begin('Business')
  let warehouseId: string | null = null
  if (choices.business && data.firm) {
    const f = data.firm
    try {
      const companies = await all(server, '/v1/companies')
      let company = companies[0]
      const gstin = (choices.gstin ?? '').trim().toUpperCase() && isValidGstin((choices.gstin ?? '').trim().toUpperCase()) ? (choices.gstin ?? '').trim().toUpperCase() : f.gstin
      const gstinOk = isValidGstin(gstin)
      if (!company) {
        company = (await server.post('/v1/companies', { legalName: f.name.slice(0, 200) || 'My business', ...(gstinOk ? { pan: panOfGstin(gstin) } : {}) }, key('company', 1))) as J
        biz.created++; biz.notes.push(`Business "${f.name}" created.`)
      } else { biz.skipped++; biz.notes.push(`Your business "${str(company['legalName'])}" already exists, so it was kept as it is.`) }
      companyId = str(company['id'])
      const regs = (await server.get(`/v1/companies/${companyId}/gst-registrations`, { limit: 50 })) as { items?: J[] }
      let regId = str(regs.items?.[0]?.['id'])
      const startDate = data.firstDate ? fyStart(data.firstDate) : fyStart(today())
      if (!regId && gstinOk) {
        regId = str(((await server.post(`/v1/companies/${companyId}/gst-registrations`, { gstin, legalName: f.name.slice(0, 200), effectiveFrom: startDate }, key('gst', 1))) as J)['id'])
        biz.created++; biz.notes.push(`GST registration ${gstin} added.`)
      } else if (!regId) biz.notes.push(f.gstin ? 'The GSTIN in the file does not pass the check, so no GST registration was added. Add it under Settings, Companies.' : 'The file has no GSTIN, so no GST registration was added.')
      const locs = asRows(await server.get('/v1/business-locations', { companyId, limit: 50 }))
      let locId = str(locs[0]?.['id'])
      const stateCode = gstinOk ? gstin.slice(0, 2) : STATES.find((s) => s.name.toLowerCase() === f.state.toLowerCase())?.code ?? ''
      if (!locId && stateCode && /^[1-9][0-9]{5}$/.test(f.pincode)) {
        const parts = f.address.split(',').map((x) => x.trim()).filter(Boolean)
        locId = str(((await server.post('/v1/business-locations', { companyId, ...(regId ? { gstRegistrationId: regId } : {}), code: 'MAIN', name: 'Main', ...(regId ? { isPrincipalPlace: true } : {}), addressLine1: (f.address || 'Address').slice(0, 200), city: (parts.length > 1 ? parts[parts.length - 1] : 'NA') as string, stateCode, pincode: f.pincode }, key('loc', 1))) as J)['id'])
        biz.created++; biz.notes.push('Main location added from the business address.')
      } else if (!locId) biz.notes.push('No location was added (a valid PIN code and state are needed). Add one under Settings, Companies.')
      if (locId) {
        const whs = asRows(await server.get('/v1/warehouses', { businessLocationId: locId, limit: 50 }))
        warehouseId = str(whs[0]?.['id'])
        if (!warehouseId) { warehouseId = str(((await server.post('/v1/warehouses', { businessLocationId: locId, code: 'MAIN', name: 'Main', kind: 'finished_goods' }, key('wh', 1))) as J)['id']); biz.created++ }
      }
      const years = asRows(await server.get('/v1/fiscal-years', { companyId, limit: 50 }))
      const needed = fyStart(today())
      if (!years.some((y) => str(y['startDate']) <= today() && str(y['endDate']) >= today())) { await server.post('/v1/fiscal-years', { companyId, startDate: needed }, key('fy', needed)); biz.created++; biz.notes.push(`Financial year starting ${needed} added.`) }
      await server.post(`/v1/companies/${companyId}/setup/apply-defaults`, {}, key('defaults', 1))
      biz.notes.push('Standard chart of accounts, tax set-up and number series applied where missing.')
    } catch (e) { fail(biz, 'Business set-up', e) }
  } else {
    const companies = await all(server, '/v1/companies').catch(() => [] as J[]); companyId = str(companies[0]?.['id']) || null
  }
  if (companyId && !warehouseId) {
    const locs = asRows(await server.get('/v1/business-locations', { companyId, limit: 50 }).catch(() => ({})))
    if (locs[0]) warehouseId = str(asRows(await server.get('/v1/warehouses', { businessLocationId: str(locs[0]['id']), limit: 50 }).catch(() => ({})))[0]?.['id']) || null
  }
  if (shouldStop()) return { phases, problems, companyId }

  // ---- units, tax codes, categories, payment terms ------------------------------------------------------------------------------------
  const unitId = new Map<number, string>(); const taxId = new Map<number, string>(); const catId = new Map<number, string>(); const termId = new Map<number, string>()
  const itemUnits = new Set(data.items.map((i) => i.unitId).filter((x): x is number => x !== null))
  if (choices.catalogue) {
    const up = begin('Units')
    try {
      const ours = await all(server, '/v1/units')
      for (const vu of data.units.filter((u) => itemUnits.has(u.id))) {
        const hit = resolveUnit(ours.map((u) => ({ code: str(u['code']), name: str(u['name']) })), vu.shortName) ?? resolveUnit(ours.map((u) => ({ code: str(u['code']), name: str(u['name']) })), vu.name)
        const found = ours.find((u) => str(u['code']) === hit)
        if (found) { unitId.set(vu.id, str(found['id'])); up.skipped++; continue }
        const code = (vu.shortName || vu.name).toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 10) || `U${vu.id}`
        try { const made = (await server.post('/v1/units', { code, name: vu.name.slice(0, 50), uqc: 'OTH', decimalPlaces: 3 }, key('unit', vu.id))) as J; unitId.set(vu.id, str(made['id'])); ours.push(made); up.created++ } catch (e) { if (isDuplicate(e)) up.skipped++; else fail(up, vu.name, e) }
      }
    } catch (e) { fail(up, 'Units', e) }

    const tp = begin('Tax codes')
    try {
      const ours = await all(server, '/v1/tax-codes')
      const named = ours.map((t) => ({ code: str(t['code']), name: str(t['name']) }))
      const wanted = new Map<number, number>()
      for (const it of data.items) if (it.taxId) { const vt = data.taxes.find((t) => t.id === it.taxId); const r = vt ? rateOfTax(vt.name, vt.rate) : null; if (r !== null) wanted.set(it.taxId, r) }
      for (const [vid, rate] of wanted) {
        const hit = resolveTax(named, rate === 0 ? 'exempt' : `GST${rate}`)
        const found = ours.find((t) => str(t['code']) === hit)
        if (found) { taxId.set(vid, str(found['id'])); tp.skipped++; continue }
        if (rate === 0) { tp.notes.push('No exempt tax code exists to match "Exempted"; those items have no tax code.'); continue }
        try {
          const made = (await server.post('/v1/tax-codes', { code: `GST${String(rate).replace('.', '_')}`, name: `GST ${rate}%`, kind: 'gst' }, key('tax', vid))) as J
          await server.post(`/v1/tax-codes/${str(made['id'])}/rates`, { effectiveFrom: '2017-07-01', igstRate: rate }, key('taxrate', vid))
          taxId.set(vid, str(made['id'])); ours.push(made); tp.created++
        } catch (e) { fail(tp, `GST ${rate}%`, e) }
      }
    } catch (e) { fail(tp, 'Tax codes', e) }

    const cp = begin('Categories')
    try {
      const ours = await all(server, '/v1/item-categories'); const used = new Set(ours.map((c) => str(c['code']).toLowerCase()))
      const byName = new Map(ours.map((c) => [str(c['name']).toLowerCase(), str(c['id'])]))
      for (const c of data.categories) {
        const hit = byName.get(c.name.toLowerCase()); if (hit) { catId.set(c.id, hit); cp.skipped++; continue }
        try { const made = (await server.post('/v1/item-categories', { code: codeFromName(c.name, used).slice(0, 30), name: c.name.slice(0, 100) }, key('cat', c.id))) as J; catId.set(c.id, str(made['id'])); cp.created++ } catch (e) { fail(cp, c.name, e) }
      }
    } catch (e) { fail(cp, 'Categories', e) }

    const tm = begin('Payment terms')
    try {
      const ours = await all(server, '/v1/payment-terms'); const used = new Set(ours.map((t) => str(t['code']).toLowerCase()))
      const byName = new Map(ours.map((t) => [str(t['name']).toLowerCase(), str(t['id'])]))
      for (const t of data.terms) {
        const hit = byName.get(t.name.toLowerCase()); if (hit) { termId.set(t.id, hit); tm.skipped++; continue }
        try { const made = (await server.post('/v1/payment-terms', { code: codeFromName(t.name, used).slice(0, 20), name: t.name.slice(0, 100), netDays: t.days }, key('term', t.id))) as J; termId.set(t.id, str(made['id'])); tm.created++ } catch (e) { fail(tm, t.name, e) }
      }
    } catch (e) { fail(tm, 'Payment terms', e) }
  }
  if (shouldStop()) return { phases, problems, companyId }

  // ---- customers and suppliers --------------------------------------------------------------------------------------------------------
  if (choices.parties) {
    const pp = begin('Customers and suppliers')
    const noAddress: string[] = []
    const partyIds = new Map<number, string>()
    const ownState = data.firm ? (isValidGstin(choices.gstin?.trim().toUpperCase() ?? '') ? (choices.gstin as string).trim().toUpperCase().slice(0, 2) : isValidGstin(data.firm.gstin) ? data.firm.gstin.slice(0, 2) : STATES.find((s) => s.name.toLowerCase() === data.firm?.state.toLowerCase())?.code ?? '') : ''
    let assumed = 0
    const make = async (p: VyParty): Promise<void> => {
      try {
        const body = {
          code: p.code, legalName: p.name.slice(0, 300), isCustomer: p.isCustomer, isSupplier: p.isSupplier, gstTreatment: p.gstin ? 'registered_regular' : p.isCustomer ? 'consumer' : 'unregistered',
          ...(p.gstin ? { gstin: p.gstin } : {}), ...(p.phone && /^[0-9+() -]{6,20}$/.test(p.phone) ? { phone: p.phone } : {}), ...(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email) ? { email: p.email } : {}),
          ...(p.creditLimit > 0 && p.isCustomer ? { creditLimit: money(p.creditLimit) } : {}),
        }
        const made = (await server.post('/v1/parties', body, key('party', p.id))) as J
        partyIds.set(p.id, str(made['id']))
        pp.created++
        const state = p.stateCode || (choices.assumeBusinessState ? ownState : '')
        if (p.address && state) {
          if (!p.stateCode) assumed++
          const parts = p.address.split(',').map((x) => x.trim()).filter(Boolean)
          try { await server.post(`/v1/parties/${str(made['id'])}/addresses`, { kind: 'billing', line1: p.address.slice(0, 200), city: (parts.length > 1 ? (parts[parts.length - 1] as string) : p.address).slice(0, 100), stateCode: state, ...(p.pincode ? { pincode: p.pincode } : {}), country: 'IN', isDefault: true }, key('addr', p.id)) } catch (e) { noAddress.push(p.name); problems.push({ phase: pp.phase, record: `${p.name} (address)`, message: `${messageOf(e)}: ${p.address}` }) }
        } else if (p.address) { noAddress.push(p.name); problems.push({ phase: pp.phase, record: p.name, message: `Address not saved (its state is not known): ${p.address}` }) }
      } catch (e) {
        if (isDuplicate(e)) {
          pp.skipped++
          const hit = asRows(await server.get('/v1/parties', { q: p.code, limit: 5 }).catch(() => ({}))).find((r) => str(r['code']).toLowerCase() === p.code.toLowerCase())
          if (hit) partyIds.set(p.id, str(hit['id']))
        } else fail(pp, p.name, e)
      }
    }
    await pool(data.parties, 6, pp.phase, progress, make)
    if (noAddress.length) pp.notes.push(`${noAddress.length} ${noAddress.length === 1 ? 'party has' : 'parties have'} an address that was not saved because its state is not known (the address text is in the problems file).`)
    if (assumed) pp.notes.push(`${assumed} ${assumed === 1 ? 'party had' : 'parties had'} no state in the file and ${assumed === 1 ? 'was' : 'were'} taken to be in your own state. Check the ones in other states, because it decides CGST and SGST or IGST on their invoices.`)
    if (choices.openingBalances && companyId) {
      const ob = begin('Opening balances')
      const asOf = choices.asOf && /^\d{4}-\d{2}-\d{2}$/.test(choices.asOf) ? choices.asOf : today()
      const owed = data.parties.filter((p) => p.balance > 0 && p.isCustomer && partyIds.has(p.id))
      const owing = data.parties.filter((p) => p.balance < 0 && p.isSupplier && partyIds.has(p.id))
      const send = async (path: string, list: VyParty[]): Promise<void> => {
        const chunks: VyParty[][] = []; for (let i = 0; i < list.length; i += 50) chunks.push(list.slice(i, i + 50))
        await pool(chunks, 1, ob.phase, progress, async (chunk) => {
          try {
            const r = (await server.post(path, { companyId, asOf, items: chunk.map((p) => ({ partyId: partyIds.get(p.id), amount: money(Math.abs(p.balance)) })) }, key(`ob-${path.includes('payables') ? 'pay' : 'recv'}`, chunk[0]?.id ?? 0))) as { items?: { status: string }[] }
            for (const x of r.items ?? []) { if (x.status === 'created') ob.created++; else ob.skipped++ }
          } catch (e) { const m = messageOf(e); if (/GST registration/i.test(m)) { if (!ob.notes.some((t) => /registration/.test(t))) ob.notes.push('Opening balances were not added because the business has no GST registration yet. Add one under Settings, Companies and run the move again.') } else for (const p of chunk) fail(ob, p.name, e) }
        })
      }
      await send('/v1/receivables/opening-balances', owed); await send('/v1/payables/opening-balances', owing)
      if (owed.length + owing.length > 0 && ob.created > 0) ob.notes.push(`${owed.length} customers owing ₹${owed.reduce((t, p) => t + p.balance, 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })} and ${owing.length} suppliers owed ₹${owing.reduce((t, p) => t - p.balance, 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })} were brought forward as of ${asOf}.`)
      const stray = data.parties.filter((p) => p.balance !== 0 && !partyIds.has(p.id)).length
      if (stray) ob.notes.push(`${stray} parties with a balance could not be matched to a saved party, so their balance was not brought forward.`)
    }
    const inactive = data.parties.filter((p) => !p.active).length
    if (inactive) pp.notes.push(`${inactive} inactive ${inactive === 1 ? 'party was' : 'parties were'} brought in as active.`)
  }
  if (shouldStop()) return { phases, problems, companyId }

  // ---- items, prices and opening stock --------------------------------------------------------------------------------------------------
  const created = new Map<number, string>()
  if (choices.catalogue) {
    const ip = begin('Items')
    const nos = unitId.get(data.units.find((u) => /^nos$/i.test(u.shortName))?.id ?? -1) ?? str((await all(server, '/v1/units')).find((u) => str(u['code']) === 'NOS')?.['id'])
    const makeItem = async (it: VyItem): Promise<void> => {
      const base = {
        code: it.code, name: it.name.slice(0, 300), itemType: it.service ? 'service' : 'trading_good', baseUomId: (it.unitId !== null ? unitId.get(it.unitId) : undefined) ?? nos,
        isStocked: !it.service, isSellable: true, isPurchasable: true,
        ...(it.taxId && taxId.get(it.taxId) ? { taxCodeId: taxId.get(it.taxId) } : {}), ...(it.categoryId && catId.get(it.categoryId) ? { categoryId: catId.get(it.categoryId) } : {}),
        ...(it.mrp > 0 ? { mrp: money(it.mrp) } : {}), ...(it.description ? { description: it.description.slice(0, 500) } : {}),
      }
      try {
        let made: J
        try { made = (await server.post('/v1/items', { ...base, ...(it.hsn ? { hsnSacCode: it.hsn } : {}) }, key('item', it.id))) as J }
        catch (e) { if (it.hsn && e instanceof ApiError && e.status === 422) { made = (await server.post('/v1/items', base, key('item2', it.id))) as J; problems.push({ phase: ip.phase, record: it.name, message: `HSN/SAC ${it.hsn} was not accepted, so the item was saved without it` }) } else throw e }
        created.set(it.id, str(made['id'])); ip.created++
      } catch (e) { if (isDuplicate(e)) ip.skipped++; else fail(ip, it.name, e) }
    }
    await pool(data.items, 8, ip.phase, progress, makeItem)
    if (ip.skipped) ip.notes.push(`${ip.skipped} items already existed (same code) and were left as they are. Their prices and stock were not touched.`)

    const pr = begin('Prices')
    try {
      const lists = await all(server, '/v1/price-lists')
      const ensure = async (code: string, name: string, kind: 'sales' | 'purchase', inc: boolean): Promise<string | null> => {
        const hit = lists.find((l) => str(l['code']) === code); if (hit) return str(hit['id'])
        try { const made = (await server.post('/v1/price-lists', { code, name, kind, taxInclusive: inc }, key('pl', code))) as J; lists.push(made); return str(made['id']) } catch (e) { fail(pr, name, e); return null }
      }
      const from = fyStart(today())
      const jobs: { list: string; it: VyItem; price: number }[] = []
      const sell = await ensure('VYAPAR-SALE', 'Vyapar sale prices', 'sales', false); const sellInc = await ensure('VYAPAR-SALE-INC', 'Vyapar sale prices (tax included)', 'sales', true); const buy = await ensure('VYAPAR-BUY', 'Vyapar purchase prices', 'purchase', false)
      for (const it of data.items) {
        if (!created.has(it.id)) continue
        const target = it.priceWithTax ? sellInc : sell
        if (target && it.salePrice > 0) jobs.push({ list: target, it, price: it.salePrice })
        if (buy && it.purchasePrice > 0 && !it.service) jobs.push({ list: buy, it, price: it.purchasePrice })
      }
      await pool(jobs, 8, pr.phase, progress, async (j) => {
        try { await server.post(`/v1/price-lists/${j.list}/prices`, { itemId: created.get(j.it.id), uomId: (j.it.unitId !== null ? unitId.get(j.it.unitId) : undefined) ?? nos, price: money(j.price), effectiveFrom: from }, key('price', `${j.list}-${j.it.id}`)); pr.created++ } catch (e) { fail(pr, j.it.name, e) }
      })
    } catch (e) { fail(pr, 'Price lists', e) }

    if (choices.stock) {
      const sp = begin('Opening stock')
      const stocked = data.items.filter((i) => !i.service && i.stock > 0 && created.has(i.id))
      const negative = data.items.filter((i) => !i.service && i.stock < 0).length
      if (negative) sp.notes.push(`${negative} items have a negative stock in the file. They were brought in with no stock (a negative opening stock is not allowed).`)
      if (!companyId || !warehouseId) { if (stocked.length) sp.notes.push('Opening stock was not added because the business has no warehouse yet. Finish Settings, Companies and import again.') }
      else {
        const chunks: VyItem[][] = []; for (let i = 0; i < stocked.length; i += 100) chunks.push(stocked.slice(i, i + 100))
        await pool(chunks, 1, sp.phase, progress, async (chunk) => {
          try {
            await server.post('/v1/stock/movements', { companyId, movementType: 'opening', postingDate: today(), description: 'Opening stock migrated from Vyapar', lines: chunk.map((it) => ({ warehouseId, itemId: created.get(it.id), quantity: money(it.stock), unitCost: money(it.stockValue > 0 ? it.stockValue / it.stock : it.purchasePrice > 0 ? it.purchasePrice : 0) })) }, key('stock', chunk[0]?.id ?? 0))
            sp.created += chunk.length
          } catch (e) { for (const it of chunk) fail(sp, it.name, e) }
        })
        if (stocked.some((i) => i.stockValue <= 0 && i.purchasePrice <= 0)) sp.notes.push('Some items have stock but no cost in the file, so their opening stock is valued at nil until you adjust it.')
      }
    }
  }

  // ---- bank accounts ------------------------------------------------------------------------------------------------------------------
  if (choices.banks && data.banks.length && companyId) {
    const bp = begin('Bank accounts')
    try {
      const accounts = await all(server, '/v1/accounts', { companyId }); const existing = await all(server, '/v1/bank-accounts', { companyId })
      const parent = accounts.find((a) => str(a['code']) === '1100')
      const used = new Set(accounts.map((a) => str(a['code'])))
      let n = 1121
      for (const b of data.banks) {
        if (existing.some((e) => str(e['name']).toLowerCase() === b.name.toLowerCase())) { bp.skipped++; continue }
        try {
          while (used.has(String(n))) n++
          const code = String(n); used.add(code)
          const acc = (await server.post('/v1/accounts', { companyId, code, name: `Bank: ${b.name}`.slice(0, 100), type: 'asset', ...(parent ? { parentId: str(parent['id']) } : {}) }, key('bankacc', b.id))) as J
          await server.post('/v1/bank-accounts', { companyId, accountId: str(acc['id']), name: b.name.slice(0, 100), ...(b.bankName ? { bankName: b.bankName.slice(0, 100) } : {}), ...(b.accountNumber ? { accountRef: b.accountNumber.slice(0, 50) } : {}) }, key('bank', b.id))
          bp.created++
        } catch (e) { fail(bp, b.name, e) }
      }
      if (data.banks.some((b) => b.opening !== 0)) bp.notes.push('Bank opening balances were not posted. Record them with a journal entry dated the day you start.')
    } catch (e) { fail(bp, 'Bank accounts', e) }
  }

  return { phases, problems, companyId }
}
