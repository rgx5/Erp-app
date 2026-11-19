import { createPublicKey, verify } from 'node:crypto';

/** Stable text for signing: object keys sorted at every level (the control plane signs with the same rule). */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function verifyDocument(doc: unknown, signature: string, publicPem: string): boolean {
  try { return verify(null, Buffer.from(canonical(doc)), createPublicKey(publicPem), Buffer.from(signature, 'base64')); } catch { return false; }
}

export interface Manifest { version: string; images: { name: string; digest: string }[]; migrationDigest: string; minClientVersion: string | null; maxClientVersion: string | null; notes: string; createdAt: string }
const DIGEST = /^sha256:[0-9a-f]{64}$/;
export function compareVersions(a: string, b: string): number {
  const x = a.split('.').map(Number); const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d !== 0) return d; }
  return 0;
}

/** A release is acted on only if it is signed by the control plane, well formed, and newer than what runs. Returns the problem, or undefined. */
export function releaseProblem(manifest: Manifest, signature: string, publicPem: string, current: string | null): string | undefined {
  if (!verifyDocument(manifest, signature, publicPem)) return 'signature_invalid';
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version) || !manifest.images?.length || !DIGEST.test(manifest.migrationDigest) || manifest.images.some((i) => !DIGEST.test(i.digest) || !/^[a-z0-9][a-z0-9._-]{0,60}$/.test(i.name))) return 'manifest_invalid';
  if (current && compareVersions(manifest.version, current) <= 0) return 'not_newer';
  return undefined;
}
