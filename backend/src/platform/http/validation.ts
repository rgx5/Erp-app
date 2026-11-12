import { StandardSchemaValidationPipe } from '@nestjs/common';
import { z } from 'zod';
import { ApiBody } from '@nestjs/swagger';
import { validationFailed } from './errors.js';

/** Validates every `@Body/@Query/@Param({ schema })` with Zod and turns failures into a 422 problem listing each issue. */
export const createValidationPipe = () =>
  new StandardSchemaValidationPipe({
    exceptionFactory: (issues) =>
      validationFailed(
        issues.map((issue) => ({
          path: (issue.path ?? []).map((p) => (typeof p === 'object' ? String(p.key) : String(p))).join('.'),
          message: issue.message,
        })),
      ),
  });

/** Documents a request body in OpenAPI from the same Zod schema that validates it. */
export const ApiZodBody = (schema: z.ZodType) => ApiBody({ schema: z.toJSONSchema(schema, { target: 'openapi-3.0', io: 'input' }) as Record<string, unknown> });

export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(100).optional(),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The cursor is the last id seen. Ids are UUIDv7 (time-ordered), so id order is creation order. */
export function decodeCursor(cursor: string | undefined): string | undefined {
  if (cursor === undefined) return undefined;
  const id = Buffer.from(cursor, 'base64url').toString('utf8');
  if (!UUID.test(id)) throw validationFailed([{ path: 'cursor', message: 'The cursor is not valid' }]);
  return id;
}

export const encodeCursor = (id: string): string => Buffer.from(id, 'utf8').toString('base64url');

export function toPage<T extends { id: string }>(rows: T[], limit: number): Page<T> {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last ? encodeCursor(last.id) : null };
}
