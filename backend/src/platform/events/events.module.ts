import { type CallHandler, Controller, type ExecutionContext, Global, Inject, Injectable, type MessageEvent, Module, type NestInterceptor, Sse } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { Authenticated, TenantId } from '../../modules/identity/principal.js';
import { ChangeBus } from './change-bus.js';

const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** `/v1/sales/invoices/…` → `sales`; `/v1/items` → `items`. */
export const areaOf = (path: string): string | undefined => /^\/v1\/([a-z0-9-]+)/.exec(path)?.[1];

/** After a write succeeds, says which area of the client's data changed. */
@Injectable()
export class ChangePublisher implements NestInterceptor {
  constructor(@Inject(ChangeBus) private readonly bus: ChangeBus) {}
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<{ method?: string; tenantId?: string; url?: string; raw?: { url?: string } }>();
    if (!req.tenantId || !WRITE.has(req.method ?? '')) return next.handle();
    const area = areaOf((req.url ?? req.raw?.url ?? '').split('?')[0] as string);
    return area && area !== 'auth' ? next.handle().pipe(tap({ complete: () => this.bus.publish(req.tenantId as string, [area]) })) : next.handle();
  }
}

/** A stream of "something changed" notes for the signed-in client, so open screens refresh themselves. Carries area names only, never data. */
@Controller('v1')
export class EventsController {
  constructor(@Inject(ChangeBus) private readonly bus: ChangeBus) {}

  @Authenticated() @Sse('events')
  stream(@TenantId() tenantId: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((out) => {
      let pending = new Set<string>(); let timer: NodeJS.Timeout | undefined;
      const flush = (): void => { timer = undefined; const areas = [...pending]; pending = new Set(); out.next({ data: { areas, at: Date.now() } }); };
      out.next({ data: { areas: [], hello: true, at: Date.now() } });
      const off = this.bus.subscribe(tenantId, (areas) => { for (const a of areas) pending.add(a); timer ??= setTimeout(flush, 400); });
      const beat = setInterval(() => out.next({ type: 'ping', data: '' }), 25_000);
      return () => { off(); clearInterval(beat); if (timer) clearTimeout(timer); };
    });
  }
}

@Global()
@Module({ controllers: [EventsController], providers: [ChangeBus, ChangePublisher, { provide: APP_INTERCEPTOR, useExisting: ChangePublisher }], exports: [ChangeBus] })
export class EventsModule {}
