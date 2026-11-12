import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { AuthGuard } from './auth.guard.js';
import { Authenticated, Public, RequirePermissions, type Principal } from './principal.js';
import type { PrincipalService } from './principal.service.js';

const principal = (permissions: string[]): Principal => ({ tenantId: 't', kind: 'user', userId: 'u', permissions: new Set(permissions) });
const guard = (p: Principal) =>
  new AuthGuard(new Reflector(), { fromAccessToken: async () => p, fromApiKey: async () => p } as unknown as PrincipalService);

function context(handler: object, authorization?: string) {
  const request: { headers: Record<string, string>; principal?: Principal } = { headers: authorization ? { authorization } : {} };
  return {
    request,
    ctx: { getType: () => 'http', getHandler: () => handler, getClass: () => class {}, switchToHttp: () => ({ getRequest: () => request }) } as never,
  };
}
const route = (...decorators: MethodDecorator[]) => {
  const handler = () => 1;
  const descriptor = { value: handler } as PropertyDescriptor;
  for (const decorate of decorators) decorate({}, 'm', descriptor);
  return handler;
};
const TOKEN = 'Bearer ' + 'x'.repeat(40);

describe('AuthGuard fails closed', () => {
  it('lets a @Public route through without a credential', async () => {
    const { ctx } = context(route(Public()));
    await expect(guard(principal([])).canActivate(ctx)).resolves.toBe(true);
  });
  it('refuses a route that declares nothing, even for a fully privileged principal', async () => {
    const { ctx } = context(route(), TOKEN);
    await expect(guard(principal(['*'])).canActivate(ctx)).rejects.toMatchObject({ status: 403 });
  });
  it('requires a bearer credential', async () => {
    for (const header of [undefined, 'Basic abc', 'Bearer short']) {
      await expect(guard(principal(['*'])).canActivate(context(route(Authenticated()), header).ctx)).rejects.toMatchObject({ status: 401 });
    }
  });
  it('enforces the declared permissions, and the wildcard satisfies any', async () => {
    const need = route(RequirePermissions('users:write'));
    await expect(guard(principal(['users:read'])).canActivate(context(need, TOKEN).ctx)).rejects.toMatchObject({ status: 403 });
    await expect(guard(principal(['users:write'])).canActivate(context(need, TOKEN).ctx)).resolves.toBe(true);
    await expect(guard(principal(['*'])).canActivate(context(need, TOKEN).ctx)).resolves.toBe(true);
  });
  it('attaches the principal and tenant to the request', async () => {
    const { ctx, request } = context(route(Authenticated()), TOKEN);
    await guard(principal([])).canActivate(ctx);
    expect(request.principal?.tenantId).toBe('t');
  });
});
