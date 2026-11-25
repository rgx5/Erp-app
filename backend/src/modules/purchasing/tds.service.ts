import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Tx } from '../../platform/database/database.js';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError, validationFailed } from '../../platform/http/errors.js';
import { PostingService } from '../accounting/posting.service.js';
import { Recorder } from '../masterdata/helpers.js';
import { computeTds, DEFAULT_SECTIONS, financialYearOf } from './tds.logic.js';

export interface Computed { sectionCode: string; base: string; rate: number; amount: string; applies: boolean; pan: string | null; noPan: boolean; reason: string; paidBeforeInYear: string }
type SectionRow = { code: string; description: string; rate: string; single_limit: string; annual_limit: string; status: string };

@Injectable()
export class TdsService {
  constructor(@Inject(UnitOfWork) private readonly uow: UnitOfWork, @Inject(PostingService) private readonly posting: PostingService, @Inject(Recorder) private readonly recorder: Recorder) {}

  async ensureSections(tx: Tx, tenantId: string): Promise<void> {
    const have = (await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM erp.tds_sections WHERE tenant_id = ${tenantId}::uuid`)).rows[0]?.n ?? 0;
    if (have === 0) for (const s of DEFAULT_SECTIONS) await tx.execute(sql`INSERT INTO erp.tds_sections (tenant_id, id, code, description, rate, single_limit, annual_limit) VALUES (${tenantId}::uuid, ${uuidv7()}::uuid, ${s.code}, ${s.description}, ${s.rate}, ${s.singleLimit}, ${s.annualLimit}) ON CONFLICT DO NOTHING`);
  }
  listSections(tenantId: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      await this.ensureSections(tx, tenantId);
      return (await tx.execute<SectionRow>(sql`SELECT code, description, rate, single_limit, annual_limit, status FROM erp.tds_sections WHERE tenant_id = ${tenantId}::uuid ORDER BY code`)).rows.map((r) => ({ code: r.code, description: r.description, rate: r.rate, singleLimit: r.single_limit, annualLimit: r.annual_limit, status: r.status }));
    });
  }
  saveSection(tenantId: string, s: { code: string; description: string; rate: string; singleLimit: string; annualLimit: string; status: 'active' | 'inactive' }) {
    return this.uow.inTenant(tenantId, async (tx) => {
      await this.ensureSections(tx, tenantId);
      await tx.execute(sql`INSERT INTO erp.tds_sections (tenant_id, id, code, description, rate, single_limit, annual_limit, status) VALUES (${tenantId}::uuid, ${uuidv7()}::uuid, ${s.code}, ${s.description}, ${s.rate}, ${s.singleLimit}, ${s.annualLimit}, ${s.status})
        ON CONFLICT (tenant_id, code) DO UPDATE SET description = EXCLUDED.description, rate = EXCLUDED.rate, single_limit = EXCLUDED.single_limit, annual_limit = EXCLUDED.annual_limit, status = EXCLUDED.status`);
      await this.recorder.record(tx, tenantId, 'tds_section', 'saved', { id: tenantId }, { code: s.code, rate: s.rate });
      return { ok: true };
    });
  }

  /** What would be deducted from a payment of this size to this supplier under this section. Nothing is written. */
  async compute(tx: Tx, tenantId: string, p: { supplierId: string; sectionCode: string; gross: string; paymentDate: string; base?: string | undefined; excludePaymentId?: string | undefined }): Promise<Computed> {
    await this.ensureSections(tx, tenantId);
    const sec = (await tx.execute<SectionRow>(sql`SELECT code, description, rate, single_limit, annual_limit, status FROM erp.tds_sections WHERE tenant_id = ${tenantId}::uuid AND code = ${p.sectionCode}`)).rows[0];
    if (!sec || sec.status !== 'active') throw validationFailed([{ path: 'tds.sectionCode', message: 'That TDS section is not available' }]);
    const party = (await tx.execute<{ pan: string | null }>(sql`SELECT pan FROM erp.parties WHERE tenant_id = ${tenantId}::uuid AND id = ${p.supplierId}::uuid`)).rows[0];
    const fy = financialYearOf(p.paymentDate);
    const before = (await tx.execute<{ s: string }>(sql`SELECT COALESCE(sum(amount), 0)::text AS s FROM erp.supplier_payments WHERE tenant_id = ${tenantId}::uuid AND supplier_id = ${p.supplierId}::uuid AND status = 'posted' AND payment_date BETWEEN ${fy.from}::date AND ${fy.to}::date AND (${p.excludePaymentId ?? null}::uuid IS NULL OR id <> ${p.excludePaymentId ?? null}::uuid)`)).rows[0]?.s ?? '0';
    const base = p.base ?? p.gross;
    const r = computeTds({ base, sectionRate: sec.rate, singleLimit: sec.single_limit, annualLimit: sec.annual_limit, paidBeforeInYear: before, hasPan: Boolean(party?.pan) });
    return { sectionCode: sec.code, base, rate: r.rate, amount: r.amount, applies: r.applies, pan: party?.pan ?? null, noPan: !party?.pan, reason: r.reason, paidBeforeInYear: before };
  }
  suggest(tenantId: string, q: { supplierId: string; sectionCode: string; amount: string; date: string; base?: string | undefined }) {
    return this.uow.inTenant(tenantId, (tx) => this.compute(tx, tenantId, { supplierId: q.supplierId, sectionCode: q.sectionCode, gross: q.amount, paymentDate: q.date, base: q.base }));
  }

  /** The account the deductions are held in until they are deposited: the chart's "TDS payable" (2240). */
  async account(tx: Tx, tenantId: string, companyId: string): Promise<string> {
    const a = (await tx.execute<{ id: string }>(sql`SELECT id FROM erp.accounts WHERE tenant_id = ${tenantId}::uuid AND company_id = ${companyId}::uuid AND status = 'active' AND NOT is_group AND (code = '2240' OR name ILIKE 'TDS payable%') ORDER BY (code = '2240') DESC LIMIT 1`)).rows[0];
    if (!a) throw new AppError(409, 'tds_account_missing', 'Add a "TDS payable" account (code 2240) to the chart of accounts before deducting TDS', { missing: ['tdsPayableAccount'] });
    return a.id;
  }

  async save(tx: Tx, tenantId: string, actorId: string, p: { companyId: string; supplierId: string; paymentId: string; paymentDate: string; computed: Computed; amount: string }): Promise<void> {
    await tx.execute(sql`INSERT INTO erp.tds_deductions (tenant_id, id, company_id, supplier_id, payment_id, section_code, rate, base_amount, tds_amount, pan, no_pan_rate, deducted_on, created_by)
      VALUES (${tenantId}::uuid, ${uuidv7()}::uuid, ${p.companyId}::uuid, ${p.supplierId}::uuid, ${p.paymentId}::uuid, ${p.computed.sectionCode}, ${p.computed.rate}, ${p.computed.base}, ${p.amount}, ${p.computed.pan}, ${p.computed.noPan}, ${p.paymentDate}::date, ${actorId}::uuid)`);
  }
  async cancelForPayment(tx: Tx, tenantId: string, paymentId: string): Promise<void> {
    const d = (await tx.execute<{ id: string; status: string }>(sql`SELECT id, status FROM erp.tds_deductions WHERE tenant_id = ${tenantId}::uuid AND payment_id = ${paymentId}::uuid FOR UPDATE`)).rows[0];
    if (!d) return;
    if (d.status === 'deposited') throw new AppError(409, 'tds_deposited', 'The TDS deducted from this payment has been deposited with the government; it cannot be cancelled');
    await tx.execute(sql`UPDATE erp.tds_deductions SET status = 'cancelled' WHERE tenant_id = ${tenantId}::uuid AND id = ${d.id}::uuid`);
  }

  // ---- registers ----------------------------------------------------------------------------------------------------------
  list(tenantId: string, q: { companyId?: string | undefined; from?: string | undefined; to?: string | undefined; status?: string | undefined; supplierId?: string | undefined }) {
    return this.uow.inTenant(tenantId, async (tx) => (await tx.execute<{ id: string; company_id: string; supplier_id: string; supplier: string; payment_id: string; payment_no: string; section_code: string; rate: string; base_amount: string; tds_amount: string; pan: string | null; no_pan_rate: boolean; deducted_on: string; status: string; challan_no: string | null; challan_date: string | null; deposited_on: string | null }>(sql`
      SELECT d.id, d.company_id, d.supplier_id, COALESCE(p.trade_name, p.legal_name) AS supplier, d.payment_id, sp.payment_no, d.section_code, d.rate, d.base_amount, d.tds_amount, d.pan, d.no_pan_rate, to_char(d.deducted_on, 'YYYY-MM-DD') AS deducted_on, d.status, d.challan_no, to_char(d.challan_date, 'YYYY-MM-DD') AS challan_date, to_char(d.deposited_on, 'YYYY-MM-DD') AS deposited_on
      FROM erp.tds_deductions d JOIN erp.parties p ON p.tenant_id = d.tenant_id AND p.id = d.supplier_id JOIN erp.supplier_payments sp ON sp.tenant_id = d.tenant_id AND sp.id = d.payment_id
      WHERE d.tenant_id = ${tenantId}::uuid AND (${q.companyId ?? null}::uuid IS NULL OR d.company_id = ${q.companyId ?? null}::uuid) AND (${q.from ?? null}::date IS NULL OR d.deducted_on >= ${q.from ?? null}::date) AND (${q.to ?? null}::date IS NULL OR d.deducted_on <= ${q.to ?? null}::date)
        AND (${q.status ?? null}::text IS NULL OR d.status = ${q.status ?? null}) AND (${q.supplierId ?? null}::uuid IS NULL OR d.supplier_id = ${q.supplierId ?? null}::uuid) ORDER BY d.deducted_on DESC, sp.payment_no DESC LIMIT 2000`)).rows.map((r) => ({
      id: r.id, companyId: r.company_id, supplierId: r.supplier_id, supplier: r.supplier, paymentId: r.payment_id, paymentNo: r.payment_no, sectionCode: r.section_code, rate: r.rate, baseAmount: r.base_amount, tdsAmount: r.tds_amount, pan: r.pan, noPanRate: r.no_pan_rate,
      deductedOn: r.deducted_on, status: r.status, challanNo: r.challan_no, challanDate: r.challan_date, depositedOn: r.deposited_on, dueDate: dueDate(r.deducted_on) })), { readOnly: true });
  }

  /** Records the deposit of deductions with the government: Dr TDS payable, Cr bank, and the challan details against each deduction. */
  deposit(tenantId: string, actorId: string, input: { ids: string[]; paidFromAccountId: string; depositedOn: string; challanNo: string; challanDate: string; bsrCode?: string | undefined }) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const rows = (await tx.execute<{ id: string; company_id: string; tds_amount: string; status: string; deducted_on: string }>(sql`SELECT id, company_id, tds_amount, status, to_char(deducted_on, 'YYYY-MM-DD') AS deducted_on FROM erp.tds_deductions WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${sql`ARRAY[${sql.join(input.ids.map((x) => sql`${x}::uuid`), sql`, `)}]::uuid[]`}) FOR UPDATE`)).rows;
      if (rows.length !== new Set(input.ids).size) throw new AppError(404, 'not_found', 'One of those deductions does not exist');
      if (rows.some((r) => r.status !== 'deducted')) throw new AppError(409, 'not_deductible', 'Only deductions that are still to be deposited can be included');
      const companyId = rows[0]?.company_id as string;
      if (rows.some((r) => r.company_id !== companyId)) throw validationFailed([{ path: 'ids', message: 'Deposit one company at a time' }]);
      if (input.depositedOn < rows.reduce((m, r) => (r.deducted_on > m ? r.deducted_on : m), '0000-00-00')) throw validationFailed([{ path: 'depositedOn', message: 'Cannot be before the deduction' }]);
      const total = rows.reduce((s, r) => s + BigInt(Math.round(Number(r.tds_amount) * 100)), 0n);
      const amount = `${total / 100n}.${String(total % 100n).padStart(2, '0')}`;
      const tdsAccount = await this.account(tx, tenantId, companyId);
      const id = uuidv7();
      const { entry } = await this.posting.post(tx, tenantId, { companyId, postingDate: input.depositedOn, journalType: 'system', description: `TDS deposited, challan ${input.challanNo}`, lines: [{ accountId: tdsAccount, debit: amount, description: input.challanNo }, { accountId: input.paidFromAccountId, credit: amount, description: input.challanNo }], source: { type: 'tds_deposit', id, event: 'post' }, postedBy: actorId });
      await tx.execute(sql`UPDATE erp.tds_deductions SET status = 'deposited', deposit_journal_id = ${entry.id}::uuid, challan_no = ${input.challanNo}, challan_date = ${input.challanDate}::date, bsr_code = ${input.bsrCode ?? null}, deposited_on = ${input.depositedOn}::date WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${sql`ARRAY[${sql.join(input.ids.map((x) => sql`${x}::uuid`), sql`, `)}]::uuid[]`})`);
      await this.recorder.record(tx, tenantId, 'tds_deposit', 'posted', { id }, { challanNo: input.challanNo, amount, count: rows.length });
      return { amount, count: rows.length, journalEntryId: entry.id };
    });
  }
}

/** TDS is due with the government by the 7th of the month after the deduction (30 April for March). */
export function dueDate(deductedOn: string): string {
  const y = Number(deductedOn.slice(0, 4)); const m = Number(deductedOn.slice(5, 7));
  if (m === 3) return `${y}-04-30`;
  const ny = m === 12 ? y + 1 : y; const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-07`;
}
