import { type CallHandler, type ExecutionContext, HttpStatus, Inject, Injectable, type NestInterceptor, SetMetadata } from '@nestjs/common';
import { HttpAdapterHost, Reflector } from '@nestjs/core';
import { and, eq, sql } from 'drizzle-orm';
import { createHash, timingSafeEqual } from 'node:crypto';
import { from, lastValueFrom, map, type Observable } from 'rxjs';
import { ENV, type Env } from '../../config/env.js';
import { UnitOfWork } from '../database/unit-of-work.js';
import { AppError, preconditionRequired } from '../http/errors.js';
import { idempotencyKeys } from './platform.schema.js';

export const IDEMPOTENT_KEY = 'http:idempotent';
const KEY_FORMAT = /^[A-Za-z0-9._:-]{1,255}$/;

/**
 * Makes a POST safe to retry. The client sends `Idempotency-Key: <unique string>`; a retry with the same key and the same
 * request returns the original response (header `Idempotent-Replayed: true`) without doing the work again. The same key with
 * a different request (or by a different caller) is refused with 422. `required: true` makes the header mandatory.
 */
export const Idempotent = (options: { required?: boolean } = {}) => SetMetadata(IDEMPOTENT_KEY, { required: options.required ?? false });

const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : v,
  );

interface IdemRequest {
  headers: Record<string, string | string[] | undefined>;
  method: string;
  url?: string;
  body?: unknown;
  principal?: { tenantId: string; userId: string; apiKeyId?: string };
}

/**
 * Claim, work and stored response share ONE transaction (the unit of work joins nested calls), so there is no "in progress"
 * state that can get stuck: a concurrent duplicate waits on the unique key and then replays; a failed request rolls the claim
 * back and can be retried; a crash leaves nothing behind.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(HttpAdapterHost) private readonly host: HttpAdapterHost,
    @Inject(ENV) private readonly env: Env,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.getAllAndOverride<{ required: boolean } | undefined>(IDEMPOTENT_KEY, [context.getHandler(), context.getClass()]);
    if (!options) return next.handle();
    const http = context.switchToHttp();
    const request = http.getRequest<IdemRequest>();
    const response = http.getResponse<unknown>();
    const header = request.headers['idempotency-key'];
    if (header === undefined) {
      if (options.required) throw preconditionRequired('This request needs an Idempotency-Key header');
      return next.handle();
    }
    const principal = request.principal;
    if (typeof header !== 'string' || !KEY_FORMAT.test(header)) throw new AppError(422, 'invalid_idempotency_key', 'Idempotency-Key must be 1-255 characters of letters, digits, . _ : -');
    if (!principal) return next.handle(); // unauthenticated routes have no tenant to scope a key to

    const fingerprint = createHash('sha256')
      .update(stable({ method: request.method, url: request.url, actor: principal.apiKeyId ?? principal.userId, body: request.body ?? null }))
      .digest();
    const adapter = this.host.httpAdapter;
    // Nest applies the route's status (201 for POST, or @HttpCode) after interception, for fresh and replayed responses alike.
    const successStatus = this.reflector.get<number | undefined>('__httpCode__', context.getHandler()) ?? (request.method === 'POST' ? HttpStatus.CREATED : HttpStatus.OK);

    return from(
      this.uow.inTenant(principal.tenantId, async (tx) => {
        const claimed = await tx
          .insert(idempotencyKeys)
          .values({ tenantId: principal.tenantId, key: header, fingerprint, actorId: principal.userId, expiresAt: new Date(Date.now() + this.env.IDEMPOTENCY_TTL_SECONDS * 1000) })
          .onConflictDoUpdate({
            target: [idempotencyKeys.tenantId, idempotencyKeys.key],
            set: { fingerprint, actorId: principal.userId, responseStatus: null, responseBody: null, createdAt: sql`now()`, expiresAt: new Date(Date.now() + this.env.IDEMPOTENCY_TTL_SECONDS * 1000) },
            setWhere: sql`${idempotencyKeys.expiresAt} <= now()`, // an expired key may be reused
          })
          .returning({ key: idempotencyKeys.key });
        if (claimed.length === 0) {
          // A committed, unexpired key exists (if another request held it, the insert above waited for it to finish).
          const [existing] = await tx.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.tenantId, principal.tenantId), eq(idempotencyKeys.key, header)));
          if (!existing || existing.fingerprint.length !== fingerprint.length || !timingSafeEqual(existing.fingerprint, fingerprint)) {
            throw new AppError(422, 'idempotency_key_reused', 'This Idempotency-Key was already used for a different request');
          }
          adapter.setHeader(response, 'Idempotent-Replayed', 'true');
          return { replayed: true as const, body: existing.responseBody };
        }
        const body: unknown = await lastValueFrom(next.handle(), { defaultValue: null });
        await tx
          .update(idempotencyKeys)
          .set({ responseStatus: successStatus, responseBody: (body ?? null) as never })
          .where(and(eq(idempotencyKeys.tenantId, principal.tenantId), eq(idempotencyKeys.key, header)));
        return { replayed: false as const, body };
      }),
    ).pipe(map((result) => result.body));
  }
}
