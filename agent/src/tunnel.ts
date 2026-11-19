import { writeFileSync } from 'node:fs';
import WebSocket from 'ws';

/** Frames between gateway and site, as JSON text. A request is one frame; a response is a head, then chunks, then an end (or an error). */
export type Frame =
  | { t: 'req'; id: string; method: string; path: string; headers: Record<string, string>; body?: string }
  | { t: 'res'; id: string; status: number; headers: Record<string, string> }
  | { t: 'chunk'; id: string; data: string }
  | { t: 'end'; id: string }
  | { t: 'err'; id: string; message: string };

const HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length']);
/** What may go through the tunnel. The platform administration routes are never reachable remotely, whatever the gateway sends. */
export function allowedPath(path: string): boolean {
  if (path.length > 4000 || !path.startsWith('/')) return false;
  const clean = path.split('?')[0]?.toLowerCase() ?? '';
  if (clean.includes('..') || clean.includes('//') || clean.includes('%2e') || clean.includes('%2f')) return false;
  if (clean === '/health/live') return true;
  return clean.startsWith('/v1/') && !clean.startsWith('/v1/platform');
}

export interface TunnelOptions {
  gatewayUrl: string; token: string; localApiUrl: string; statusFile?: string;
  maxConcurrent?: number; requestTimeoutMs?: number; chunkBytes?: number; log?: (m: string) => void;
  /** Reconnect waits (ms): the first, and the longest. */
  backoff?: { min: number; max: number };
  /** How long to wait before reconnecting after the gateway says a newer tunnel replaced this one. */
  replacedWaitMs?: number;
}

/**
 * The site's end of the remote-access tunnel. It dials the gateway (outbound only), then answers the gateway's requests by calling the local
 * application and streaming the reply back. It reconnects by itself, and records whether it is up for the heartbeat.
 */
export class Tunnel {
  private ws: WebSocket | null = null; private stopped = false; private attempt = 0; private inflight = new Set<string>(); private timer: NodeJS.Timeout | null = null;
  private since: string | null = null; private lastError: string | null = null;
  constructor(private readonly o: TunnelOptions) {}
  get up(): boolean { return this.ws?.readyState === WebSocket.OPEN; }
  private log(m: string): void { (this.o.log ?? ((x) => console.log(x)))(`tunnel: ${m}`); }
  private status(): void { if (this.o.statusFile) try { writeFileSync(this.o.statusFile, JSON.stringify({ up: this.up, since: this.since, lastError: this.lastError })); } catch { /* the status is best effort */ } }

  start(): void { this.stopped = false; this.connect(); }
  stop(): void { this.stopped = true; if (this.timer) clearTimeout(this.timer); this.ws?.close(); this.ws = null; this.status(); }

  private connect(): void {
    if (this.stopped) return;
    const ws = new WebSocket(`${this.o.gatewayUrl.replace(/^http/, 'ws').replace(/\/$/, '')}/tunnel`, { headers: { authorization: `Bearer ${this.o.token}` }, handshakeTimeout: 15_000, maxPayload: 32 * 1024 * 1024 });
    this.ws = ws;
    ws.on('open', () => { this.attempt = 0; this.since = new Date().toISOString(); this.lastError = null; this.log('connected'); this.status(); });
    ws.on('message', (raw) => { try { void this.onFrame(JSON.parse(raw.toString()) as Frame); } catch { /* ignore garbage */ } });
    ws.on('unexpected-response', (_req, res) => { this.lastError = `gateway refused the tunnel (${res.statusCode})`; });
    ws.on('error', (e) => { this.lastError = e.message; });
    ws.on('close', (code) => { this.since = null; this.status(); this.log(`closed${this.lastError ? ` (${this.lastError})` : ''}`); this.ws = null; if (!this.stopped) this.schedule(code === 4000); });
  }
  /** `replaced`: the gateway has a newer tunnel for this site (another agent instance), so wait a long while rather than fight it for the address. */
  private schedule(replaced = false): void {
    const { min, max } = this.o.backoff ?? { min: 1000, max: 60_000 };
    const wait = replaced ? (this.o.replacedWaitMs ?? 60_000) : Math.min(max, min * 2 ** Math.min(this.attempt++, 10)) * (0.75 + Math.random() * 0.5);
    this.timer = setTimeout(() => this.connect(), wait);
  }
  private send(f: Frame): void { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(f)); }

  private async onFrame(f: Frame): Promise<void> {
    if (f.t !== 'req') return;
    if (this.inflight.size >= (this.o.maxConcurrent ?? 32)) return this.send({ t: 'err', id: f.id, message: 'busy' });
    if (!allowedPath(f.path) || !/^[A-Z]{3,7}$/.test(f.method)) return this.send({ t: 'err', id: f.id, message: 'path_not_allowed' });
    this.inflight.add(f.id);
    try {
      const headers = Object.fromEntries(Object.entries(f.headers).filter(([k]) => !HOP.has(k.toLowerCase())));
      const hasBody = f.body !== undefined && f.method !== 'GET' && f.method !== 'HEAD';
      const res = await fetch(`${this.o.localApiUrl}${f.path}`, { method: f.method, headers, ...(hasBody ? { body: Buffer.from(f.body as string, 'base64') } : {}), redirect: 'manual', signal: AbortSignal.timeout(this.o.requestTimeoutMs ?? 60_000) });
      this.send({ t: 'res', id: f.id, status: res.status, headers: Object.fromEntries([...res.headers.entries()].filter(([k]) => !HOP.has(k.toLowerCase()))) });
      if (res.body) { const reader = res.body.getReader(); for (;;) { const { done, value } = await reader.read(); if (done) break; for (let i = 0; i < value.length; i += this.o.chunkBytes ?? 64 * 1024) this.send({ t: 'chunk', id: f.id, data: Buffer.from(value.subarray(i, i + (this.o.chunkBytes ?? 64 * 1024))).toString('base64') }); } }
      this.send({ t: 'end', id: f.id });
    } catch (e) { this.send({ t: 'err', id: f.id, message: e instanceof Error && e.name === 'TimeoutError' ? 'timeout' : 'local_unavailable' }); }
    finally { this.inflight.delete(f.id); }
  }
}
