import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError, forbidden, unauthorized } from '../../platform/http/errors.js';
import { entitled, MODULE_KEY, writesBlocked } from './entitlements.js';
import { allows } from './permissions.js';
import { PUBLIC_KEY } from '../../platform/http/public.js';
import { PERMISSIONS_KEY, type Principal } from './principal.js';
import { PrincipalService } from './principal.service.js';

interface AuthRequest {
  headers: Record<string, string | string[] | undefined>;
  principal?: Principal;
  tenantId?: string;
  method?: string;
  url?: string;
}

/**
 * Registered globally. Every route needs a verified credential unless it is marked @Public(), and every authenticated route
 * must declare what it requires (@RequirePermissions or @Authenticated): a route that declares nothing is refused.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(PrincipalService) private readonly principals: PrincipalService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const request = context.switchToHttp().getRequest<AuthRequest>();
    const header = request.headers['authorization'];
    if (typeof header !== 'string' || !header.startsWith('Bearer ') || header.length < 15) throw unauthorized();
    const token = header.slice(7).trim();
    const principal = await this.principals.resolve(token);
    request.principal = principal;
    request.tenantId = principal.tenantId; // for request logging

    const required = this.reflector.getAllAndOverride<string[] | undefined>(PERMISSIONS_KEY, targets);
    if (required === undefined) throw forbidden('This route does not declare its required permissions');
    if (!allows(principal.permissions, required)) throw forbidden();

    // The licence: a route of a module the tenant has not licensed is refused, and a suspended or long-expired tenant may read but not write.
    const modules = this.reflector.getAllAndOverride<string[] | undefined>(MODULE_KEY, targets);
    if (modules && modules.length > 0 && !entitled(principal.entitlements, modules)) {
      throw new AppError(403, 'module_not_licensed', `Your plan does not include ${modules.join(' or ')}. Ask your administrator to add it.`, { modules });
    }
    const method = (request.method ?? 'GET').toUpperCase();
    const mutating = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
    const blocked = mutating && !(request.url ?? '').startsWith('/v1/auth/') ? writesBlocked(principal.entitlements) : undefined;
    if (blocked) throw new AppError(403, 'tenant_read_only', blocked === 'expired' ? 'The licence has expired: the system is read-only until it is renewed. You can still view and export your data.' : 'This account is suspended: the system is read-only. You can still view and export your data.', { reason: blocked });
    return true;
  }
}
