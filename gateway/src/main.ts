import { z } from 'zod';
import { buildGateway, type Verdict } from './gateway.js';

const env = z.object({ CONTROL_PLANE_URL: z.string().url(), GATEWAY_TOKEN: z.string().min(32), PORT: z.coerce.number().default(8443), HOST: z.string().default('127.0.0.1') }).parse(process.env);

/** Asks the control plane whether a tunnel may connect. 403 means no; anything else (including no answer) is "cannot tell", which never drops a live tunnel. */
async function verify(token: string): Promise<Verdict | null> {
  const res = await fetch(`${env.CONTROL_PLANE_URL}/gateway/verify`, { method: 'POST', headers: { authorization: `Bearer ${env.GATEWAY_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ token }), signal: AbortSignal.timeout(10_000) });
  if (res.status === 403) return null;
  if (!res.ok) throw new Error(`control plane answered ${res.status}`);
  return (await res.json()) as Verdict;
}
const g = buildGateway({ verify, log: (m) => console.log(m) });
await g.app.listen({ port: env.PORT, host: env.HOST });
console.log(`gateway listening on ${env.HOST}:${env.PORT} (put TLS in front: Caddy or nginx on 443)`);
