import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().min(0).max(65535).default(8090),
  HOST: z.string().default('127.0.0.1'),
  /** Ed25519 private key (PEM) that signs licences. Servers verify with its public key (their LICENCE_PUBLIC_KEY). */
  LICENCE_PRIVATE_KEY: z.string().min(20),
  /** Ed25519 private key (PEM) that signs release manifests. Site agents verify with its public key. */
  RELEASE_PRIVATE_KEY: z.string().min(20),
  SESSION_HOURS: z.coerce.number().int().min(1).max(72).default(12),
  /** A site that has not reported for this many minutes is silent. */
  SILENT_AFTER_MINUTES: z.coerce.number().int().min(1).default(10),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});
export type Config = z.infer<typeof schema>;
export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => schema.parse(env);
