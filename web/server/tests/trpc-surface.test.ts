/**
 * Unit tests for the tRPC surface introspection (lib/trpc-surface.ts).
 *
 * This module reads tRPC's internal `_def` shape, which is not a stable public
 * API. A tRPC upgrade that moves those fields would otherwise degrade quietly:
 * an empty procedure list still renders a perfectly valid — and completely
 * empty — Swagger page. These tests fail loudly instead.
 */
import { describe, expect, it } from 'vitest';

import { buildTrpcOpenApiDocument, collectTrpcProcedures } from '../lib/trpc-surface';

describe('collectTrpcProcedures', () => {
  const procedures = collectTrpcProcedures();

  it('finds the whole router, not an empty surface', () => {
    // The router had 94 procedures when this was written; the guard is against
    // introspection breaking (0) rather than against the surface growing.
    expect(procedures.length).toBeGreaterThan(50);
  });

  it('labels every procedure with a known auth tier', () => {
    const unknown = procedures.filter((procedure) => procedure.auth === 'unknown');
    expect(unknown.map((procedure) => procedure.path)).toEqual([]);
  });

  it('maps queries to GET and mutations to POST', () => {
    for (const procedure of procedures) {
      if (procedure.type === 'query') {
        expect(procedure.httpMethod).toBe('GET');
      }
      if (procedure.type === 'mutation') {
        expect(procedure.httpMethod).toBe('POST');
      }
    }
  });

  it('reports org-scoped procedures as session+org with organizationId in the input', () => {
    const orgScoped = procedures.find((p) => p.path === 'organization.listMembers');
    expect(orgScoped?.auth).toBe('session+org');
    // The tier is what a reviewer acts on, so it must match the actual input
    // contract: session+org procedures take the org from caller input.
    expect(JSON.stringify(orgScoped?.input)).toContain('organizationId');
  });

  it('reports the public procedure as public', () => {
    expect(procedures.find((p) => p.path === 'auth')?.auth).toBe('public');
  });
});

describe('buildTrpcOpenApiDocument', () => {
  const document = buildTrpcOpenApiDocument('https://api.example.com');

  it('is a valid OpenAPI 3.0 document covering every callable procedure', () => {
    expect(document.openapi).toBe('3.0.0');
    expect(document.servers[0].url).toBe('https://api.example.com');
    const callable = collectTrpcProcedures().filter((p) => p.type !== 'subscription');
    expect(Object.keys(document.paths).length).toBe(callable.length);
  });

  it('addresses procedures at their real /trpc path', () => {
    expect(document.paths['/trpc/organization.listMembers']).toBeDefined();
    expect(document.paths['/trpc/organization.listMembers'].get).toBeDefined();
  });

  it('wraps inputs in the superjson envelope tRPC actually expects', () => {
    // Without the {"json": ...} wrapper every request Swagger builds is
    // rejected before it reaches a resolver.
    const mutation = document.paths['/trpc/dashboardViews.create'].post as {
      requestBody: { content: Record<string, { schema: { properties: Record<string, unknown>; required: string[] } }> };
    };
    const schema = mutation.requestBody.content['application/json'].schema;
    expect(schema.required).toEqual(['json']);
    expect(schema.properties.json).toBeDefined();
  });

  it('puts the query input in the input query parameter', () => {
    const query = document.paths['/trpc/organization.listMembers'].get as {
      parameters: Array<{ name: string; in: string; required: boolean }>;
    };
    expect(query.parameters[0].name).toBe('input');
    expect(query.parameters[0].in).toBe('query');
    expect(query.parameters[0].required).toBe(true);
  });

  it('tags each operation with its auth tier so the UI groups by credential', () => {
    const tags = new Set(
      Object.values(document.paths).flatMap((operations) =>
        Object.values(operations as Record<string, { tags?: string[] }>).flatMap(
          (operation) => operation.tags ?? [],
        ),
      ),
    );
    expect([...tags].sort()).toEqual(['public', 'session', 'session+org']);
  });

  it('says plainly that API keys do not work here', () => {
    expect(document.info.description).toContain('not with an API key');
  });
});
