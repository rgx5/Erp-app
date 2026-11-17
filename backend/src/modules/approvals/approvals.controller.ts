import { Body, Controller, Get, Headers, HttpCode, Inject, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AppError, preconditionRequired } from '../../platform/http/errors.js';
import { ApiZodBody } from '../../platform/http/validation.js';
import { Idempotent } from '../../platform/services/idempotency.js';
import { Authenticated, CurrentPrincipal, type Principal, RequirePermissions, TenantId } from '../identity/principal.js';
import { Recorder } from '../masterdata/helpers.js';
import * as s from './approvals.schemas.js';
import { ApprovalsService, type DecisionRow, type RequestRow } from './approvals.service.js';

const id = z.uuid();
const strip = <T extends object>(row: T): Omit<T, 'tenantId'> => {
  const { tenantId: _t, ...rest } = row as T & { tenantId?: string };
  return rest as Omit<T, 'tenantId'>;
};
const versionOf = (ifMatch: string | undefined): number => {
  if (!ifMatch) throw preconditionRequired('Send the version you read in the If-Match header');
  const version = Number(ifMatch.replaceAll('"', ''));
  if (!Number.isInteger(version) || version < 1) throw preconditionRequired('If-Match must be the integer version you read');
  return version;
};
/** `expired` is derived: an approved request past its validity can no longer be used. */
const presentRequest = (r: RequestRow, decisions?: DecisionRow[]) => ({
  ...strip(r),
  expired: r.status === 'approved' && r.validUntil !== null && r.validUntil.getTime() <= Date.now(),
  ...(decisions ? { decisions: decisions.map(strip) } : {}),
});
const canSee = (a: Principal): boolean => a.permissions.has('*') || a.permissions.has('approvals:read');

@ApiTags('approvals')
@ApiBearerAuth()
@Controller('v1')
export class ApprovalsController {
  constructor(@Inject(ApprovalsService) private readonly approvals: ApprovalsService) {}

  // ---- policies -------------------------------------------------------------------------------------------------------
  @RequirePermissions('approvals:manage') @Idempotent() @Post('approval-policies') @ApiZodBody(s.createPolicySchema)
  async createPolicy(@CurrentPrincipal() a: Principal, @Body({ schema: s.createPolicySchema }) b: s.CreatePolicyInput) { return strip(await this.approvals.createPolicy(a.tenantId, a.userId, b)); }
  @RequirePermissions('approvals:read') @Get('approval-policies')
  async listPolicies(@TenantId() t: string, @Query({ schema: s.listPoliciesQuery }) q: { companyId: string; documentType?: s.CreateRequestInput['documentType'] }) { return { items: (await this.approvals.listPolicies(t, q.companyId, q.documentType)).map(strip) }; }
  @RequirePermissions('approvals:manage') @Patch('approval-policies/:id') @ApiZodBody(s.updatePolicySchema)
  async updatePolicy(@TenantId() t: string, @Param('id', { schema: id }) i: string, @Headers('if-match') m: string | undefined, @Body({ schema: s.updatePolicySchema }) b: s.UpdatePolicyInput) { return strip(await this.approvals.updatePolicy(t, i, versionOf(m), b)); }

  // ---- requests -------------------------------------------------------------------------------------------------------
  /** Asks for approval of exactly the command you are about to run. Any signed-in user may ask for what they could do themselves. */
  @Authenticated() @Idempotent() @Post('approvals/requests') @ApiZodBody(s.createRequestSchema)
  async createRequest(@CurrentPrincipal() a: Principal, @Body({ schema: s.createRequestSchema }) b: s.CreateRequestInput) { return presentRequest(await this.approvals.createRequest(a.tenantId, a.userId, a.permissions, b)); }
  /** Approvers see everything; anyone else sees only the requests they made. */
  @Authenticated() @Get('approvals/requests')
  async listRequests(@CurrentPrincipal() a: Principal, @Query({ schema: s.listRequestsQuery }) q: s.ListRequestsQuery) {
    const p = await this.approvals.listRequests(a.tenantId, a.userId, canSee(a) ? q : { ...q, mine: 'true' });
    return { items: p.items.map((r) => presentRequest(r)), nextCursor: p.nextCursor };
  }
  @Authenticated() @Get('approvals/requests/:id')
  async getRequest(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string) {
    const r = await this.approvals.getRequest(a.tenantId, i);
    if (!canSee(a) && r.request.requestedBy !== a.userId) throw new AppError(404, 'not_found', 'Approval request not found');
    return presentRequest(r.request, r.decisions);
  }
  @RequirePermissions('approvals:decide') @Idempotent() @Post('approvals/requests/:id/approve') @HttpCode(200) @ApiZodBody(s.decisionSchema)
  async approve(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Body({ schema: s.decisionSchema }) b: { comment?: string }) { return presentRequest(await this.approvals.approve(a.tenantId, a.userId, i, b.comment)); }
  @RequirePermissions('approvals:decide') @Idempotent() @Post('approvals/requests/:id/reject') @HttpCode(200) @ApiZodBody(s.rejectSchema)
  async reject(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Body({ schema: s.rejectSchema }) b: { comment: string }) { return presentRequest(await this.approvals.reject(a.tenantId, a.userId, i, b.comment)); }
  @Authenticated() @Idempotent() @Post('approvals/requests/:id/cancel') @HttpCode(200) @ApiZodBody(s.cancelSchema)
  async cancel(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Body({ schema: s.cancelSchema }) b: { reason?: string }) { return presentRequest(await this.approvals.cancel(a.tenantId, a.userId, a.permissions, i, b.reason)); }
}

@Module({ controllers: [ApprovalsController], providers: [Recorder, ApprovalsService], exports: [ApprovalsService] })
export class ApprovalsModule {}
