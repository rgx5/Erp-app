import type { OpenAPIObject } from '@nestjs/swagger';
import { describe, expect, it } from 'vitest';
import { addPathParameters } from './openapi.js';

const doc = (paths: OpenAPIObject['paths']): OpenAPIObject => ({ openapi: '3.0.0', info: { title: 't', version: '1' }, paths });

describe('addPathParameters', () => {
  it('adds every path template variable as a required parameter, uuid for ids', () => {
    const out = addPathParameters(doc({ '/v1/companies/{companyId}/items/{code}': { get: { responses: {} }, post: { responses: {}, parameters: [{ name: 'code', in: 'path', required: true, schema: { type: 'string' } }] } } }));
    const get = out.paths['/v1/companies/{companyId}/items/{code}']?.get?.parameters;
    expect(get).toEqual([
      { name: 'companyId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      { name: 'code', in: 'path', required: true, schema: { type: 'string' } },
    ]);
    expect(out.paths['/v1/companies/{companyId}/items/{code}']?.post?.parameters).toHaveLength(2); // no duplicate of the one already described
  });
  it('leaves paths without variables alone', () => {
    const out = addPathParameters(doc({ '/v1/meta': { get: { responses: {} } } }));
    expect(out.paths['/v1/meta']?.get?.parameters).toBeUndefined();
  });
});
