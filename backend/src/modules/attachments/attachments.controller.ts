import { Body, Controller, Delete, Get, HttpCode, Inject, Module, Param, Post, Query, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AppError } from '../../platform/http/errors.js';
import { ApiZodBody } from '../../platform/http/validation.js';
import { allows } from '../identity/permissions.js';
import { Authenticated, CurrentPrincipal, type Principal } from '../identity/principal.js';
import { Recorder } from '../masterdata/helpers.js';
import { AttachmentsService, CONTENT_TYPES, ENTITIES, ENTITY_TYPES, type EntityType } from './attachments.service.js';

const addSchema = z.strictObject({
  entityType: z.enum(ENTITY_TYPES), entityId: z.uuid(), kind: z.enum(['file', 'photo']).default('file'),
  filename: z.string().trim().min(1).max(200), contentType: z.enum(CONTENT_TYPES), dataBase64: z.string().min(4).regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Base64 data'),
});
const listQuery = z.object({ entityType: z.enum(ENTITY_TYPES), entityId: z.uuid() });
const id = z.uuid();

const need = (p: Principal, type: EntityType, mode: 'read' | 'write'): void => {
  if (!allows(p.permissions, [ENTITIES[type][mode]])) throw new AppError(403, 'forbidden', 'You do not have permission to do that');
};

@ApiTags('attachments')
@ApiBearerAuth()
@Controller('v1/attachments')
export class AttachmentsController {
  constructor(@Inject(AttachmentsService) private readonly files: AttachmentsService) {}

  /** Attaches a photo or a file (JPEG, PNG, WebP or PDF, up to 6 MB) to a record. A new photo replaces the old one. */
  @Authenticated() @Post() @ApiZodBody(addSchema)
  add(@CurrentPrincipal() a: Principal, @Body({ schema: addSchema }) b: z.infer<typeof addSchema>) { need(a, b.entityType, 'write'); return this.files.add(a.tenantId, a.userId, b); }

  @Authenticated() @Get()
  async list(@CurrentPrincipal() a: Principal, @Query({ schema: listQuery }) q: z.infer<typeof listQuery>) { need(a, q.entityType, 'read'); return { items: await this.files.list(a.tenantId, q.entityType, q.entityId) }; }

  /** The file itself. Needs the same sign-in as everything else, so it is fetched by the app, not opened as a plain link. */
  @Authenticated() @Get(':id/content')
  async content(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string) {
    const f = await this.files.content(a.tenantId, i);
    need(a, f.entityType, 'read');
    return new StreamableFile(f.data, { type: f.contentType, disposition: `inline; filename="${encodeURIComponent(f.filename)}"`, length: f.data.length });
  }

  @Authenticated() @Delete(':id') @HttpCode(200)
  async remove(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string) { need(a, await this.files.typeOf(a.tenantId, i), 'write'); await this.files.remove(a.tenantId, i); return { ok: true }; }
}

@Module({ controllers: [AttachmentsController], providers: [AttachmentsService, Recorder] })
export class AttachmentsModule {}
