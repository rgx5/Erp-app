import { describe, expect, it } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { AppError } from './errors.js';
import { decodeCursor, encodeCursor, toPage } from './validation.js';

describe('pagination', () => {
  it('round-trips a cursor', () => {
    const id = uuidv7();
    expect(decodeCursor(encodeCursor(id))).toBe(id);
    expect(decodeCursor(undefined)).toBeUndefined();
  });
  it('rejects a forged cursor', () => {
    expect(() => decodeCursor(Buffer.from("1' OR '1'='1").toString('base64url'))).toThrow(AppError);
  });
  it('returns a next cursor only when there is another page', () => {
    const rows = [{ id: uuidv7() }, { id: uuidv7() }, { id: uuidv7() }];
    expect(toPage(rows, 2).items).toHaveLength(2);
    expect(toPage(rows, 2).nextCursor).toBe(encodeCursor(rows[1]!.id));
    expect(toPage(rows.slice(0, 2), 2).nextCursor).toBeNull();
  });
});
