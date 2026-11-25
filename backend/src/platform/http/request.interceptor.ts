import { CallHandler, ExecutionContext, Inject, Injectable, type NestInterceptor } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { Logger } from 'pino';
import { Observable, tap } from 'rxjs';
import { MetricsService } from '../metrics/metrics.service.js';
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
    @Inject(MetricsService) private readonly metrics: MetricsService,
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
      routeOptions?: { url?: string };
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
    const record = (failure?: unknown): void => {
      const code = failure ? ((failure as { status?: number }).status ?? 500) : response.statusCode;
      const seconds = Number(process.hrtime.bigint() - started) / 1e9;
      const labels = { method: request.method, route: request.routeOptions?.url ?? 'unmatched', status: `${Math.floor((code || 500) / 100)}xx` };
      this.metrics.inc('erp_http_requests_total', 'Requests served', labels);
      this.metrics.observe('erp_http_request_seconds', 'Request duration', labels, seconds);
    };
    return handled.pipe(
      tap({ error: (e: unknown) => record(e) }),
      tap(() => {
        record();
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
