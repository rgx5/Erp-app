import { randomBytes } from 'node:crypto';
import type { Provider } from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';
import { SecretBox } from './secret-box.js';
import { TokenService } from './tokens.js';

export const TOKENS = Symbol('TOKENS');
export const SECRET_BOX = Symbol('SECRET_BOX');

export const cryptoProviders: Provider[] = [
  {
    provide: TOKENS,
    inject: [ENV],
    // Outside production a missing key yields an ephemeral one: tokens stop working at restart, which is fine for development.
    useFactory: (env: Env) => new TokenService(env.AUTH_JWT_PRIVATE_KEY, env.AUTH_JWT_PREVIOUS_PUBLIC_KEYS ? (JSON.parse(env.AUTH_JWT_PREVIOUS_PUBLIC_KEYS) as string[]) : []),
  },
  {
    provide: SECRET_BOX,
    inject: [ENV],
    useFactory: (env: Env) => new SecretBox(env.DATA_ENCRYPTION_KEY ? Buffer.from(env.DATA_ENCRYPTION_KEY, 'base64') : randomBytes(32)),
  },
];
