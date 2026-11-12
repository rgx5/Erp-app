import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
export { Public, PUBLIC_KEY } from '../../platform/http/public.js';
import { unauthorized } from '../../platform/http/errors.js';

export interface Principal {
  tenantId: string;
  kind: 'user' | 'api_key';
  /** The user (kind = user) or the user who created the key (kind = api_key). */
  userId: string;
  apiKeyId?: string;
  sessionId?: string;
  permissions: ReadonlySet<string>;
}

export const PERMISSIONS_KEY = 'auth:permissions';

/** Requires every listed permission. A route with neither this nor @Public() is refused: authorization fails closed. */
export const RequirePermissions = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);
/** Any signed-in principal, no particular permission (own profile, change own password). */
export const Authenticated = () => SetMetadata(PERMISSIONS_KEY, []);

export const CurrentPrincipal = createParamDecorator((_data: unknown, context: ExecutionContext): Principal => {
  const principal = context.switchToHttp().getRequest<{ principal?: Principal }>().principal;
  if (!principal) throw unauthorized();
  return principal;
});

/** The tenant of the authenticated principal. Never taken from client input. */
export const TenantId = createParamDecorator((_data: unknown, context: ExecutionContext): string => {
  const principal = context.switchToHttp().getRequest<{ principal?: Principal }>().principal;
  if (!principal) throw unauthorized();
  return principal.tenantId;
});
