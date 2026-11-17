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

interface World extends Buyer { maker: string; a1: string; a2: string; slug: string }

async function user(b: Buyer, slug: string, role: string, permissions: string[]): Promise<string> {
  const r = ok(await call(server, 'POST', '/v1/roles', { tenant: b.tenant, body: { name: `${role}-${++n}`, permissions } }));
  const email = `u${++n}@${slug}.example.com`;
  ok(await call(server, 'POST', '/v1/users', { tenant: b.tenant, body: { email, displayName: role, password: PW, roleIds: [r.id] } }));
  const login = await call(server, 'POST', '/v1/auth/login', { body: { tenant: slug, email, password: PW } });
  expect(login.status).toBe(200);
  return (login.json as { accessToken: string }).accessToken;
}

/** A buyer with a maker (can post, cannot approve) and two approvers (cannot post). */
async function world(name: string): Promise<World> {
  const b = await k.buyer(name);
  const slug = (await supers.query('SELECT slug FROM erp.tenants WHERE id = $1', [b.tenant])).rows[0].slug as string;
  return {
    ...b, slug,
    maker: await user(b, slug, 'maker', ['accounting:post', 'payables:post', 'purchasing:post']),
    a1: await user(b, slug, 'approver', ['approvals:decide', 'approvals:read']),
    a2: await user(b, slug, 'approver', ['approvals:decide', 'approvals:read']),
  };
}
const policy = (w: World, documentType: string, thresholdAmount: string, requiredApprovals: number, o: object = {}) =>
  call(server, 'POST', '/v1/approval-policies', { tenant: w.tenant, body: { companyId: w.companyId, documentType, thresholdAmount, requiredApprovals, ...o } });
const journalBody = (w: World, amount: string) => ({ companyId: w.companyId, postingDate: '2025-04-10', description: 'Adjustment', lines: [{ accountId: w.acc['5900'], debit: amount }, { accountId: w.acc['1120'], credit: amount }] });
const ask = (w: World, documentType: string, payload: object, token = w.maker) => call(server, 'POST', '/v1/approvals/requests', { token, body: { companyId: w.companyId, documentType, payload } });
const approve = (token: string, id: string) => call(server, 'POST', `/v1/approvals/requests/${id}/approve`, { token, body: {} });
const postJournal = (w: World, amount: string, approvalId?: string, token = w.maker) =>
  call(server, 'POST', '/v1/journal-entries', { token, ...(approvalId ? { headers: { 'approval-id': approvalId } } : {}), body: journalBody(w, amount) });
const status = async (w: World, id: string) => (await call(server, 'GET', `/v1/approvals/requests/${id}`, { token: w.a1 })).json;

describe('policies', () => {
  it('are managed with versions, and cannot be duplicated or deleted', async () => {
    const w = await world('Policy Co');
    const p = ok(await policy(w, 'journal', '10000', 2));
    expect(p).toMatchObject({ documentType: 'journal', thresholdAmount: '10000.0000', requiredApprovals: 2, validDays: 7, status: 'active', version: 1 });
    expect((await policy(w, 'journal', '10000', 1)).status).toBe(409);
    const upd = await call(server, 'PATCH', `/v1/approval-policies/${p.id}`, { tenant: w.tenant, headers: { 'if-match': '1' }, body: { requiredApprovals: 3 } });
    expect(upd.json).toMatchObject({ requiredApprovals: 3, version: 2 });
    expect((await call(server, 'PATCH', `/v1/approval-policies/${p.id}`, { tenant: w.tenant, headers: { 'if-match': '1' }, body: { requiredApprovals: 1 } })).status).toBe(412);
    expect((await call(server, 'GET', `/v1/approval-policies?companyId=${w.companyId}`, { token: w.a1 })).json.items).toHaveLength(1);
    expect((await policy(w, 'journal', '5', 1)).status).toBe(201);
    expect((await call(server, 'POST', '/v1/approval-policies', { token: w.maker, body: { companyId: w.companyId, documentType: 'journal', thresholdAmount: '1', requiredApprovals: 1 } })).status).toBe(403);
    await expect(supers.query('DELETE FROM erp.approval_policies')).rejects.toThrow(/never deleted/);
    await expect(supers.query("UPDATE erp.approval_policies SET threshold_amount = 1 WHERE id = $1", [p.id])).rejects.toThrow(/only changes/);
  });
});

describe('the approval flow on a manual journal', () => {
  it('lets small amounts through, demands approval above the threshold, and consumes an approval exactly once', async () => {
    const w = await world('Journal Flow Co');
    ok(await policy(w, 'journal', '10000', 2));
    ok(await postJournal(w, '9999.9999'));
    const blocked = await postJournal(w, '20000');
    expect(blocked.status).toBe(409);
    expect(blocked.json).toMatchObject({ code: 'approval_required', documentType: 'journal', amount: '20000.0000', requiredApprovals: 2 });
    expect((await ask(w, 'journal', journalBody(w, '500'))).json).toMatchObject({ code: 'approval_not_required' });
    expect((await ask(w, 'journal', { ...journalBody(w, '20000'), companyId: 'nonsense' })).status).toBe(422);

    const req = ok(await ask(w, 'journal', journalBody(w, '20000')));
    expect(req).toMatchObject({ requestNo: expect.stringMatching(/^APR-\d{6}$/), status: 'pending', amount: '20000.0000', requiredApprovals: 2, approvalsCount: 0, expired: false });
    // not approved yet
    expect((await postJournal(w, '20000', req.id)).json).toMatchObject({ code: 'approval_invalid' });
    // the maker cannot decide (no permission), and the first approval is not enough
    expect((await approve(w.maker, req.id)).status).toBe(403);
    expect(ok(await approve(w.a1, req.id), 200)).toMatchObject({ status: 'pending', approvalsCount: 1 });
    expect((await approve(w.a1, req.id)).json).toMatchObject({ code: 'already_decided' });
    expect((await postJournal(w, '20000', req.id)).status).toBe(409);
    expect(ok(await approve(w.a2, req.id), 200)).toMatchObject({ status: 'approved', approvalsCount: 2 });
    // a different document than the one approved is refused, even by a little
    expect((await postJournal(w, '20000.0001', req.id)).json).toMatchObject({ code: 'approval_invalid', reason: expect.stringContaining('differs') });
    const entry = ok(await postJournal(w, '20000', req.id));
    const after = await status(w, req.id);
    expect(after).toMatchObject({ status: 'consumed', consumedRefType: 'journal_entry', consumedRefId: entry.id, decisions: [expect.objectContaining({ decision: 'approve' }), expect.objectContaining({ decision: 'approve' })] });
    expect((await postJournal(w, '20000', req.id)).json).toMatchObject({ code: 'approval_invalid', reason: expect.stringContaining('already been used') });
    const audit = await call(server, 'GET', '/v1/audit-events?limit=200', { tenant: w.tenant });
    expect(JSON.stringify(audit.json)).toContain('approval_request.approved');
  });

  it('uses the highest threshold reached, so bigger amounts need more approvals', async () => {
    const w = await world('Tier Co');
    ok(await policy(w, 'journal', '1000', 1));
    ok(await policy(w, 'journal', '50000', 2));
    const small = ok(await ask(w, 'journal', journalBody(w, '2000')));
    expect(small.requiredApprovals).toBe(1);
    const big = ok(await ask(w, 'journal', journalBody(w, '60000')));
    expect(big.requiredApprovals).toBe(2);
    expect(ok(await approve(w.a1, small.id), 200).status).toBe('approved');
    expect(ok(await approve(w.a1, big.id), 200).status).toBe('pending');
  });

  it('never lets someone decide their own request, in the API or in the database', async () => {
    const w = await world('SoD Co');
    ok(await policy(w, 'journal', '100', 1));
    const selfish = await user(w, w.slug, 'both', ['accounting:post', 'approvals:decide']);
    const req = ok(await ask(w, 'journal', journalBody(w, '500'), selfish));
    expect((await approve(selfish, req.id)).json).toMatchObject({ code: 'self_approval' });
    const requester = (await supers.query('SELECT requested_by FROM erp.approval_requests WHERE id = $1', [req.id])).rows[0].requested_by as string;
    await expect(supers.query("INSERT INTO erp.approval_decisions (tenant_id, id, request_id, decision, decided_by) VALUES ($1, gen_random_uuid(), $2, 'approve', $3)", [w.tenant, req.id, requester])).rejects.toThrow(/own approval request/);
  });

  it('keeps rejected and cancelled requests final, and lets only the requester (or a manager) cancel', async () => {
    const w = await world('Reject Co');
    ok(await policy(w, 'journal', '100', 1));
    const r1 = ok(await ask(w, 'journal', journalBody(w, '500')));
    expect((await call(server, 'POST', `/v1/approvals/requests/${r1.id}/reject`, { token: w.a1, body: {} })).status).toBe(422); // a reason is required
    expect(ok(await call(server, 'POST', `/v1/approvals/requests/${r1.id}/reject`, { token: w.a1, body: { comment: 'Not justified' } }), 200)).toMatchObject({ status: 'rejected' });
    expect((await approve(w.a2, r1.id)).json).toMatchObject({ code: 'not_pending' });
    expect((await postJournal(w, '500', r1.id)).json).toMatchObject({ code: 'approval_invalid' });
    await expect(supers.query("UPDATE erp.approval_requests SET status = 'approved' WHERE id = $1", [r1.id])).rejects.toThrow(/final|cannot move|enough approvals/);

    const r2 = ok(await ask(w, 'journal', journalBody(w, '600')));
    expect((await call(server, 'POST', `/v1/approvals/requests/${r2.id}/cancel`, { token: w.a1, body: {} })).status).toBe(403);
    expect(ok(await call(server, 'POST', `/v1/approvals/requests/${r2.id}/cancel`, { token: w.maker, body: { reason: 'Changed my mind' } }), 200)).toMatchObject({ status: 'cancelled' });
    expect((await call(server, 'POST', `/v1/approvals/requests/${r2.id}/cancel`, { token: w.maker, body: {} })).json).toMatchObject({ code: 'not_cancellable' });
  });

  it('stops honouring an approval after its validity, and after the policy asks for more approvals', async () => {
    const w = await world('Expiry Co');
    const p = ok(await policy(w, 'journal', '100', 1, { validDays: 1 }));
    const req = ok(await ask(w, 'journal', journalBody(w, '700')));
    ok(await approve(w.a1, req.id), 200);
    await supers.query("UPDATE erp.approval_requests SET valid_until = now() - interval '1 minute' WHERE id = $1", [req.id]);
    expect(await status(w, req.id)).toMatchObject({ status: 'approved', expired: true });
    expect((await postJournal(w, '700', req.id)).json).toMatchObject({ code: 'approval_invalid', reason: expect.stringContaining('expired') });

    const req2 = ok(await ask(w, 'journal', journalBody(w, '800')));
    ok(await approve(w.a1, req2.id), 200);
    ok(await call(server, 'PATCH', `/v1/approval-policies/${p.id}`, { tenant: w.tenant, headers: { 'if-match': '1' }, body: { requiredApprovals: 2 } }), 200);
    expect((await postJournal(w, '800', req2.id)).json).toMatchObject({ code: 'approval_invalid', reason: expect.stringContaining('now needs 2') });
    // deactivating the policy lifts the requirement altogether
    ok(await call(server, 'PATCH', `/v1/approval-policies/${p.id}`, { tenant: w.tenant, headers: { 'if-match': '2' }, body: { status: 'inactive' } }), 200);
    ok(await postJournal(w, '800'));
  });

  it('gives the approval back when the command it was for fails, and rejects it for another company or kind', async () => {
    const w = await world('Rollback Co');
    ok(await policy(w, 'payment', '100', 1));
    ok(await policy(w, 'journal', '100', 1));
    const payload = { companyId: w.companyId, supplierId: '019a0000-0000-7000-8000-000000000000', paymentDate: '2025-04-20', amount: '500', method: 'bank_transfer', paidFromAccountId: w.acc['1120'] };
    const req = ok(await ask(w, 'payment', payload));
    ok(await approve(w.a1, req.id), 200);
    const failed = await call(server, 'POST', '/v1/payables/payments', { token: w.maker, headers: { 'approval-id': req.id }, body: payload });
    expect(failed.status).toBeGreaterThanOrEqual(400);
    expect(failed.json).not.toMatchObject({ code: 'approval_invalid' });
    expect(await status(w, req.id)).toMatchObject({ status: 'approved', consumedAt: null }); // still usable
    // a payment approval cannot be spent on a journal
    expect((await postJournal(w, '500', req.id)).json).toMatchObject({ code: 'approval_invalid' });
    expect((await postJournal(w, '500', 'not-a-uuid')).json).toMatchObject({ code: 'approval_invalid' });
  });

  it('shows requesters their own requests and approvers all of them, and replays an approval idempotently', async () => {
    const w = await world('Inbox Co');
    ok(await policy(w, 'journal', '100', 1));
    const mine = ok(await ask(w, 'journal', journalBody(w, '500')));
    const other = ok(await ask(w, 'journal', journalBody(w, '600'), await user(w, w.slug, 'maker2', ['accounting:post'])));
    const q = `/v1/approvals/requests?companyId=${w.companyId}`;
    expect((await call(server, 'GET', q, { token: w.maker })).json.items.map((r: { id: string }) => r.id)).toEqual([mine.id]);
    expect((await call(server, 'GET', q + '&status=pending', { token: w.a1 })).json.items).toHaveLength(2);
    expect((await call(server, 'GET', `/v1/approvals/requests/${other.id}`, { token: w.maker })).status).toBe(404);
    expect((await call(server, 'GET', `/v1/approvals/requests/${mine.id}`, { token: w.maker })).status).toBe(200);
    const key = { 'idempotency-key': 'approve-1' };
    const first = await call(server, 'POST', `/v1/approvals/requests/${mine.id}/approve`, { token: w.a1, headers: key, body: {} });
    const again = await call(server, 'POST', `/v1/approvals/requests/${mine.id}/approve`, { token: w.a1, headers: key, body: {} });
    expect(first.status).toBe(200);
    expect(again.json).toEqual(first.json);
    // a user without the right to post cannot even ask
    expect((await ask(w, 'journal', journalBody(w, '500'), w.a1)).status).toBe(403);
  });
});

describe('concurrency', () => {
  it('lets exactly one of several simultaneous commands spend an approval', async () => {
    const w = await world('Race Co');
    ok(await policy(w, 'journal', '100', 1));
    const req = ok(await ask(w, 'journal', journalBody(w, '900')));
    ok(await approve(w.a1, req.id), 200);
    const results = await Promise.all(Array.from({ length: 5 }, () => postJournal(w, '900', req.id)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);
    const rows = await supers.query("SELECT count(*)::int AS n FROM erp.journal_entries WHERE tenant_id = $1 AND description = 'Adjustment' AND source_type = 'manual'", [w.tenant]);
    expect(rows.rows[0].n).toBe(1);
  });
});

describe('purchase orders and supplier payments', () => {
  it('are gated by their own policies, measured before tax', async () => {
    const w = await world('Docs Co');
    ok(await policy(w, 'purchase_order', '5000', 1));
    ok(await policy(w, 'payment', '1000', 1));
    const po = (quantity: string, price: string, discountPercent = '0') => ({ companyId: w.companyId, gstRegistrationId: w.regId, supplierId: w.sup.intra, orderDate: '2025-04-10', lines: [{ itemId: w.item.widget, quantity, unitPrice: price, discountPercent, warehouseId: w.wh }] });
    const createPo = (body: object, id?: string) => call(server, 'POST', '/v1/purchasing/orders', { token: w.maker, ...(id ? { headers: { 'approval-id': id } } : {}), body });
    ok(await createPo(po('9', '500'))); // 4,500
    ok(await createPo(po('10', '600', '25'))); // 10 x 600 less 25% = 4,500
    expect((await createPo(po('10', '500'))).json).toMatchObject({ code: 'approval_required', amount: '5000.0000' });
    const req = ok(await ask(w, 'purchase_order', po('10', '500')));
    expect(req.amount).toBe('5000.0000');
    ok(await approve(w.a1, req.id), 200);
    const order = ok(await createPo(po('10', '500'), req.id));
    expect(await status(w, req.id)).toMatchObject({ status: 'consumed', consumedRefType: 'purchase_order', consumedRefId: order.id });

    const pay = (amount: string, id?: string) => call(server, 'POST', '/v1/payables/payments', { token: w.maker, ...(id ? { headers: { 'approval-id': id } } : {}), body: { companyId: w.companyId, supplierId: w.sup.intra, paymentDate: '2025-04-20', amount, method: 'bank_transfer', paidFromAccountId: w.acc['1120'] } });
    ok(await pay('999.99'));
    expect((await pay('1000')).json).toMatchObject({ code: 'approval_required' });
    const payReq = ok(await ask(w, 'payment', { companyId: w.companyId, supplierId: w.sup.intra, paymentDate: '2025-04-20', amount: '1000', method: 'bank_transfer', paidFromAccountId: w.acc['1120'] }));
    ok(await approve(w.a1, payReq.id), 200);
    const payment = ok(await pay('1000', payReq.id));
    expect(payment).toMatchObject({ amount: '1000.0000', status: 'posted' });
    expect(await status(w, payReq.id)).toMatchObject({ consumedRefType: 'supplier_payment', consumedRefId: payment.id });
  });
});

describe('isolation and immutability', () => {
  it('keeps tenants apart and never lets the runtime role change what an approval says', async () => {
    const w = await world('Iso Co');
    const x = await world('Iso Other Co');
    ok(await policy(w, 'journal', '100', 1));
    const req = ok(await ask(w, 'journal', journalBody(w, '500')));
    expect((await call(server, 'GET', `/v1/approvals/requests/${req.id}`, { token: x.a1 })).status).toBe(404);
    expect((await approve(x.a1, req.id)).status).toBe(404);
    await expect(supers.query("UPDATE erp.approval_requests SET amount = 1 WHERE id = $1", [req.id])).rejects.toThrow(/never changes/);
    await expect(supers.query("UPDATE erp.approval_requests SET payload_hash = 'x' WHERE id = $1", [req.id])).rejects.toThrow(/never changes/);
    await expect(supers.query('DELETE FROM erp.approval_requests WHERE id = $1', [req.id])).rejects.toThrow(/never deleted/);
    ok(await approve(w.a1, req.id), 200);
    await expect(supers.query('UPDATE erp.approval_decisions SET decision = $1', ['reject'])).rejects.toThrow(/append-only/);
    await expect(supers.query('DELETE FROM erp.approval_decisions')).rejects.toThrow(/append-only/);
    await expect(supers.query("UPDATE erp.approval_requests SET status = 'pending' WHERE id = $1", [req.id])).rejects.toThrow(/cannot move/);
  });
});
