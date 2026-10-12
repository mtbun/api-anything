import type { OpenApiDocument } from "../openapi/export.ts";
import type { JsonSchema } from "../schema/infer.ts";
import { isReadOperation } from "../endpoints/actions.ts";

// A language-neutral view of an OpenAPI document that the client generators
// render. Generated clients have no dependencies: fetch for TypeScript, the
// standard library for Python.

export interface ClientModel {
  title: string;
  server: string;
  operations: ClientOperation[];
}

export interface ClientOperation {
  name: string;
  method: string;
  path: string;
  server: string;
  summary: string;
  writes: boolean;
  pathParams: ClientParam[];
  queryParams: ClientParam[];
  credentialQuery: string[];
  body?: JsonSchema;
  bodyMediaType?: string;
  response?: JsonSchema;
}

export interface ClientParam {
  name: string;
  schema: JsonSchema;
  required: boolean;
  default?: string | number | boolean;
}

export function buildClientModel(doc: OpenApiDocument): ClientModel {
  const server = doc.servers[0]?.url;
  if (!server) throw new Error("the OpenAPI document has no server URL");

  const operations: ClientOperation[] = [];
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(item)) {
      const params = op.parameters ?? [];
      const toParam = (p: (typeof params)[number]): ClientParam => {
        const param: ClientParam = { name: p.name, schema: p.schema, required: p.required };
        const d = p.schema.default;
        if (typeof d === "string" || typeof d === "number" || typeof d === "boolean") param.default = d;
        return param;
      };
      const success = Object.entries(op.responses).find(([code]) => code.startsWith("2"))?.[1];
      const bodyEntry = op.requestBody ? Object.entries(op.requestBody.content)[0] : undefined;

      const operation: ClientOperation = {
        name: op.operationId,
        method: method.toUpperCase(),
        path,
        server: op.servers?.[0]?.url ?? server,
        summary: op.summary,
        writes: !isReadOperation(method, path),
        pathParams: params.filter((p) => p.in === "path").map(toParam),
        queryParams: params.filter((p) => p.in === "query").map(toParam),
        credentialQuery: op["x-api-anything"].credentialQuery ?? [],
      };
      if (bodyEntry) {
        operation.bodyMediaType = bodyEntry[0];
        operation.body = bodyEntry[1].schema;
      }
      const responseSchema = success?.content ? Object.values(success.content)[0]?.schema : undefined;
      if (responseSchema) operation.response = responseSchema;
      operations.push(operation);
    }
  }
  operations.sort((a, b) => a.name.localeCompare(b.name));
  return { title: doc.info.title, server, operations };
}

export function pascal(name: string): string {
  return name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("") || "Value";
}

export function typesOf(schema: JsonSchema): string[] {
  if (schema.type === undefined) return [];
  return Array.isArray(schema.type) ? schema.type : [schema.type];
}
