import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  requestId: string;
  ip?: string | undefined;
  /** Set once authentication has run. */
  actor?: { type: 'user' | 'api_key'; id: string } | undefined;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Per-request facts (request id, caller) available anywhere below the interceptor without being passed down. */
export const requestContext = {
  run: <T>(context: RequestContext, work: () => T): T => storage.run(context, work),
  get: (): RequestContext | undefined => storage.getStore(),
};
