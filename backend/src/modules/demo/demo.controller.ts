import { Body, Controller, HttpCode, Inject, Module, Post, Req, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { z } from 'zod';
import { ENV, type Env } from '../../config/env.js';
import { AppError } from '../../platform/http/errors.js';
import { notFound } from '../../platform/http/errors.js';
import { PlatformAdminGuard } from '../../platform/tenancy/platform-admin.guard.js';
import { Public } from '../identity/principal.js';

const bodySchema = z.strictObject({ slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/).optional(), password: z.string().min(12).max(200).optional(), email: z.email().optional(), name: z.string().trim().min(2).max(100).optional() }).default({});
type SeedModule = { seedDemo(o: Record<string, unknown>): Promise<{ created: boolean; steps: string[]; login: unknown; invoices?: number }> };

/**
 * Fills a demo server with sample data over HTTP. Off (404) unless DEMO_SEED_ENABLED=true, and then only for the platform token. It uses the
 * server's own API (through its local socket, so it works behind a proxy that blocks the platform routes), so the data is real postings.
 * Never enable it on a server that holds real businesses.
 */
@ApiExcludeController()
@Controller('v1/demo')
@Public()
@UseGuards(PlatformAdminGuard)
export class DemoController {
  private running = false;
  constructor(@Inject(ENV) private readonly env: Env) {}

  @Post('seed')
  @HttpCode(200)
  async seed(@Body({ schema: bodySchema }) body: z.infer<typeof bodySchema>, @Req() req: { raw?: { socket?: { localPort?: number } }; socket?: { localPort?: number } }) {
    if (!this.env.DEMO_SEED_ENABLED) throw notFound('This endpoint');
    if (this.running) throw new AppError(409, 'seed_running', 'A demo seed is already running');
    const port = req.raw?.socket?.localPort ?? req.socket?.localPort ?? this.env.PORT;
    this.running = true;
    try {
      const file = path.resolve(process.cwd(), 'scripts/seed-demo.mjs');
      const mod = (await import(pathToFileURL(file).href)) as SeedModule;
      return await mod.seedDemo({ base: `http://127.0.0.1:${port}`, platformToken: this.env.PLATFORM_ADMIN_TOKEN, ...body });
    } finally { this.running = false; }
  }
}

@Module({ controllers: [DemoController] })
export class DemoModule {}
