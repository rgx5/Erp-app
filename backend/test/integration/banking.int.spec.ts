import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, startServer, superPool, type TestServer } from '../support/harness.js';
import { buyerKit, type Buyer } from '../support/buyer.js';
import { ok } from '../support/shop.js';

let server: TestServer;
const supers = superPool();
let k: ReturnType<typeof buyerKit>;
const PW = 'another long passphrase 42';
let n = 0;
beforeAll(async () => { server = await startServer(); k = buyerKit(server, supers); });
afterAll(async () => { await server.close(); await supers.end(); });

interface World extends Buyer { bank: string; slug: string }

async function user(b: Buyer, slug: string, permissions: string[]): Promise<string> {
  const r = ok(await call(server, 'POST', '/v1/roles', { tenant: b.tenant, body: { name: `role-${++n}`, permissions } }));
  const email = `u${++n}@${slug}.example.com`;
  ok(await call(server, 'POST', '/v1/users', { tenant: b.tenant, body: { email, displayName: 'u', password: PW, roleIds: [r.id] } }));
  const login = await call(server, 'POST', '/v1/auth/login', { body: { tenant: slug, email, password: PW } });
  return (login.json as { accessToken: string }).accessToken;
}
async function world(name: string, bankOpts: object = {}): Promise<World> {
  const b = await k.buyer(name);
  const bank = ok(await call(server, 'POST', '/v1/bank-accounts', { tenant: b.tenant, body: { companyId: b.companyId, accountId: b.acc['1120'], name: 'Main current account', bankName: 'Test Bank', accountRef: '1234', ...bankOpts } }));
  const slug = (await supers.query('SELECT slug FROM erp.tenants WHERE id = $1', [b.tenant])).rows[0].slug as string;
  return { ...b, bank: bank.id as string, slug };
}
/** A manual journal against the bank account: money in (debit bank) or out (credit bank). Returns the bank line id. */
async function ledger(w: World, direction: 'in' | 'out', amount: string, date: string, description = 'Entry'): Promise<string> {
  const bankSide = direction === 'in' ? { debit: amount } : { credit: amount };
  const other = direction === 'in' ? { credit: amount } : { debit: amount };
  const e = ok(await call(server, 'POST', '/v1/journal-entries', { tenant: w.tenant, body: { companyId: w.companyId, postingDate: date, description, lines: [{ accountId: w.acc['1120'], ...bankSide }, { accountId: w.acc['5900'], ...other }] } }));
  return (e.lines as { id: string; accountId: string }[]).find((l) => l.accountId === w.acc['1120'])!.id;
}
const importStmt = (w: World, body: object, token?: string) => call(server, 'POST', `/v1/bank-accounts/${w.bank}/statements`, token ? { token, body } : { tenant: w.tenant, body });
const april = (lines: { date: string; description: string; amount: string; reference?: string }[], o: object = {}) => ({ periodFrom: '2025-04-01', periodTo: '2025-04-30', openingBalance: '0', closingBalance: lines.reduce((a, l) => a + Number(l.amount), 0).toFixed(2), lines, ...o });
const recon = async (w: World, asOf = '2025-04-30') => (await call(server, 'GET', `/v1/bank-accounts/${w.bank}/reconciliation?asOf=${asOf}`, { tenant: w.tenant })).json;
const lineIds = async (w: World, status?: string) => (await call(server, 'GET', `/v1/bank-accounts/${w.bank}/statement-lines?limit=100${status ? `&status=${status}` : ''}`, { tenant: w.tenant })).json.items as { id: string; amount: string; status: string; description: string }[];
const match = (w: World, lineId: string, journalLineIds: string[]) => call(server, 'POST', `/v1/bank-statement-lines/${lineId}/match`, { tenant: w.tenant, body: { journalLineIds } });

describe('bank accounts', () => {
  it('only an ordinary asset account can be a bank account, once', async () => {
    const b = await k.buyer('Bank Acct Co');
    const create = (accountId: string) => call(server, 'POST', '/v1/bank-accounts', { tenant: b.tenant, body: { companyId: b.companyId, accountId, name: 'Acct' } });
    expect((await create(b.acc['2110'] as string)).status).toBe(422); // payables control
    expect((await create(b.acc['5900'] as string)).status).toBe(422); // an expense
    const made = ok(await create(b.acc['1120'] as string));
    expect(made).toMatchObject({ name: 'Acct', status: 'active', version: 1, clearedThrough: null });
    expect((await create(b.acc['1120'] as string)).json).toMatchObject({ code: 'already_a_bank_account' });
    const upd = await call(server, 'PATCH', `/v1/bank-accounts/${made.id}`, { tenant: b.tenant, headers: { 'if-match': '1' }, body: { clearedThrough: '2025-03-31', bankName: 'HDFC' } });
    expect(upd.json).toMatchObject({ clearedThrough: '2025-03-31', bankName: 'HDFC', version: 2 });
    expect((await call(server, 'GET', `/v1/bank-accounts?companyId=${b.companyId}`, { tenant: b.tenant })).json.items).toHaveLength(1);
    await expect(supers.query('DELETE FROM erp.bank_accounts')).rejects.toThrow(/never deleted/);
    await expect(supers.query("UPDATE erp.bank_accounts SET account_id = company_id WHERE id = $1", [made.id])).rejects.toThrow(/only changes/);
  });
});

describe('importing statements', () => {
  it('checks the arithmetic, refuses duplicates and overlaps, reports gaps, and can be voided', async () => {
    const w = await world('Import Co');
    const lines = [{ date: '2025-04-03', description: 'Deposit', amount: '5000' }, { date: '2025-04-07', description: 'Cheque 101', amount: '-1200.50' }];
    expect((await importStmt(w, april(lines, { closingBalance: '3800' }))).status).toBe(422); // does not add up
    expect((await importStmt(w, april([{ date: '2025-05-02', description: 'Late', amount: '5' }], { closingBalance: '5' }))).status).toBe(422); // outside the period
    const s1 = ok(await importStmt(w, april(lines)));
    expect(s1).toMatchObject({ statementNo: 'BST-000001', openingBalance: '0.0000', closingBalance: '3799.5000', lineCount: 2, continuity: null, lines: [expect.objectContaining({ lineNo: 1, amount: '5000.0000', status: 'unmatched' }), expect.objectContaining({ lineNo: 2, amount: '-1200.5000' })] });
    expect((await importStmt(w, april(lines))).json).toMatchObject({ code: 'statement_already_imported', statementId: s1.id });
    expect((await importStmt(w, april([{ date: '2025-04-10', description: 'x', amount: '10' }]))).json).toMatchObject({ code: 'statement_overlaps' });
    // the next month, opening 100 away from the previous closing
    const s2 = ok(await importStmt(w, { periodFrom: '2025-05-01', periodTo: '2025-05-31', openingBalance: '3899.5', closingBalance: '3999.5', lines: [{ date: '2025-05-05', description: 'Interest', amount: '100' }] }));
    expect(s2.continuity).toEqual({ previousStatementNo: 'BST-000001', previousClosing: '3799.5000', gap: '100.0000' });
    const full = (await call(server, 'GET', `/v1/bank-statements/${s1.id}`, { tenant: w.tenant })).json;
    expect(full).toMatchObject({ unmatched: 2, matched: 0, ignored: 0 });
    // voiding frees the period for a corrected import
    expect(ok(await call(server, 'POST', `/v1/bank-statements/${s1.id}/void`, { tenant: w.tenant, body: { reason: 'Wrong file' } }), 200)).toMatchObject({ status: 'voided' });
    expect((await call(server, 'POST', `/v1/bank-statements/${s1.id}/void`, { tenant: w.tenant, body: { reason: 'again' } })).json).toMatchObject({ code: 'already_voided' });
    ok(await importStmt(w, april(lines.slice(0, 1))));
    expect((await call(server, 'GET', `/v1/bank-accounts/${w.bank}/statements`, { tenant: w.tenant })).json.items).toHaveLength(3);
    await expect(supers.query("UPDATE erp.bank_statements SET closing_balance = 1 WHERE id = $1", [s2.id])).rejects.toThrow(/immutable/);
    await expect(supers.query("UPDATE erp.bank_statement_lines SET amount = 1 WHERE statement_id = $1", [s2.id])).rejects.toThrow(/only changes/);
    await expect(supers.query('DELETE FROM erp.bank_statement_lines')).rejects.toThrow(/never deleted/);
  });
});

describe('matching and the reconciliation statement', () => {
  it('auto-matches the clear ones, explains the rest, and reconciles to the bank balance', async () => {
    const w = await world('Recon Co');
    const a = await ledger(w, 'in', '5000', '2025-04-02', 'Customer deposit');
    const b = await ledger(w, 'out', '1200', '2025-04-05', 'Cheque 101');
    const c = await ledger(w, 'out', '300', '2025-04-06', 'Cheque 102');
    ok(await importStmt(w, april([{ date: '2025-04-03', description: 'NEFT credit', amount: '5000', reference: 'N1' }, { date: '2025-04-07', description: 'Cheque 101 cleared', amount: '-1200' }, { date: '2025-04-30', description: 'SMS charges', amount: '-50' }])));
    const [l1, l2, l3] = await lineIds(w) as unknown as [{ id: string }, { id: string }, { id: string }];
    const cand = (await call(server, 'GET', `/v1/bank-statement-lines/${l1.id}/candidates`, { tenant: w.tenant })).json.items;
    expect(cand).toEqual([expect.objectContaining({ journalLineId: a, amount: '5000.0000', daysApart: 1 })]);
    // before matching anything, everything is unexplained: books 3500 vs bank 3750
    let r = await recon(w);
    expect(r).toMatchObject({ balancePerBooks: '3500.0000', statement: { closingBalance: '3750.0000' }, depositsInTransit: { total: '5000.0000' }, outstandingPayments: { total: '1500.0000' }, reconciled: true, fullyMatched: false });
    const auto = (await call(server, 'POST', `/v1/bank-accounts/${w.bank}/auto-match`, { tenant: w.tenant, body: {} })).json;
    expect(auto).toEqual({ considered: 3, matched: 2, ambiguous: 0, unmatched: 1 });
    r = await recon(w);
    expect(r).toMatchObject({
      balancePerBooks: '3500.0000', depositsInTransit: { total: '0.0000', items: [] }, outstandingPayments: { total: '300.0000', items: [expect.objectContaining({ journalLineId: c, amount: '-300.0000' })] },
      bankItemsNotInBooks: { total: '-50.0000', items: [expect.objectContaining({ statementLineId: l3.id })] }, expectedStatementBalance: '3750.0000', difference: '0.0000', reconciled: true, fullyMatched: false,
    });
    // book the bank charge: a journal on 5900 is posted and matched
    const booked = ok(await call(server, 'POST', `/v1/bank-statement-lines/${l3.id}/book`, { tenant: w.tenant, body: { accountId: w.acc['5900'], description: 'Bank charges' } }));
    expect(booked).toMatchObject({ status: 'matched', entry: { postingDate: '2025-04-30' }, matches: [expect.objectContaining({ amount: '-50.0000' })] });
    r = await recon(w);
    expect(r).toMatchObject({ balancePerBooks: '3450.0000', outstandingPayments: { total: '300.0000' }, bankItemsNotInBooks: { total: '0.0000', items: [] }, expectedStatementBalance: '3750.0000', difference: '0.0000', reconciled: true, fullyMatched: true });
    expect(await lineIds(w, 'unmatched')).toHaveLength(0);
    // an earlier date has no statement yet
    expect((await recon(w, '2025-03-31'))).toMatchObject({ statement: null, difference: null, reconciled: false });
    void b; void l2;
  });

  it('matches several ledger lines to one bank line, refuses wrong totals and wrong lines, and lets a match be undone', async () => {
    const w = await world('Combo Co');
    const p1 = await ledger(w, 'in', '4000', '2025-04-02');
    const p2 = await ledger(w, 'in', '3000', '2025-04-02');
    const other = await ledger(w, 'in', '999', '2025-04-02');
    ok(await importStmt(w, april([{ date: '2025-04-04', description: 'Combined deposit', amount: '7000' }])));
    const [line] = await lineIds(w) as unknown as [{ id: string }];
    expect((await match(w, line.id, [p1])).json).toMatchObject({ code: 'match_amount_mismatch', ledgerTotal: '4000.0000', statementAmount: '7000.0000' });
    expect((await match(w, line.id, [p1, other])).status).toBe(422);
    const notBank = (await call(server, 'POST', '/v1/journal-entries', { tenant: w.tenant, body: { companyId: w.companyId, postingDate: '2025-04-02', description: 'x', lines: [{ accountId: w.acc['5900'], debit: '7000' }, { accountId: w.acc['1110'] ?? w.acc['1120'], credit: '7000' }] } })).json.lines[0].id as string;
    expect((await match(w, line.id, [notBank])).status).toBe(422); // a line on another account
    const cand = (await call(server, 'GET', `/v1/bank-statement-lines/${line.id}/candidates?scope=any`, { tenant: w.tenant })).json.items;
    expect(cand).toHaveLength(3);
    const done = ok(await match(w, line.id, [p1, p2]), 200);
    expect(done).toMatchObject({ status: 'matched', matches: [expect.objectContaining({ amount: '4000.0000' }), expect.objectContaining({ amount: '3000.0000' })] });
    expect((await match(w, line.id, [p1, p2])).json).toMatchObject({ code: 'line_not_open' });
    expect((await call(server, 'POST', `/v1/bank-statement-lines/${line.id}/unmatch`, { tenant: w.tenant, body: {} })).status).toBe(422); // a reason is required
    const undone = ok(await call(server, 'POST', `/v1/bank-statement-lines/${line.id}/unmatch`, { tenant: w.tenant, body: { reason: 'Wrong pairing' } }), 200);
    expect(undone.status).toBe('unmatched');
    expect(undone.matches.every((m: { endedAt: string; endReason: string }) => m.endedAt && m.endReason === 'Wrong pairing')).toBe(true); // history stays
    ok(await match(w, line.id, [p1, p2]), 200); // and it can be matched again
  });

  it('leaves ambiguous pairs for a person, and one ledger line can only be matched once, even in a race', async () => {
    const w = await world('Ambiguity Co');
    const twin1 = await ledger(w, 'in', '800', '2025-04-02');
    const twin2 = await ledger(w, 'in', '800', '2025-04-02');
    ok(await importStmt(w, april([{ date: '2025-04-03', description: 'Deposit A', amount: '800' }])));
    const auto = (await call(server, 'POST', `/v1/bank-accounts/${w.bank}/auto-match`, { tenant: w.tenant, body: {} })).json;
    expect(auto).toMatchObject({ matched: 0, ambiguous: 1 });
    const [line] = await lineIds(w) as unknown as [{ id: string }];
    ok(await match(w, line.id, [twin1]), 200);
    // the second twin cannot be matched to a second bank line in parallel with a competing match of the first
    ok(await importStmt(w, { periodFrom: '2025-05-01', periodTo: '2025-05-31', openingBalance: '800', closingBalance: '2400', lines: [{ date: '2025-05-02', description: 'X', amount: '800' }, { date: '2025-05-02', description: 'Y', amount: '800' }] }));
    const may = (await lineIds(w, 'unmatched')) as { id: string }[];
    const results = await Promise.all(may.map((m) => match(w, m.id, [twin2])));
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)?.json).toMatchObject({ code: expect.stringMatching(/ledger_line_matched|line_not_open/) });
  });

  it('keeps ignored bank items visible, and treats ledger lines before the cleared-through date as already reconciled', async () => {
    const w = await world('Ignore Co', { clearedThrough: '2025-04-01' });
    await ledger(w, 'in', '10000', '2025-04-01', 'Opening deposit'); // reconciled before this system
    await ledger(w, 'in', '500', '2025-04-02');
    ok(await importStmt(w, april([{ date: '2025-04-02', description: 'Deposit', amount: '500' }, { date: '2025-04-09', description: 'Returned and re-presented', amount: '75' }, { date: '2025-04-09', description: 'Reversal', amount: '-75' }], { periodFrom: '2025-04-02', openingBalance: '10000', closingBalance: '10500' })));
    expect((await importStmt(w, { periodFrom: '2025-03-01', periodTo: '2025-03-31', openingBalance: '0', closingBalance: '1', lines: [{ date: '2025-03-05', description: 'old', amount: '1' }] })).status).toBe(422); // before the cleared date
    const items = await lineIds(w);
    const pair = items.filter((i) => i.description !== 'Deposit');
    for (const p of pair) ok(await call(server, 'POST', `/v1/bank-statement-lines/${p.id}/ignore`, { tenant: w.tenant, body: { reason: 'Bank pair, nothing to book' } }), 200);
    let r = await recon(w);
    expect(r).toMatchObject({ balancePerBooks: '10500.0000', ignoredBankItems: { total: '0.0000', items: [expect.objectContaining({ reason: 'Bank pair, nothing to book' }), expect.anything()] }, depositsInTransit: { items: [expect.objectContaining({ amount: '500.0000' })] }, openingCheck: { openingBalance: '10000.0000', booksThroughClearedDate: '10000.0000', difference: '0.0000' } });
    expect(r.difference).toBe('0.0000');
    ok(await call(server, 'POST', `/v1/bank-statement-lines/${pair[0]!.id}/unignore`, { tenant: w.tenant }), 200);
    r = await recon(w);
    expect(r.bankItemsNotInBooks.items).toHaveLength(2);
    expect((await call(server, 'POST', `/v1/bank-statement-lines/${pair[0]!.id}/unignore`, { tenant: w.tenant })).json).toMatchObject({ code: 'line_not_ignored' });
  });

  it('keeps a matched statement from being voided, and the database rejects inconsistent matches', async () => {
    const w = await world('Guard Co');
    const a = await ledger(w, 'in', '250', '2025-04-02');
    const stmt = ok(await importStmt(w, april([{ date: '2025-04-03', description: 'Deposit', amount: '250' }])));
    const [line] = await lineIds(w) as unknown as [{ id: string }];
    ok(await match(w, line.id, [a]), 200);
    expect((await call(server, 'POST', `/v1/bank-statements/${stmt.id}/void`, { tenant: w.tenant, body: { reason: 'oops' } })).json).toMatchObject({ code: 'has_matches' });
    // raw SQL: a status of 'matched' with no matches, a wrong amount, and deletion are all refused
    await expect(supers.query("UPDATE erp.bank_matches SET amount = 1")).rejects.toThrow(/only be ended/);
    await expect(supers.query('DELETE FROM erp.bank_matches')).rejects.toThrow(/never deleted/);
    const cl = await supers.connect();
    try {
      await cl.query('BEGIN');
      await cl.query("UPDATE erp.bank_matches SET ended_at = now(), end_reason = 'raw' WHERE statement_line_id = $1", [line.id]);
      await expect(cl.query('COMMIT')).rejects.toThrow(/status disagrees/); // ended match but the line still says matched
    } finally { await cl.query('ROLLBACK').catch(() => undefined); cl.release(); }
  });

  it('is permissioned and isolated per tenant', async () => {
    const w = await world('Perm Co');
    const x = await world('Perm Other Co');
    const reader = await user(w, w.slug, ['bank:read']);
    const rec = await user(w, w.slug, ['bank:read', 'bank:reconcile']);
    const a = await ledger(w, 'in', '60', '2025-04-02');
    ok(await importStmt(w, april([{ date: '2025-04-03', description: 'Deposit', amount: '60' }, { date: '2025-04-04', description: 'Fee', amount: '-5' }])));
    const [l1, l2] = await lineIds(w) as unknown as [{ id: string }, { id: string }];
    expect((await call(server, 'POST', `/v1/bank-statement-lines/${l1.id}/match`, { token: reader, body: { journalLineIds: [a] } })).status).toBe(403);
    expect((await importStmt(w, april([{ date: '2025-04-03', description: 'z', amount: '1' }]), rec)).status).toBe(403);
    expect((await call(server, 'POST', `/v1/bank-statement-lines/${l2.id}/book`, { token: rec, body: { accountId: w.acc['5900'] } })).status).toBe(403); // needs accounting:post as well
    expect((await call(server, 'POST', `/v1/bank-statement-lines/${l1.id}/match`, { token: rec, body: { journalLineIds: [a] } })).status).toBe(200);
    expect((await call(server, 'GET', `/v1/bank-statement-lines/${l1.id}`, { tenant: x.tenant })).status).toBe(404);
    expect((await call(server, 'GET', `/v1/bank-accounts/${w.bank}/reconciliation?asOf=2025-04-30`, { tenant: x.tenant })).status).toBe(404);
  });
});
