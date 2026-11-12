import { type CanActivate, createParamDecorator, type ExecutionContext, Injectable } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Inject } from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';
import { forbidden, notFound, unauthorized } from '../http/errors.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface TenantRequest {
  headers: Record<string, string | string[] | undefined>;
  tenantId?: string;
}

/**
 * SLICE 0 ONLY. Takes the tenant from the X-Tenant-Id header, which is NOT authentication: any client can claim any
 * tenant. It exists so the tenancy foundation can be exercised end to end. The identity slice replaces it with a tenant
 * derived from a verified credential, and configuration refuses to start in production with it enabled.
 */
@Injectable()
export class DevHeaderTenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<TenantRequest>();
    const header = request.headers['x-tenant-id'];
    if (typeof header !== 'string' || header === '') throw unauthorized('The X-Tenant-Id header is required');
    if (!UUID.test(header)) throw unauthorized('The X-Tenant-Id header is not a valid tenant id');
    request.tenantId = header.toLowerCase();
    return true;
  }
}

export const TenantId = createParamDecorator((_data: unknown, context: ExecutionContext): string => {
  const tenantId = context.switchToHttp().getRequest<TenantRequest>().tenantId;
  if (!tenantId) throw unauthorized();
  return tenantId;
});

/** Guards the platform operator endpoints with a static bearer token. Disabled (404) unless PLATFORM_ADMIN_TOKEN is set. */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  private readonly expected: Buffer | undefined;

  constructor(@Inject(ENV) env: Env) {
    this.expected = env.PLATFORM_ADMIN_TOKEN ? sha256(env.PLATFORM_ADMIN_TOKEN) : undefined;
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.expected) throw notFound('This endpoint');
    const header = context.switchToHttp().getRequest<TenantRequest>().headers['authorization'];
    const presented = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
    // Compare fixed-length digests so neither the length nor the content of the token leaks through timing.
    if (!timingSafeEqual(sha256(presented), this.expected)) throw forbidden('Invalid platform credentials');
    return true;
  }
}

const sha256 = (value: string): Buffer => createHash('sha256').update(value).digest();
