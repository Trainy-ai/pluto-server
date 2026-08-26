/**
 * Introspection of the tRPC surface.
 *
 * The published OpenAPI spec describes only the REST API under /api/runs/*.
 * The ~94 tRPC procedures the web app calls are a separate surface with a
 * separate credential (better-auth session cookie — an API key is rejected),
 * and nothing described them. This module walks the live router and turns it
 * into something reviewable: a flat inventory (see
 * scripts/generate-api-inventory.ts) and an OpenAPI document (served
 * session-gated from routes/docs.ts) so the same Swagger UI can drive them.
 *
 * It reads tRPC internals (`_def`), which are not a stable public API — if a
 * tRPC upgrade changes them, the unit tests in tests/trpc-surface.test.ts fail
 * loudly rather than silently publishing an empty surface.
 */
import type { ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import { appRouter } from "../trpc/router";

export type TrpcAuthTier = "public" | "session" | "session+org" | "unknown";

export interface TrpcProcedureSummary {
  path: string;
  type: "query" | "mutation" | "subscription";
  auth: TrpcAuthTier;
  /** Queries travel as GET with the input in the query string; mutations POST it. */
  httpMethod: "GET" | "POST";
  input: Record<string, unknown> | null;
}

/** The slice of tRPC's internal procedure shape this module reads. */
interface TrpcProcedureDef {
  _def: {
    type: "query" | "mutation" | "subscription";
    meta?: unknown;
    inputs?: ZodTypeAny[];
  };
}

function authOf(meta: unknown): TrpcAuthTier {
  const auth = (meta as { auth?: string } | undefined)?.auth;
  return auth === "public" || auth === "session" || auth === "session+org"
    ? auth
    : "unknown";
}

/** tRPC merges every `.input()` in a procedure's chain, so publish them all. */
function inputJsonSchema(
  inputs: ZodTypeAny[],
): Record<string, unknown> | null {
  if (inputs.length === 0) {
    return null;
  }
  const schemas = inputs.map(
    (schema) =>
      zodToJsonSchema(schema, { $refStrategy: "none" }) as Record<
        string,
        unknown
      >,
  );
  return schemas.length === 1 ? schemas[0] : { allOf: schemas };
}

export function collectTrpcProcedures(): TrpcProcedureSummary[] {
  const procedures = (
    appRouter as unknown as {
      _def: { procedures: Record<string, TrpcProcedureDef> };
    }
  )._def.procedures;

  return Object.entries(procedures)
    .map(([path, procedure]) => {
      const type = procedure._def.type;
      return {
        path,
        type,
        auth: authOf(procedure._def.meta),
        httpMethod: type === "query" ? ("GET" as const) : ("POST" as const),
        input: inputJsonSchema(procedure._def.inputs ?? []),
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Everything tRPC sends is wrapped in superjson's envelope, so the body a
 * caller actually writes is `{"json": <input>}` — model that in the schema
 * rather than the bare input, or every request Swagger builds is rejected
 * before it reaches a resolver.
 */
function envelope(input: Record<string, unknown> | null) {
  return {
    type: "object",
    properties: { json: input ?? { type: "object" } },
    required: ["json"],
  };
}

const DESCRIPTION = `
Procedures the web app itself calls, at \`/trpc/*\`.

**These authenticate with your browser session, not with an API key.** A valid
\`mlps_\` bearer token is rejected here (\`createContext\` only reads the
better-auth session), so "Try it out" works because you are signed in — the
request carries your session cookie. The curl this page prints does **not**
include that cookie; to replay it in a terminal add
\`-b "better-auth.session_token=<value from your browser>"\`.

Auth tiers are listed as tags: \`public\`, \`session\`, and \`session+org\`
(signed in **and** a member of the \`organizationId\` in the input — that field
is caller-supplied and checked against your memberships).

Inputs and outputs are superjson-wrapped: send \`{"json": <input>}\`, and read
results from \`result.data.json\`. The web client also batches
(\`?batch=1&input={"0":{"json":…}}\`); these operations use the unbatched form.
`.trim();

/**
 * An OpenAPI 3.0 document for the tRPC surface. Every procedure becomes one
 * operation: queries as GET with the superjson envelope in the `input` query
 * parameter, mutations as POST with it as the body.
 */
export function buildTrpcOpenApiDocument(serverUrl: string) {
  const procedures = collectTrpcProcedures();
  const paths: Record<string, Record<string, unknown>> = {};

  for (const procedure of procedures) {
    if (procedure.type === "subscription") {
      continue;
    }

    const operation: Record<string, unknown> = {
      tags: [procedure.auth],
      summary: procedure.path,
      operationId: `${procedure.type}.${procedure.path}`,
      description: `tRPC ${procedure.type}. Auth: ${procedure.auth}.`,
      responses: {
        200: { description: "superjson-wrapped result under `result.data.json`" },
        401: { description: "No session, or not a member of the organization" },
      },
    };

    if (procedure.httpMethod === "GET") {
      operation.parameters = [
        {
          name: "input",
          in: "query",
          required: procedure.input !== null,
          description: "superjson envelope: {\"json\": <input>}",
          content: { "application/json": { schema: envelope(procedure.input) } },
        },
      ];
    } else {
      operation.requestBody = {
        required: true,
        content: { "application/json": { schema: envelope(procedure.input) } },
      };
    }

    paths[`/trpc/${procedure.path}`] = {
      [procedure.httpMethod.toLowerCase()]: operation,
    };
  }

  return {
    openapi: "3.0.0",
    info: {
      title: "mlop tRPC (session-authenticated)",
      version: "1.0.0",
      description: DESCRIPTION,
    },
    servers: [{ url: serverUrl, description: "API Server" }],
    tags: [
      { name: "public", description: "No credential required" },
      { name: "session", description: "Signed-in session required" },
      {
        name: "session+org",
        description:
          "Signed-in session AND membership of the organizationId passed in the input",
      },
    ],
    paths,
  };
}
