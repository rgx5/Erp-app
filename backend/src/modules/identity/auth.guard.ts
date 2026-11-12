import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { forbidden, unauthorized } from '../../platform/http/errors.js';
import { allows } from './permissions.js';
import { PUBLIC_KEY } from '../../platform/http/public.js';
import { PERMISSIONS_KEY, type Principal } from './principal.js';
import { PrincipalService } from './principal.service.js';

interface AuthRequest {
  headers: Record<string, string | string[] | undefined>;
  principal?: Principal;
  tenantId?: string;
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
    const principal = token.startsWith('ek_') ? await this.principals.fromApiKey(token) : await this.principals.fromAccessToken(token);
    request.principal = principal;
    request.tenantId = principal.tenantId; // for request logging

    const required = this.reflector.getAllAndOverride<string[] | undefined>(PERMISSIONS_KEY, targets);
    if (required === undefined) throw forbidden('This route does not declare its required permissions');
    if (!allows(principal.permissions, required)) throw forbidden();
    return true;
  }
}
