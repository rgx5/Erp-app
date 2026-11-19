import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import Fastify, { type FastifyInstance } from 'fastify';
import { WebSocketServer, type WebSocket } from 'ws';
import { check, readRules, type Rules } from './rules.js';

type Frame =
  | { t: 'req'; id: string; method: string; path: string; headers: Record<string, string>; body?: string }
  | { t: 'res'; id: string; status: number; headers: Record<string, string> }
  | { t: 'chunk'; id: string; data: string }
  | { t: 'end'; id: string }
  | { t: 'err'; id: string; message: string };

export interface Verdict { siteId: string; hostname: string; tier: string; /** The client's remote-access rules as stored by the control plane (see rules.ts). Missing means no extra limits. */ rules?: unknown }
export interface GatewayOptions {
  /** Asks the control plane whether this site token may hold a tunnel. Resolves null when refused; rejects when the control plane cannot be reached. */
  verify(token: string): Promise<Verdict | null>;
  /** How many reverse proxies sit in front of the gateway (default 1: the hosting panel's Traefik). Only the address that the nearest trusted proxy saw is believed; anything a visitor put to its left in X-Forwarded-For is ignored. Use 2 behind a CDN plus Traefik. */
  trustedProxyHops?: number;
  maxBodyBytes?: number; maxInflightPerSite?: number; requestsPerSecond?: number; recheckSeconds?: number; requestTimeoutMs?: number; pingSeconds?: number;
  log?: (m: string) => void;
}

interface Session { ws: WebSocket; verdict: Verdict; rules: Rules | null; token: string; connectedAt: Date; lastPong: number; pending: Map<string, Pending>; tokens: number; refilled: number }
interface Pending { onHead: (status: number, headers: Record<string, string>) => void; onChunk: (b: Buffer) => void; onEnd: () => void; onErr: (m: string) => void }

const REQ_DROP = new Set(['connection', 'keep-alive', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip']);
/** Only the product's own API, its owner dashboard page and the liveness probe go through. The platform administration routes never do. */
export function routable(path: string): boolean {
  const clean = path.split('?')[0]?.toLowerCase() ?? '';
  if (path.length > 4000 || !path.startsWith('/') || clean.includes('..') || clean.includes('//') || clean.includes('%2e') || clean.includes('%2f') || clean.includes('\\')) return false;
  return clean === '/health/live' || clean === '/owner' || (clean.startsWith('/v1/') && !clean.startsWith('/v1/platform'));
}

/**
 * The gateway: a site connects out to `/tunnel` with its token; remote users' HTTP requests for that site's address are carried to the site
 * through that tunnel and the reply is carried back. The gateway stores no business data and decides nothing about who may sign in: the site's
 * own server does that.
 */
export function buildGateway(o: GatewayOptions): { app: FastifyInstance; sessions: Map<string, Session>; close(): Promise<void>; recheck(): Promise<void> } {
  const log = o.log ?? (() => undefined);
  const maxBody = o.maxBodyBytes ?? 8 * 1024 * 1024; const maxInflight = o.maxInflightPerSite ?? 32; const rps = o.requestsPerSecond ?? 50;
  const sessions = new Map<string, Session>(); // by host name
  const app = Fastify({ logger: false, bodyLimit: maxBody, trustProxy: ((_address: string, hop: number) => hop < (o.trustedProxyHops ?? 1)) });
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

  const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024 });
  app.server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/tunnel') { socket.destroy(); return; }
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '').trim();
    void (async () => {
      let v: Verdict | null = null;
      try { v = await o.verify(token); } catch { socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
      if (!v) { socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
      wss.handleUpgrade(req, socket, head, (ws) => attach(ws, token, v as Verdict));
    })();
  });

  function attach(ws: WebSocket, token: string, verdict: Verdict): void {
    const host = verdict.hostname.toLowerCase();
    sessions.get(host)?.ws.close(4000, 'replaced by a newer tunnel'); // one tunnel per site: the newest wins
    const s: Session = { ws, verdict, rules: readRules(verdict.rules), token, connectedAt: new Date(), lastPong: Date.now(), pending: new Map(), tokens: rps, refilled: Date.now() };
    sessions.set(host, s);
    log(`tunnel up: ${host}`);
    ws.on('pong', () => { s.lastPong = Date.now(); });
    ws.on('message', (raw) => {
      let f: Frame; try { f = JSON.parse(raw.toString()) as Frame; } catch { return; }
      const p = s.pending.get(f.id); if (!p) return;
      if (f.t === 'res') p.onHead(f.status, f.headers);
      else if (f.t === 'chunk') p.onChunk(Buffer.from(f.data, 'base64'));
      else if (f.t === 'end') { s.pending.delete(f.id); p.onEnd(); }
      else if (f.t === 'err') { s.pending.delete(f.id); p.onErr(f.message); }
    });
    ws.on('close', () => { for (const p of s.pending.values()) p.onErr('tunnel_closed'); s.pending.clear(); if (sessions.get(host) === s) sessions.delete(host); log(`tunnel down: ${host}`); });
  }

  const pinger = setInterval(() => { for (const s of sessions.values()) { if (Date.now() - s.lastPong > (o.pingSeconds ?? 20) * 3000) s.ws.terminate(); else s.ws.ping(); } }, (o.pingSeconds ?? 20) * 1000);
  pinger.unref();
  /** Closes the tunnel of any site the control plane no longer allows. An unreachable control plane never drops anyone. */
  async function recheck(): Promise<void> {
    for (const [host, s] of [...sessions]) {
      try { const v = await o.verify(s.token); if (!v || v.hostname.toLowerCase() !== host) s.ws.close(4001, 'not allowed any more'); else { s.verdict = v; s.rules = readRules(v.rules); } } catch { /* control plane unreachable: keep the tunnel */ }
    }
  }
  const rechecker = setInterval(() => void recheck(), (o.recheckSeconds ?? 60) * 1000); rechecker.unref();

  app.get('/__gateway/health', async () => ({ ok: true, tunnels: sessions.size }));
  app.all('/*', async (req, reply) => {
    const host = (req.headers.host ?? '').split(':')[0]?.toLowerCase() ?? '';
    const s = sessions.get(host);
    if (!s) return reply.status(503).header('retry-after', '30').send({ code: 'site_offline', message: 'This business\'s server is not connected right now. Try again in a moment, or contact the office.' });
    if (!routable(req.url)) return reply.status(404).send({ code: 'not_found', message: 'Not found' });
    if (!s.rules) return reply.status(403).send({ code: 'remote_rules_invalid', message: 'Remote access for this business is paused while its settings are checked. Contact the office.' });
    const refusal = check(s.rules, { method: req.method, path: req.url, ip: req.ip, at: new Date() });
    if (refusal) return reply.status(refusal.status).send({ code: refusal.code, message: refusal.message });
    const limit = Math.min(rps, s.rules.requestsPerSecond ?? rps);
    const now = Date.now(); s.tokens = Math.min(limit, s.tokens + ((now - s.refilled) / 1000) * limit); s.refilled = now;
    if (s.tokens < 1) return reply.status(429).header('retry-after', '1').send({ code: 'rate_limited', message: 'Too many requests' });
    s.tokens -= 1;
    if (s.pending.size >= maxInflight) return reply.status(429).header('retry-after', '1').send({ code: 'busy', message: 'The office server is busy' });

    const id = randomUUID();
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string' && !REQ_DROP.has(k)) headers[k] = v;
    headers['x-forwarded-for'] = req.ip; headers['x-forwarded-host'] = host; headers['x-forwarded-proto'] = 'https';
    const body = req.method !== 'GET' && req.method !== 'HEAD' && Buffer.isBuffer(req.body) && req.body.length > 0 ? req.body.toString('base64') : undefined;

    const stream = new Readable({ read() { /* pushed to */ } });
    stream.on('error', () => undefined); // a failure is reported through the reply; the stream's own error must not crash the process
    const timeout = setTimeout(() => { s.pending.delete(id); head.reject(new Error('timeout')); stream.destroy(new Error('timeout')); }, o.requestTimeoutMs ?? 65_000);
    const head = (() => { let resolve!: (v: { status: number; headers: Record<string, string> }) => void; let reject!: (e: Error) => void; const promise = new Promise<{ status: number; headers: Record<string, string> }>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; })();
    s.pending.set(id, { onHead: (status, h) => head.resolve({ status, headers: h }), onChunk: (b) => stream.push(b), onEnd: () => { clearTimeout(timeout); stream.push(null); }, onErr: (m) => { clearTimeout(timeout); head.reject(new Error(m)); stream.destroy(new Error(m)); } });
    s.ws.send(JSON.stringify({ t: 'req', id, method: req.method, path: req.url, headers, ...(body ? { body } : {}) } satisfies Frame));
    // the response socket closing before the reply finished means the remote user went away: stop work for them (the request's own 'close' fires as soon as its body is read, which is not that)
    reply.raw.on('close', () => { if (!reply.raw.writableFinished) { s.pending.delete(id); clearTimeout(timeout); stream.destroy(); } });

    try {
      const h = await head.promise;
      for (const [k, v] of Object.entries(h.headers)) if (!['content-length', 'transfer-encoding', 'connection', 'set-cookie'].includes(k.toLowerCase()) || k.toLowerCase() === 'set-cookie') reply.header(k, v);
      return reply.status(h.status).send(stream);
    } catch (e) {
      const m = e instanceof Error ? e.message : 'error';
      const [status, code, text] = m === 'timeout' ? [504, 'timeout', 'The office server took too long to answer'] : m === 'busy' ? [429, 'busy', 'The office server is busy'] : m === 'tunnel_closed' ? [502, 'site_offline', 'The connection to the office server dropped'] : [502, 'bad_gateway', 'The office server could not answer'];
      return reply.status(status).send({ code, message: text });
    }
  });

  return { app, sessions, recheck, async close() { clearInterval(pinger); clearInterval(rechecker); for (const s of sessions.values()) s.ws.terminate(); wss.close(); await app.close(); } };
}
