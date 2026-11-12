import type { LoggerService } from '@nestjs/common';
import pino, { type Logger } from 'pino';
import type { Env } from '../../config/env.js';

export function createLogger(env: Pick<Env, 'LOG_LEVEL' | 'NODE_ENV'>): Logger {
  return pino({
    level: env.LOG_LEVEL,
    base: { service: 'erp-backend' },
    timestamp: pino.stdTimeFunctions.isoTime,
    // Credentials and personal data never reach the logs.
    redact: { paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token', '*.secret'], censor: '[redacted]' },
  });
}

/** Routes Nest's own logging through pino so every line is structured JSON. */
export class PinoLoggerService implements LoggerService {
  constructor(private readonly logger: Logger) {}
  log(message: unknown, ...rest: unknown[]) { this.logger.info({ context: ctx(rest) }, text(message)); }
  error(message: unknown, ...rest: unknown[]) { this.logger.error({ context: ctx(rest) }, text(message)); }
  warn(message: unknown, ...rest: unknown[]) { this.logger.warn({ context: ctx(rest) }, text(message)); }
  debug(message: unknown, ...rest: unknown[]) { this.logger.debug({ context: ctx(rest) }, text(message)); }
  verbose(message: unknown, ...rest: unknown[]) { this.logger.trace({ context: ctx(rest) }, text(message)); }
  fatal(message: unknown, ...rest: unknown[]) { this.logger.fatal({ context: ctx(rest) }, text(message)); }
}

const text = (m: unknown): string => (typeof m === 'string' ? m : JSON.stringify(m));
const ctx = (rest: unknown[]): string | undefined => (typeof rest.at(-1) === 'string' ? (rest.at(-1) as string) : undefined);

export const LOGGER = Symbol('LOGGER');
