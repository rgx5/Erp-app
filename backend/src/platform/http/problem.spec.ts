import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AppError, notFound, validationFailed } from './errors.js';
import { findPgError, toProblem } from './problem.js';

const pgError = (code: string, constraint?: string) => Object.assign(new Error('boom'), { code, constraint });
const wrapped = (inner: Error) => Object.assign(new Error('Failed query'), { cause: inner });

describe('toProblem', () => {
  it('passes AppError through with its code and extras', () => {
    const { problem } = toProblem(validationFailed([{ path: 'a', message: 'bad' }]));
    expect(problem).toMatchObject({ status: 422, code: 'validation_failed', errors: [{ path: 'a', message: 'bad' }] });
    expect(toProblem(notFound('Company')).problem.status).toBe(404);
  });
  it('maps PostgreSQL errors, including ones wrapped by the ORM', () => {
    expect(toProblem(wrapped(pgError('23505', 'x_unique'))).problem).toMatchObject({ status: 409, code: 'conflict', constraint: 'x_unique' });
    expect(toProblem(pgError('23503')).problem).toMatchObject({ status: 422, code: 'reference_invalid' });
    expect(toProblem(pgError('23514')).problem).toMatchObject({ status: 422, code: 'constraint_violated' });
    expect(toProblem(pgError('40001')).problem).toMatchObject({ status: 409, retryable: true });
    expect(toProblem(pgError('57014')).problem).toMatchObject({ status: 503, code: 'timeout' });
    expect(toProblem(pgError('08006')).problem).toMatchObject({ status: 503, code: 'database_unavailable' });
  });
  it('treats a row-level-security denial as a loud 403', () => {
    expect(toProblem(pgError('42501'))).toMatchObject({ problem: { status: 403 }, log: 'error' });
  });
  it('maps transport-level 4xx errors', () => {
    expect(toProblem({ statusCode: 413, message: 'big' }).problem.code).toBe('payload_too_large');
    expect(toProblem({ statusCode: 400, message: 'bad json' }).problem.code).toBe('bad_request');
  });
  it('never leaks internals of an unknown error', () => {
    const { problem, log } = toProblem(new Error('password=hunter2 at /srv/app.js'));
    expect(problem).toMatchObject({ status: 500, code: 'internal_error' });
    expect(JSON.stringify(problem)).not.toContain('hunter2');
    expect(log).toBe('error');
  });
  it('keeps Nest HttpException statuses', () => {
    expect(toProblem(new HttpException('nope', 405)).problem.status).toBe(405);
  });
  it('finds a PostgreSQL error only when one is present', () => {
    expect(findPgError(new Error('plain'))).toBeUndefined();
    expect(findPgError(new AppError(400, 'x', 'y'))).toBeUndefined();
  });
});
