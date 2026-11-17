import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, lte, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Tx } from '../../platform/database/database.js';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError, notFound, validationFailed } from '../../platform/http/errors.js';
import { decodeCursor, toPage } from '../../platform/http/validation.js';
import { companies } from '../organization/organization.schema.js';
import { first, Recorder, updateVersioned } from '../masterdata/helpers.js';
import { approvalDecisions, approvalPolicies, approvalRequests } from './approvals.schema.js';
import type { CreatePolicyInput, CreateRequestInput, ListRequestsQuery, UpdatePolicyInput } from './approvals.schemas.js';
import { canonical, type DocumentType, SUBJECTS } from './subjects.js';

export type PolicyRow = typeof approvalPolicies.$inferSelect;
export type RequestRow = typeof approvalRequests.$inferSelect;
export type DecisionRow = typeof approvalDecisions.$inferSelect;

interface LooseSubject {
  label: string;
  permission: string;
  schema: { safeParse(v: unknown): { success: true; data: unknown } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } };
  companyId(i: unknown): string;
  amount(i: unknown): string;
  summary(i: unknown): string;
}
const subjectOf = (type: DocumentType): LooseSubject => SUBJECTS[type] as unknown as LooseSubject;
const hashOf = (parsed: unknown): string => createHash('sha256').update(canonical(parsed)).digest('hex');

/** What a command needs to prove it was approved. */
export interface ApprovalClaim { tenantId: string; userId: string; approvalId: string | undefined }

@Injectable()
export class ApprovalsService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(Recorder) private readonly recorder: Recorder,
  ) {}

  // ---- policies -------------------------------------------------------------------------------------------------------
  createPolicy(tenantId: string, actorId: string, input: CreatePolicyInput): Promise<PolicyRow> {
    return this.uow.inTenant(tenantId, async (tx) => {
      await this.requireCompany(tx, tenantId, input.companyId);
      const [clash] = await tx.select({ id: approvalPolicies.id }).from(approvalPolicies).where(and(eq(approvalPolicies.tenantId, tenantId), eq(approvalPolicies.companyId, input.companyId), eq(approvalPolicies.documentType, input.documentType), eq(approvalPolicies.thresholdAmount, input.thresholdAmount), eq(approvalPolicies.status, 'active')));
      if (clash) throw new AppError(409, 'policy_exists', 'An active policy already exists for this document type and threshold; update it instead');
      const row = first(await tx.insert(approvalPolicies).values({ tenantId, id: uuidv7(), companyId: input.companyId, documentType: input.documentType, thresholdAmount: input.thresholdAmount, requiredApprovals: input.requiredApprovals, validDays: input.validDays, createdBy: actorId }).returning(), 'Policy');
      return this.recorder.record(tx, tenantId, 'approval_policy', 'created', row, { documentType: row.documentType, threshold: row.thresholdAmount, requiredApprovals: row.requiredApprovals });
    });
  }

  updatePolicy(tenantId: string, id: string, version: number, input: UpdatePolicyInput): Promise<PolicyRow> {
    return this.uow.inTenant(tenantId, async (tx) => {
      const row = await updateVersioned<PolicyRow>(tx, approvalPolicies, tenantId, id, version, { ...input, version: sql`${approvalPolicies.version} + 1`, updatedAt: sql`now()` }, 'Policy');
      return this.recorder.record(tx, tenantId, 'approval_policy', 'updated', row, { fields: Object.keys(input) });
    });
  }

  listPolicies(tenantId: string, companyId: string, type?: DocumentType): Promise<PolicyRow[]> {
    return this.uow.inTenant(tenantId, (tx) => tx.select().from(approvalPolicies).where(and(eq(approvalPolicies.tenantId, tenantId), eq(approvalPolicies.companyId, companyId), type ? eq(approvalPolicies.documentType, type) : undefined)).orderBy(asc(approvalPolicies.documentType), asc(approvalPolicies.thresholdAmount), asc(approvalPolicies.id)), { readOnly: true });
  }

  /** The tier that applies to an amount: the highest active threshold that the amount reaches, or none. */
  async policyFor(tx: Tx, tenantId: string, companyId: string, type: DocumentType, amount: string): Promise<PolicyRow | null> {
    const [row] = await tx.select().from(approvalPolicies).where(and(eq(approvalPolicies.tenantId, tenantId), eq(approvalPolicies.companyId, companyId), eq(approvalPolicies.documentType, type), eq(approvalPolicies.status, 'active'), lte(approvalPolicies.thresholdAmount, amount))).orderBy(desc(approvalPolicies.thresholdAmount)).limit(1);
    return row ?? null;
  }

  // ---- requests -------------------------------------------------------------------------------------------------------
  /** Asks for approval of exactly this command. The payload is validated with the real endpoint's rules and fixed by its hash. */
  createRequest(tenantId: string, userId: string, permissions: ReadonlySet<string>, input: CreateRequestInput): Promise<RequestRow> {
    const subject = subjectOf(input.documentType);
    if (!permissions.has('*') && !permissions.has(subject.permission)) throw new AppError(403, 'forbidden', `You need ${subject.permission} to ask for approval of a ${subject.label.toLowerCase()}`);
    const parsed = subject.schema.safeParse(input.payload);
    if (!parsed.success) throw validationFailed(parsed.error.issues.map((i) => ({ path: `payload.${i.path.map(String).join('.')}`, message: i.message })));
    if (subject.companyId(parsed.data) !== input.companyId) throw validationFailed([{ path: 'payload.companyId', message: 'Must be the same company as the request' }]);
    const amount = subject.amount(parsed.data);
    return this.uow.inTenant(tenantId, async (tx) => {
      await this.requireCompany(tx, tenantId, input.companyId);
      const policy = await this.policyFor(tx, tenantId, input.companyId, input.documentType, amount);
      if (!policy) throw new AppError(409, 'approval_not_required', `No approval policy applies to a ${subject.label.toLowerCase()} of ${amount}; go ahead without one`, { amount });
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`approval-no:${tenantId}`}, 0))`);
      const [count] = await tx.select({ n: sql<string>`COUNT(*)::text` }).from(approvalRequests).where(eq(approvalRequests.tenantId, tenantId));
      const requestNo = `APR-${String(Number(count?.n ?? '0') + 1).padStart(6, '0')}`;
      const row = first(await tx.insert(approvalRequests).values({
        tenantId, id: uuidv7(), companyId: input.companyId, requestNo, documentType: input.documentType, amount, summary: subject.summary(parsed.data), payload: parsed.data as Record<string, unknown>,
        payloadHash: hashOf(parsed.data), requiredApprovals: policy.requiredApprovals, validDays: policy.validDays, requestedBy: userId,
      }).returning(), 'Request');
      return this.recorder.record(tx, tenantId, 'approval_request', 'created', row, { requestNo, documentType: row.documentType, amount, requiredApprovals: row.requiredApprovals });
    });
  }

  async getRequest(tenantId: string, id: string): Promise<{ request: RequestRow; decisions: DecisionRow[] }> {
    return this.uow.inTenant(tenantId, async (tx) => {
      const request = first(await tx.select().from(approvalRequests).where(and(eq(approvalRequests.tenantId, tenantId), eq(approvalRequests.id, id))), 'Approval request');
      const decisions = await tx.select().from(approvalDecisions).where(and(eq(approvalDecisions.tenantId, tenantId), eq(approvalDecisions.requestId, id))).orderBy(asc(approvalDecisions.id));
      return { request, decisions };
    }, { readOnly: true });
  }

  listRequests(tenantId: string, userId: string, q: ListRequestsQuery) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const after = decodeCursor(q.cursor);
      const rows = await tx.select().from(approvalRequests).where(and(
        eq(approvalRequests.tenantId, tenantId), eq(approvalRequests.companyId, q.companyId),
        q.status ? eq(approvalRequests.status, q.status) : undefined, q.documentType ? eq(approvalRequests.documentType, q.documentType) : undefined,
        q.mine === 'true' ? eq(approvalRequests.requestedBy, userId) : undefined, after ? sql`${approvalRequests.id} > ${after}` : undefined,
      )).orderBy(asc(approvalRequests.id)).limit(q.limit + 1);
      return toPage(rows, q.limit);
    }, { readOnly: true });
  }

  approve(tenantId: string, userId: string, id: string, comment?: string): Promise<RequestRow> { return this.decide(tenantId, userId, id, 'approve', comment); }
  reject(tenantId: string, userId: string, id: string, comment: string): Promise<RequestRow> { return this.decide(tenantId, userId, id, 'reject', comment); }

  private decide(tenantId: string, userId: string, id: string, decision: 'approve' | 'reject', comment?: string): Promise<RequestRow> {
    return this.uow.inTenant(tenantId, async (tx) => {
      const request = await this.lock(tx, tenantId, id);
      if (request.status !== 'pending') throw new AppError(409, 'not_pending', `This request is already ${request.status}`);
      if (request.requestedBy === userId) throw new AppError(403, 'self_approval', 'You cannot decide a request you made yourself');
      const [seen] = await tx.select({ id: approvalDecisions.id }).from(approvalDecisions).where(and(eq(approvalDecisions.tenantId, tenantId), eq(approvalDecisions.requestId, id), eq(approvalDecisions.decidedBy, userId)));
      if (seen) throw new AppError(409, 'already_decided', 'You have already decided this request');
      await tx.insert(approvalDecisions).values({ tenantId, id: uuidv7(), requestId: id, decision, decidedBy: userId, comment: comment ?? null });
      let row: RequestRow;
      if (decision === 'reject') {
        row = first(await tx.update(approvalRequests).set({ status: 'rejected', decidedAt: sql`now()` }).where(and(eq(approvalRequests.tenantId, tenantId), eq(approvalRequests.id, id))).returning(), 'Approval request');
      } else {
        const count = request.approvalsCount + 1;
        const done = count >= request.requiredApprovals;
        row = first(await tx.update(approvalRequests).set(done
          ? { approvalsCount: count, status: 'approved', decidedAt: sql`now()`, validUntil: sql`now() + make_interval(days => ${request.validDays})` }
          : { approvalsCount: count }).where(and(eq(approvalRequests.tenantId, tenantId), eq(approvalRequests.id, id))).returning(), 'Approval request');
      }
      return this.recorder.record(tx, tenantId, 'approval_request', decision === 'approve' ? (row.status === 'approved' ? 'approved' : 'approval_given') : 'rejected', row, { requestNo: row.requestNo, by: userId, approvals: row.approvalsCount, required: row.requiredApprovals });
    });
  }

  cancel(tenantId: string, userId: string, permissions: ReadonlySet<string>, id: string, reason?: string): Promise<RequestRow> {
    return this.uow.inTenant(tenantId, async (tx) => {
      const request = await this.lock(tx, tenantId, id);
      if (request.requestedBy !== userId && !permissions.has('*') && !permissions.has('approvals:manage')) throw new AppError(403, 'forbidden', 'Only the requester, or someone who manages approvals, can cancel a request');
      if (request.status !== 'pending' && request.status !== 'approved') throw new AppError(409, 'not_cancellable', `A ${request.status} request cannot be cancelled`);
      const row = first(await tx.update(approvalRequests).set({ status: 'cancelled', decidedAt: sql`now()` }).where(and(eq(approvalRequests.tenantId, tenantId), eq(approvalRequests.id, id))).returning(), 'Approval request');
      return this.recorder.record(tx, tenantId, 'approval_request', 'cancelled', row, { requestNo: row.requestNo, reason: reason ?? null });
    });
  }

  // ---- enforcement (called inside the command's own transaction) ---------------------------------------------------------
  /**
   * The gate. If a policy applies to this command's amount, the caller must present an approved, unexpired, unused request for
   * exactly this payload; it is consumed here, in the same transaction, so a command that then fails gives the approval back.
   * Returns the consumed request id (to link the resulting document) or null when no policy applies.
   */
  async enforce(tx: Tx, claim: ApprovalClaim, type: DocumentType, input: unknown): Promise<string | null> {
    const subject = subjectOf(type);
    const companyId = subject.companyId(input);
    const amount = subject.amount(input);
    const policy = await this.policyFor(tx, claim.tenantId, companyId, type, amount);
    if (!policy) return null;
    const need = { documentType: type, amount, requiredApprovals: policy.requiredApprovals };
    if (!claim.approvalId) throw new AppError(409, 'approval_required', `A ${subject.label.toLowerCase()} of ${amount} needs approval: request it at POST /v1/approvals/requests, then send the approved request's id in the Approval-Id header`, need);
    if (!/^[0-9a-f-]{36}$/i.test(claim.approvalId)) throw new AppError(409, 'approval_invalid', 'Approval-Id is not a valid request id', need);
    const [request] = await tx.select().from(approvalRequests).where(and(eq(approvalRequests.tenantId, claim.tenantId), eq(approvalRequests.id, claim.approvalId))).for('update');
    const invalid = (reason: string): AppError => new AppError(409, 'approval_invalid', `This approval cannot be used: ${reason}`, { ...need, reason });
    if (!request || request.companyId !== companyId || request.documentType !== type) throw invalid('it is for a different company or document type');
    if (request.status === 'consumed') throw invalid('it has already been used');
    if (request.status !== 'approved') throw invalid(`it is ${request.status}`);
    if (request.validUntil && request.validUntil.getTime() <= Date.now()) throw invalid('it has expired; ask again');
    if (request.payloadHash !== hashOf(input)) throw invalid('the document differs from what was approved');
    if (request.requiredApprovals < policy.requiredApprovals) throw invalid(`the policy now needs ${policy.requiredApprovals} approvals`);
    await tx.update(approvalRequests).set({ status: 'consumed', consumedAt: sql`now()`, consumedBy: claim.userId }).where(and(eq(approvalRequests.tenantId, claim.tenantId), eq(approvalRequests.id, request.id)));
    return request.id;
  }

  /** Records which document an approval produced (once). */
  async link(tx: Tx, tenantId: string, requestId: string | null, refType: string, refId: string): Promise<void> {
    if (!requestId) return;
    await tx.update(approvalRequests).set({ consumedRefType: refType, consumedRefId: refId }).where(and(eq(approvalRequests.tenantId, tenantId), eq(approvalRequests.id, requestId)));
  }

  // ---- helpers ----------------------------------------------------------------------------------------------------------
  private async lock(tx: Tx, tenantId: string, id: string): Promise<RequestRow> {
    const [row] = await tx.select().from(approvalRequests).where(and(eq(approvalRequests.tenantId, tenantId), eq(approvalRequests.id, id))).for('update');
    if (!row) throw notFound('Approval request');
    return row;
  }
  private async requireCompany(tx: Tx, tenantId: string, companyId: string): Promise<void> {
    const [c] = await tx.select({ id: companies.id }).from(companies).where(and(eq(companies.tenantId, tenantId), eq(companies.id, companyId)));
    if (!c) throw validationFailed([{ path: 'companyId', message: 'This company does not exist' }]);
  }
}
