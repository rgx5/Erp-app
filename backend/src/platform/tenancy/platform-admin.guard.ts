import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { ENV, type Env } from '../../config/env.js';
import { forbidden, notFound } from '../http/errors.js';

interface PlatformRequest {
  headers: Record<string, string | string[] | undefined>;
}

/** Guards the platform operator endpoints with a static bearer token. Disabled (404) unless PLATFORM_ADMIN_TOKEN is set. */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  private readonly expected: Buffer | undefined;

  constructor(@Inject(ENV) env: Env) {
    this.expected = env.PLATFORM_ADMIN_TOKEN ? sha256(env.PLATFORM_ADMIN_TOKEN) : undefined;
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.expected) throw notFound('This endpoint');
    const header = context.switchToHttp().getRequest<PlatformRequest>().headers['authorization'];
    const presented = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
    // Compare fixed-length digests so neither the length nor the content of the token leaks through timing.
    if (!timingSafeEqual(sha256(presented), this.expected)) throw forbidden('Invalid platform credentials');
    return true;
  }
}

const sha256 = (value: string): Buffer => createHash('sha256').update(value).digest();
