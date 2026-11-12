import { CallHandler, ExecutionContext, Inject, Injectable, type NestInterceptor } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { Logger } from 'pino';
import { Observable, tap } from 'rxjs';
import { ENV, type Env } from '../../config/env.js';
import { LOGGER } from '../logging/logger.js';
import { applySecurityHeaders, ensureRequestId } from './http-support.js';
import { requestContext } from './request-context.js';

/** Request id, security headers and one structured access-log line per request. */
@Injectable()
export class RequestInterceptor implements NestInterceptor {
  constructor(
    @Inject(HttpAdapterHost) private readonly host: HttpAdapterHost,
    @Inject(ENV) private readonly env: Env,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const adapter = this.host.httpAdapter;
    const http = context.switchToHttp();
    const request = http.getRequest<{
      headers: Record<string, string>;
      method: string;
      requestId?: string;
      tenantId?: string;
      ip?: string;
      socket?: { remoteAddress?: string };
      principal?: { kind: 'user' | 'api_key'; userId: string; apiKeyId?: string };
    }>();
    const response = http.getResponse<{ statusCode: number }>();
    const requestId = ensureRequestId(request, response, adapter);
    applySecurityHeaders(adapter, response, this.env);
    const started = process.hrtime.bigint();
    const principal = request.principal;
    const requestCtx = {
      requestId,
      ip: request.ip ?? request.socket?.remoteAddress,
      actor: principal ? { type: principal.kind, id: principal.kind === 'api_key' ? (principal.apiKeyId ?? principal.userId) : principal.userId } : undefined,
    };
    // The handler runs inside this context, so audit entries and events can pick up the request id and caller.
    const handled = new Observable<unknown>((subscriber) => requestContext.run(requestCtx, () => next.handle().subscribe(subscriber)));
    return handled.pipe(
      tap(() => {
        this.logger.info(
          {
            requestId,
            tenantId: request.tenantId,
            method: request.method,
            path: adapter.getRequestUrl(request)?.split('?')[0],
            status: response.statusCode,
            durationMs: Number(process.hrtime.bigint() - started) / 1e6,
          },
          'request completed',
        );
      }),
    );
  }
}
