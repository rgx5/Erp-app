import { Body, Controller, Get, Headers, HttpCode, Inject, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { preconditionRequired } from '../../platform/http/errors.js';
import { ApiZodBody } from '../../platform/http/validation.js';
import { Idempotent } from '../../platform/services/idempotency.js';
import { AccountingModule } from '../accounting/accounting.controller.js';
import { CurrentPrincipal, type Principal, RequirePermissions, TenantId } from '../identity/principal.js';
import { Recorder } from '../masterdata/helpers.js';
import { BankService } from './bank.service.js';
import * as s from './banking.schemas.js';
import { RequiresModule } from '../identity/entitlements.js';

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
const lineView = (r: { line: object; matches: object[] }) => ({ ...strip(r.line), matches: r.matches.map(strip) });

@ApiTags('banking')
@ApiBearerAuth()
@RequiresModule('banking')
@Controller('v1')
export class BankingController {
  constructor(@Inject(BankService) private readonly bank: BankService) {}

  // ---- bank accounts --------------------------------------------------------------------------------------------------
  @RequirePermissions('bank:manage') @Idempotent() @Post('bank-accounts') @ApiZodBody(s.createBankAccountSchema)
  async createAccount(@CurrentPrincipal() a: Principal, @Body({ schema: s.createBankAccountSchema }) b: s.CreateBankAccountInput) { return strip(await this.bank.createAccount(a.tenantId, a.userId, b)); }
  @RequirePermissions('bank:read') @Get('bank-accounts')
  async listAccounts(@TenantId() t: string, @Query({ schema: s.listBankAccountsQuery }) q: { companyId: string }) { return { items: (await this.bank.listAccounts(t, q.companyId)).map(strip) }; }
  @RequirePermissions('bank:manage') @Patch('bank-accounts/:id') @ApiZodBody(s.updateBankAccountSchema)
  async updateAccount(@TenantId() t: string, @Param('id', { schema: id }) i: string, @Headers('if-match') m: string | undefined, @Body({ schema: s.updateBankAccountSchema }) b: s.UpdateBankAccountInput) { return strip(await this.bank.updateAccount(t, i, versionOf(m), b)); }

  // ---- statements -----------------------------------------------------------------------------------------------------
  /** Imports one statement (balances and lines as the bank shows them). Re-sending the same content is refused, not duplicated. */
  @RequirePermissions('bank:manage') @Idempotent() @Post('bank-accounts/:id/statements') @ApiZodBody(s.importStatementSchema)
  async importStatement(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Body({ schema: s.importStatementSchema }) b: s.ImportStatementInput) {
    const r = await this.bank.importStatement(a.tenantId, a.userId, i, b);
    return { ...strip(r.statement), lines: r.lines.map(strip), continuity: r.continuity };
  }
  @RequirePermissions('bank:read') @Get('bank-accounts/:id/statements')
  async listStatements(@TenantId() t: string, @Param('id', { schema: id }) i: string, @Query({ schema: s.listStatementsQuery }) q: { limit: number; cursor?: string }) { const p = await this.bank.listStatements(t, i, q.limit, q.cursor); return { items: p.items.map(strip), nextCursor: p.nextCursor }; }
  @RequirePermissions('bank:read') @Get('bank-statements/:id')
  async getStatement(@TenantId() t: string, @Param('id', { schema: id }) i: string) { const r = await this.bank.getStatement(t, i); return { ...strip(r.statement), lines: r.lines.map(strip), matched: r.matched, ignored: r.ignored, unmatched: r.unmatched }; }
  @RequirePermissions('bank:manage') @Idempotent() @Post('bank-statements/:id/void') @HttpCode(200) @ApiZodBody(s.voidStatementSchema)
  async voidStatement(@TenantId() t: string, @Param('id', { schema: id }) i: string, @Body({ schema: s.voidStatementSchema }) b: { reason: string }) { return strip(await this.bank.voidStatement(t, i, b.reason)); }
  @RequirePermissions('bank:read') @Get('bank-accounts/:id/statement-lines')
  async listLines(@TenantId() t: string, @Param('id', { schema: id }) i: string, @Query({ schema: s.listLinesQuery }) q: Omit<s.ListLinesQuery, 'bankAccountId'>) { const p = await this.bank.listLines(t, { ...q, bankAccountId: i }); return { items: p.items.map(strip), nextCursor: p.nextCursor }; }

  // ---- matching -------------------------------------------------------------------------------------------------------
  @RequirePermissions('bank:read') @Get('bank-statement-lines/:id')
  async getLine(@TenantId() t: string, @Param('id', { schema: id }) i: string) { return lineView(await this.bank.getLine(t, i)); }
  /** Ledger lines that could be this bank item: the same amount near the date (`scope=any` shows every open line nearby, for combined matches). */
  @RequirePermissions('bank:read') @Get('bank-statement-lines/:id/candidates')
  async candidates(@TenantId() t: string, @Param('id', { schema: id }) i: string, @Query({ schema: s.candidatesQuery }) q: { days: number; scope: 'exact' | 'any' }) { return { items: await this.bank.candidates(t, i, q.days, q.scope) }; }
  @RequirePermissions('bank:reconcile') @Idempotent() @Post('bank-statement-lines/:id/match') @HttpCode(200) @ApiZodBody(s.matchSchema)
  async match(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Body({ schema: s.matchSchema }) b: { journalLineIds: string[] }) { return lineView(await this.bank.match(a.tenantId, a.userId, i, b.journalLineIds)); }
  @RequirePermissions('bank:reconcile') @Idempotent() @Post('bank-statement-lines/:id/unmatch') @HttpCode(200) @ApiZodBody(s.unmatchSchema)
  async unmatch(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Body({ schema: s.unmatchSchema }) b: { reason: string }) { return lineView(await this.bank.unmatch(a.tenantId, a.userId, i, b.reason)); }
  @RequirePermissions('bank:reconcile') @Idempotent() @Post('bank-statement-lines/:id/ignore') @HttpCode(200) @ApiZodBody(s.ignoreSchema)
  async ignore(@TenantId() t: string, @Param('id', { schema: id }) i: string, @Body({ schema: s.ignoreSchema }) b: { reason: string }) { return lineView(await this.bank.ignore(t, i, b.reason)); }
  @RequirePermissions('bank:reconcile') @Idempotent() @Post('bank-statement-lines/:id/unignore') @HttpCode(200)
  async unignore(@TenantId() t: string, @Param('id', { schema: id }) i: string) { return lineView(await this.bank.unignore(t, i)); }
  /** Posts a journal for a bank item the books do not have (charges, interest) and matches it. Needs the right to post journals too. */
  @RequirePermissions('bank:reconcile', 'accounting:post') @Idempotent() @Post('bank-statement-lines/:id/book') @ApiZodBody(s.bookSchema)
  async book(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Body({ schema: s.bookSchema }) b: { accountId: string; description?: string }) { const r = await this.bank.book(a.tenantId, a.userId, i, b); return { ...lineView(r), entry: r.entry }; }
  @RequirePermissions('bank:reconcile') @Idempotent() @Post('bank-accounts/:id/auto-match') @HttpCode(200) @ApiZodBody(s.autoMatchSchema)
  autoMatch(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Body({ schema: s.autoMatchSchema }) b: { statementId?: string; days: number }) { return this.bank.autoMatch(a.tenantId, a.userId, i, b); }

  @RequirePermissions('bank:read') @Get('bank-accounts/:id/reconciliation')
  reconciliation(@TenantId() t: string, @Param('id', { schema: id }) i: string, @Query({ schema: s.reconciliationQuery }) q: { asOf: string }) { return this.bank.reconciliation(t, i, q.asOf); }
}

@Module({ imports: [AccountingModule], controllers: [BankingController], providers: [Recorder, BankService], exports: [BankService] })
export class BankingModule {}
