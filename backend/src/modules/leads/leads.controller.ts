import { Body, Controller, Delete, Get, Header, HttpCode, Inject, Module, Options, Param, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiZodBody } from '../../platform/http/validation.js';
import { Public } from '../../platform/http/public.js';
import { RequiresModule } from '../identity/entitlements.js';
import { IdentityModule } from '../identity/identity.module.js';
import { CurrentPrincipal, type Principal, RequirePermissions, TenantId } from '../identity/principal.js';
import { allows } from '../identity/permissions.js';
import { Authenticated } from '../identity/principal.js';
import { AppError } from '../../platform/http/errors.js';
import { Recorder } from '../masterdata/helpers.js';
import { ConnectorsService } from './connectors.service.js';
import { IngestService } from './ingest.service.js';
import { LeadsReportsService } from './leads-reports.service.js';
import { LeadsService, type Scope } from './leads.service.js';
import { SOURCES } from './leads.logic.js';

/** Everyone's leads for someone who may read them all, otherwise only their own and their territory's. */
const scopeOf = (a: Principal): Scope => { if (allows(a.permissions, ['leads:read_all'])) return undefined; if (allows(a.permissions, ['leads:read'])) return { userId: a.userId }; throw new AppError(403, 'forbidden', 'You do not have permission to do that'); };
const id = z.uuid();
const text = (n: number) => z.string().trim().max(n);
const opt = (n: number) => z.string().trim().max(n).nullish().transform((v) => v ?? undefined);
const day = z.iso.date();

const createSchema = z.strictObject({
  name: text(200).min(1), phone: opt(30), email: opt(254), city: opt(100), pincode: opt(12), state: opt(100), source: z.enum(SOURCES).default('manual'), campaign: opt(200), interest: opt(200),
  valueEstimate: z.string().regex(/^\d{1,14}(\.\d{1,2})?$/).nullish().transform((v) => v ?? undefined), fields: z.record(z.string().max(60), z.string().max(500)).optional(), consent: z.boolean().optional(), ownerId: z.uuid().nullish().transform((v) => v ?? undefined), allowDuplicate: z.boolean().default(false),
}).refine((v) => Boolean(v.phone || v.email), { path: ['phone'], message: 'Give a phone number or an email' });
const updateSchema = z.strictObject({ name: text(200).min(1).optional(), phone: opt(30), email: opt(254), city: opt(100), pincode: opt(12), state: opt(100), interest: opt(200), valueEstimate: z.string().regex(/^\d{1,14}(\.\d{1,2})?$/).nullable().optional(), fields: z.record(z.string().max(60), z.string().max(500)).optional(), consent: z.boolean().optional() });
const listQuery = z.object({
  status: z.enum(['open', 'won', 'lost']).optional(), stageId: id.optional(), ownerId: id.optional(), unassigned: z.enum(['true', 'false']).transform((v) => v === 'true').optional(), source: z.enum(SOURCES).optional(), campaign: text(100).optional(), q: text(80).optional(),
  overdue: z.enum(['true', 'false']).transform((v) => v === 'true').optional(), followUpDue: z.enum(['true', 'false']).transform((v) => v === 'true').optional(), from: day.optional(), to: day.optional(), limit: z.coerce.number().int().min(1).max(500).default(200), cursor: z.string().optional(),
});
const stageSchema = z.strictObject({ stageId: id, lostReason: text(200).optional() });
const assignSchema = z.strictObject({ ownerId: id.nullable() });
const activitySchema = z.strictObject({ kind: z.enum(['note', 'call', 'whatsapp', 'email', 'visit', 'survey', 'task']), body: text(2000).min(1), dueAt: z.iso.datetime({ offset: true }).optional() });
const linkSchema = z.strictObject({ partyId: id });
const mergeSchema = z.strictObject({ intoId: id });
const settingsSchema = z.strictObject({
  assignmentMode: z.enum(['manual', 'round_robin']), members: z.array(id).max(200), slaMinutes: z.number().int().min(1).max(10080), lostReasons: z.array(text(100).min(1)).min(1).max(30),
  territories: z.array(z.strictObject({ users: z.array(id).min(1).max(100), cities: z.array(text(100)).max(50).optional(), pincodePrefix: z.array(text(12)).max(50).optional() })).max(50).default([]),
  rules: z.array(z.strictObject({ match: z.strictObject({ city: z.array(text(100)).max(50).optional(), pincodePrefix: z.array(text(12)).max(50).optional(), source: z.array(z.enum(SOURCES)).max(20).optional(), campaign: z.array(text(100)).max(50).optional() }).optional(), users: z.array(id).min(1).max(100) })).max(50),
});
const stagesSchema = z.strictObject({ stages: z.array(z.strictObject({ id: id.optional(), name: text(60).min(1), kind: z.enum(['open', 'won', 'lost']) })).min(3).max(15) });
const connectorSchema = z.strictObject({ kind: z.enum(['website', 'meta', 'google', 'webhook']), name: text(100).min(1), allowedDomains: z.array(text(200)).max(20).optional(), pageId: text(40).optional(), formIds: z.array(text(40)).max(50).optional(), pageAccessToken: text(1000).optional(), appSecret: text(200).optional(), defaultCampaign: text(200).optional() });
const connectorPatch = z.strictObject({ name: text(100).min(1).optional(), status: z.enum(['active', 'paused']).optional(), allowedDomains: z.array(text(200)).max(20).optional(), pageId: text(40).optional(), formIds: z.array(text(40)).max(50).optional(), pageAccessToken: text(1000).optional(), defaultCampaign: text(200).optional() });
const rangeQuery = z.object({ from: day, to: day }).refine((q) => q.from <= q.to, { message: 'The start date is after the end date' });
const spendSchema = z.strictObject({ rows: z.array(z.strictObject({ date: day, source: z.enum(SOURCES), campaign: text(200).optional(), amount: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, 'An amount such as 2500 or 2500.50'), impressions: z.number().int().min(0).optional(), clicks: z.number().int().min(0).optional(), note: text(200).optional() })).min(1).max(500) });

@ApiTags('leads')
@ApiBearerAuth()
@RequiresModule('leads')
@Controller('v1/leads')
export class LeadsController {
  constructor(@Inject(LeadsService) private readonly leads: LeadsService, @Inject(ConnectorsService) private readonly connectors: ConnectorsService, @Inject(IngestService) private readonly ingest: IngestService, @Inject(LeadsReportsService) private readonly reports: LeadsReportsService) {}

  @Authenticated() @Get()
  list(@CurrentPrincipal() a: Principal, @Query({ schema: listQuery }) q: z.infer<typeof listQuery>) { return this.leads.list(a.tenantId, q, scopeOf(a)); }
  @Authenticated() @Get('counts')
  counts(@CurrentPrincipal() a: Principal) { return this.leads.counts(a.tenantId, scopeOf(a)); }

  @RequirePermissions('leads:read') @Get('settings')
  settings(@TenantId() t: string) { return this.leads.getSettings(t); }
  @RequirePermissions('leads:manage') @Put('settings') @ApiZodBody(settingsSchema)
  putSettings(@TenantId() t: string, @Body({ schema: settingsSchema }) b: z.infer<typeof settingsSchema>) { return this.leads.putSettings(t, b); }
  @RequirePermissions('leads:manage') @Put('stages') @ApiZodBody(stagesSchema)
  putStages(@TenantId() t: string, @Body({ schema: stagesSchema }) b: z.infer<typeof stagesSchema>) { return this.leads.saveStages(t, b.stages).then((stages) => ({ stages })); }

  @RequirePermissions('leads:manage') @Get('connectors')
  async connectorList(@TenantId() t: string) { return { items: await this.connectors.list(t) }; }
  @RequirePermissions('leads:manage') @Post('connectors') @ApiZodBody(connectorSchema)
  connectorCreate(@CurrentPrincipal() a: Principal, @Body({ schema: connectorSchema }) b: z.infer<typeof connectorSchema>) { return this.connectors.create(a.tenantId, a.userId, b); }
  @RequirePermissions('leads:manage') @Patch('connectors/:id') @ApiZodBody(connectorPatch)
  connectorUpdate(@TenantId() t: string, @Param('id', { schema: id }) i: string, @Body({ schema: connectorPatch }) b: z.infer<typeof connectorPatch>) { return this.connectors.update(t, i, b); }
  @RequirePermissions('leads:manage') @Delete('connectors/:id') @HttpCode(200)
  connectorDelete(@TenantId() t: string, @Param('id', { schema: id }) i: string) { return this.connectors.remove(t, i); }
  @RequirePermissions('leads:manage') @Get('connectors/:id/deliveries')
  async deliveries(@TenantId() t: string, @Param('id', { schema: id }) i: string) { return { items: await this.connectors.deliveries(t, i) }; }
  /** Sends a sample enquiry through the connector's real path. It makes an actual lead named "Test lead". */
  @RequirePermissions('leads:manage') @Post('connectors/:id/test') @HttpCode(200)
  connectorTest(@TenantId() t: string, @Param('id', { schema: id }) i: string) { return this.ingest.test(t, i); }

  @RequirePermissions('leads:read_all') @Get('reports/summary')
  summary(@TenantId() t: string, @Query({ schema: rangeQuery }) q: z.infer<typeof rangeQuery>) { return this.reports.summary(t, q.from, q.to); }
  @RequirePermissions('leads:read_all') @Get('ad-spend')
  async spend(@TenantId() t: string, @Query({ schema: rangeQuery }) q: z.infer<typeof rangeQuery>) { return { items: await this.reports.listSpend(t, q.from, q.to) }; }
  @RequirePermissions('leads:manage') @Post('ad-spend') @HttpCode(200) @ApiZodBody(spendSchema)
  saveSpend(@CurrentPrincipal() a: Principal, @Body({ schema: spendSchema }) b: z.infer<typeof spendSchema>) { return this.reports.saveSpend(a.tenantId, a.userId, b.rows); }
  @RequirePermissions('leads:manage') @Delete('ad-spend/:id') @HttpCode(200)
  removeSpend(@TenantId() t: string, @Param('id', { schema: id }) i: string) { return this.reports.removeSpend(t, i); }

  @RequirePermissions('leads:write') @Post() @ApiZodBody(createSchema)
  create(@CurrentPrincipal() a: Principal, @Body({ schema: createSchema }) b: z.infer<typeof createSchema>) { const { allowDuplicate, ...input } = b; return this.leads.createManual(a.tenantId, a.userId, input, allowDuplicate); }
  @Authenticated() @Get(':id')
  get(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string) { return this.leads.get(a.tenantId, i, scopeOf(a)); }
  @RequirePermissions('leads:write') @Patch(':id') @ApiZodBody(updateSchema)
  update(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Body({ schema: updateSchema }) b: z.infer<typeof updateSchema>) { return this.leads.update(a.tenantId, a.userId, i, b, scopeOf(a)); }
  @RequirePermissions('leads:write') @Post(':id/stage') @HttpCode(200) @ApiZodBody(stageSchema)
  stage(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Body({ schema: stageSchema }) b: z.infer<typeof stageSchema>) { return this.leads.setStage(a.tenantId, a.userId, i, b, scopeOf(a)); }
  @RequirePermissions('leads:write') @Post(':id/assign') @HttpCode(200) @ApiZodBody(assignSchema)
  assign(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Body({ schema: assignSchema }) b: z.infer<typeof assignSchema>) { return this.leads.assign(a.tenantId, a.userId, i, b.ownerId, scopeOf(a)); }
  @RequirePermissions('leads:write') @Post(':id/activities') @ApiZodBody(activitySchema)
  activity(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Body({ schema: activitySchema }) b: z.infer<typeof activitySchema>) { return this.leads.addActivity(a.tenantId, a.userId, i, b, scopeOf(a)); }
  @RequirePermissions('leads:write') @Post(':id/activities/:activityId/done') @HttpCode(200)
  done(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Param('activityId', { schema: id }) act: string) { return this.leads.completeTask(a.tenantId, a.userId, i, act, scopeOf(a)); }
  @RequirePermissions('leads:write') @Post(':id/link-customer') @HttpCode(200) @ApiZodBody(linkSchema)
  link(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Body({ schema: linkSchema }) b: z.infer<typeof linkSchema>) { return this.leads.linkParty(a.tenantId, a.userId, i, b.partyId, scopeOf(a)); }
  @RequirePermissions('leads:manage') @Post(':id/merge') @HttpCode(200) @ApiZodBody(mergeSchema)
  merge(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Body({ schema: mergeSchema }) b: z.infer<typeof mergeSchema>) { return this.leads.merge(a.tenantId, a.userId, i, b.intoId); }
}

interface Req { body?: unknown; rawBody?: Buffer | string; headers: Record<string, string | string[] | undefined>; query?: Record<string, string | undefined> }
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
interface Res { header?: (n: string, v: string) => unknown; setHeader?: (n: string, v: string) => unknown }
const cors = (res: Res): void => { (res.header ?? res.setHeader)?.call(res, 'Access-Control-Allow-Origin', '*'); };

/** The public doors: no sign-in, each address belongs to one lead source of one business and carries its own checks. */
@ApiTags('lead-intake')
@Controller('v1/ingest')
export class IngestController {
  constructor(@Inject(IngestService) private readonly ingest: IngestService) {}

  /** A website form or any system that can POST JSON or form fields. */
  @Public() @Post('website/:key') @HttpCode(200)
  website(@Param('key') key: string, @Req() req: Req, @Res({ passthrough: true }) res: Res) { cors(res); return this.ingest.website(key, req.body, { origin: one(req.headers['origin']), referer: one(req.headers['referer']) }); }
  @Public() @Options('website/:key') @HttpCode(204)
  preflight(@Res({ passthrough: true }) res: Res) { cors(res); (res.header ?? res.setHeader)?.call(res, 'Access-Control-Allow-Headers', 'Content-Type'); (res.header ?? res.setHeader)?.call(res, 'Access-Control-Allow-Methods', 'POST, OPTIONS'); }

  @Public() @Post('google/:key') @HttpCode(200)
  google(@Param('key') key: string, @Req() req: Req) { return this.ingest.google(key, req.body); }

  /** Meta asks once, when the webhook is set up, that this address answers with the challenge it sends. */
  @Public() @Get('meta/:key') @Header('Content-Type', 'text/plain')
  metaVerify(@Param('key') key: string, @Query() q: Record<string, string | undefined>) { return this.ingest.metaVerify(key, { ...(q['hub.mode'] ? { mode: q['hub.mode'] } : {}), ...(q['hub.verify_token'] ? { token: q['hub.verify_token'] } : {}), ...(q['hub.challenge'] ? { challenge: q['hub.challenge'] } : {}) }); }
  @Public() @Post('meta/:key') @HttpCode(200)
  meta(@Param('key') key: string, @Req() req: Req) {
    const raw = req.rawBody ? (typeof req.rawBody === 'string' ? req.rawBody : req.rawBody.toString('utf8')) : JSON.stringify(req.body ?? {});
    return this.ingest.meta(key, raw, one(req.headers['x-hub-signature-256']), req.body);
  }
}

@Module({ imports: [IdentityModule], controllers: [LeadsController, IngestController], providers: [LeadsService, ConnectorsService, IngestService, LeadsReportsService, Recorder], exports: [LeadsService] })
export class LeadsModule {}
