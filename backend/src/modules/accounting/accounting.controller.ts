import { Body, Controller, Get, Headers, HttpCode, Inject, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { preconditionRequired } from '../../platform/http/errors.js';
import { ApiZodBody } from '../../platform/http/validation.js';
import { Idempotent } from '../../platform/services/idempotency.js';
import { CurrentPrincipal, type Principal, RequirePermissions, TenantId } from '../identity/principal.js';
import { Recorder } from '../masterdata/helpers.js';
import * as s from './accounting.schemas.js';
import { AccountsService } from './accounts.service.js';
import { PeriodsService } from './periods.service.js';
import { PostingService, type EntryRow, type LineRow } from './posting.service.js';

const id = z.uuid();
const out = <T extends { tenantId: string }>(row: T): Omit<T, 'tenantId'> => {
  const { tenantId: _t, ...rest } = row;
  return rest;
};
const versionOf = (ifMatch: string | undefined): number => {
  if (!ifMatch) throw preconditionRequired('Send the version you read in the If-Match header');
  const version = Number(ifMatch.replaceAll('"', ''));
  if (!Number.isInteger(version) || version < 1) throw preconditionRequired('If-Match must be the integer version you read');
  return version;
};
const presentEntry = (entry: EntryRow, lines: LineRow[], extra: object = {}) => ({
  ...out(entry),
  txId: undefined,
  lines: lines.map((l) => ({ ...out(l), txId: undefined, entryId: undefined, companyId: undefined })),
  ...extra,
});

@ApiTags('accounting')
@ApiBearerAuth()
@Controller('v1')
export class AccountingController {
  constructor(
    @Inject(AccountsService) private readonly accounts: AccountsService,
    @Inject(PeriodsService) private readonly periods: PeriodsService,
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
  ) {}

  // ---- chart of accounts ------------------------------------------------------------------------------------------
  @RequirePermissions('accounting:manage') @Idempotent() @Post('accounts') @ApiZodBody(s.createAccountSchema)
  async createAccount(@TenantId() t: string, @Body({ schema: s.createAccountSchema }) b: s.CreateAccountInput) { return out(await this.accounts.create(t, b)); }
  @RequirePermissions('accounting:read') @Get('accounts')
  async listAccounts(@TenantId() t: string, @Query({ schema: s.listAccountsQuery }) q: s.ListAccountsQuery) { const p = await this.accounts.list(t, q); return { items: p.items.map(out), nextCursor: p.nextCursor }; }
  @RequirePermissions('accounting:read') @Get('accounts/:id')
  async getAccount(@TenantId() t: string, @Param('id', { schema: id }) i: string) { return out(await this.accounts.get(t, i)); }
  @RequirePermissions('accounting:manage') @Patch('accounts/:id') @ApiZodBody(s.updateAccountSchema)
  async updateAccount(@TenantId() t: string, @Param('id', { schema: id }) i: string, @Headers('if-match') m: string | undefined, @Body({ schema: s.updateAccountSchema }) b: s.UpdateAccountInput) { return out(await this.accounts.update(t, i, versionOf(m), b)); }
  /** Opt-in: seeds a starter chart for manufacturing into a company with no accounts. */
  @RequirePermissions('accounting:manage') @Post('companies/:companyId/chart-of-accounts/template') @ApiZodBody(s.applyTemplateSchema)
  applyTemplate(@TenantId() t: string, @Param('companyId', { schema: id }) c: string, @Body({ schema: s.applyTemplateSchema }) _b: { template: 'manufacturing_india' }) { return this.accounts.applyTemplate(t, c); }

  // ---- fiscal years and periods -----------------------------------------------------------------------------------
  @RequirePermissions('accounting:manage') @Idempotent() @Post('fiscal-years') @ApiZodBody(s.createFiscalYearSchema)
  async createFiscalYear(@TenantId() t: string, @Body({ schema: s.createFiscalYearSchema }) b: s.CreateFiscalYearInput) {
    const { fiscalYear, periods } = await this.periods.createFiscalYear(t, b);
    return { ...out(fiscalYear), periods: periods.map(out) };
  }
  @RequirePermissions('accounting:read') @Get('fiscal-years')
  async listFiscalYears(@TenantId() t: string, @Query({ schema: s.companyQuery }) q: { companyId: string }) {
    return { items: (await this.periods.list(t, q.companyId)).map(({ fiscalYear, periods }) => ({ ...out(fiscalYear), periods: periods.map(out) })) };
  }
  @RequirePermissions('accounting:manage') @Post('accounting-periods/:id/close') @HttpCode(200)
  async closePeriod(@TenantId() t: string, @Param('id', { schema: id }) i: string) { return out(await this.periods.close(t, i)); }
  @RequirePermissions('accounting:reopen') @Post('accounting-periods/:id/reopen') @HttpCode(200)
  async reopenPeriod(@TenantId() t: string, @Param('id', { schema: id }) i: string) { return out(await this.periods.reopen(t, i)); }
  /** Permanent. */
  @RequirePermissions('accounting:manage') @Post('accounting-periods/:id/lock') @HttpCode(200)
  async lockPeriod(@TenantId() t: string, @Param('id', { schema: id }) i: string) { return out(await this.periods.lock(t, i)); }

  // ---- journal --------------------------------------------------------------------------------------------------
  /** Manual journal. Control accounts (receivables, payables, stock, GST ...) are refused: only subledgers post there. */
  @RequirePermissions('accounting:post') @Idempotent() @Post('journal-entries') @ApiZodBody(s.postJournalSchema)
  async post(@CurrentPrincipal() a: Principal, @Body({ schema: s.postJournalSchema }) b: s.PostJournalInput) {
    const { entry, lines } = await this.uow.inTenant(a.tenantId, (tx) => this.posting.post(tx, a.tenantId, { ...b, source: { type: 'manual' }, postedBy: a.userId }));
    return presentEntry(entry, lines);
  }
  @RequirePermissions('accounting:read') @Get('journal-entries')
  async list(@TenantId() t: string, @Query({ schema: s.listEntriesQuery }) q: s.ListEntriesQuery) { const p = await this.posting.listEntries(t, q); return { items: p.items.map((e) => ({ ...out(e), txId: undefined })), nextCursor: p.nextCursor }; }
  @RequirePermissions('accounting:read') @Get('journal-entries/:id')
  async get(@TenantId() t: string, @Param('id', { schema: id }) i: string) { const r = await this.posting.getEntry(t, i); return presentEntry(r.entry, r.lines, { reversedBy: r.reversedBy }); }
  /** Posts the mirror-image entry. The original is never changed. */
  @RequirePermissions('accounting:reverse') @Idempotent() @Post('journal-entries/:id/reverse') @ApiZodBody(s.reverseSchema)
  async reverse(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Body({ schema: s.reverseSchema }) b: { postingDate: string; reason: string }) {
    const { entry, lines } = await this.uow.inTenant(a.tenantId, (tx) => this.posting.reverse(tx, a.tenantId, i, { ...b, postedBy: a.userId }));
    return presentEntry(entry, lines);
  }

  // ---- reports --------------------------------------------------------------------------------------------------
  @RequirePermissions('accounting:read') @Get('accounting/trial-balance')
  trialBalance(@TenantId() t: string, @Query({ schema: s.trialBalanceQuery }) q: { companyId: string; from: string; to: string }) { return this.posting.trialBalance(t, q.companyId, q.from, q.to); }
  @RequirePermissions('accounting:read') @Get('accounting/account-ledger')
  accountLedger(@TenantId() t: string, @Query({ schema: s.ledgerQuery }) q: { companyId: string; accountId: string; from: string; to: string; limit: number }) { return this.posting.accountLedger(t, q.companyId, q.accountId, q.from, q.to, q.limit); }
}

@Module({
  controllers: [AccountingController],
  providers: [Recorder, AccountsService, PeriodsService, PostingService],
  exports: [AccountsService, PeriodsService, PostingService],
})
export class AccountingModule {}
