import type { OpenAPIObject } from '@nestjs/swagger';

const METHODS = ['get', 'put', 'post', 'delete', 'patch'] as const;

/**
 * Nest documents request bodies (from the Zod schemas) but leaves out path parameters. Every `{name}` in a path is a required path
 * parameter, so add them: clients generated from the document then know which routes take which ids. A parameter called `id` or
 * ending in `Id` is a UUID.
 */
export function addPathParameters(document: OpenAPIObject): OpenAPIObject {
  for (const [path, item] of Object.entries(document.paths)) {
    const names = [...path.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1] as string);
    if (names.length === 0) continue;
    for (const method of METHODS) {
      const operation = item[method];
      if (!operation) continue;
      const existing = new Set((operation.parameters ?? []).map((p) => ('name' in p ? `${p.in}:${p.name}` : '')));
      const added = names.filter((n) => !existing.has(`path:${n}`)).map((name) => ({
        name, in: 'path' as const, required: true,
        schema: name === 'id' || name.endsWith('Id') ? { type: 'string' as const, format: 'uuid' } : { type: 'string' as const },
      }));
      operation.parameters = [...(operation.parameters ?? []), ...added];
    }
  }
  return document;
}
