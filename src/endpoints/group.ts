import type { ApiCall } from "../har/parse.ts";
import { inferSchema, mergeSchemas, type JsonSchema } from "../schema/infer.ts";
import { templatePath } from "./normalize.ts";
import { CREDENTIAL_PARAM } from "../credentials.ts";

// One API operation observed in the capture: a method on a templated path of
// one origin, with everything learned from every call that matched it.
export interface Endpoint {
  id: string;
  origin: string;
  method: string;
  pathTemplate: string;
  callCount: number;
  queryParameters: QueryParameter[];
  requestBody?: JsonSchema;
  requestMimeType?: string;
  responses: EndpointResponse[];
  examplePaths: string[];
}

export interface QueryParameter {
  name: string;
  // Seen on every call to this endpoint.
  required: boolean;
  examples: string[];
  // The same value on every one of two or more calls: a fixed setting of the
  // web app (client version, app ID) rather than an input.
  constant?: string;
  // Carries a credential (API key, token); belongs to the session.
  credential?: boolean;
}

export interface EndpointResponse {
  status: number;
  count: number;
  mimeType?: string;
  body?: JsonSchema;
}

const MAX_EXAMPLE_PATHS = 3;
const MAX_QUERY_EXAMPLES = 3;

export function groupEndpoints(calls: ApiCall[]): Endpoint[] {
  const groups = new Map<string, ApiCall[]>();
  for (const call of calls) {
    const key = endpointKey(call);
    const list = groups.get(key);
    if (list) list.push(call);
    else groups.set(key, [call]);
  }
  return [...groups.entries()]
    .map(([key, group]) => buildEndpoint(key, group))
    .sort((a, b) => a.origin.localeCompare(b.origin) || a.pathTemplate.localeCompare(b.pathTemplate) || a.method.localeCompare(b.method));
}

export function endpointKey(call: ApiCall): string {
  return `${call.method} ${call.url.origin}${templatePath(call.url.pathname)}`;
}

function buildEndpoint(key: string, calls: ApiCall[]): Endpoint {
  const first = calls[0]!;
  const endpoint: Endpoint = {
    id: key,
    origin: first.url.origin,
    method: first.method,
    pathTemplate: templatePath(first.url.pathname),
    callCount: calls.length,
    queryParameters: queryParameters(calls),
    responses: responses(calls),
    examplePaths: [...new Set(calls.map((c) => examplePath(c.url)))].slice(0, MAX_EXAMPLE_PATHS),
  };

  const bodies = calls.map((c) => c.requestBody).filter((b) => b !== undefined);
  if (bodies.length > 0) {
    endpoint.requestBody = mergeAll(bodies.map(inferSchema));
    endpoint.requestMimeType = calls.find((c) => c.requestMimeType)?.requestMimeType;
  }
  return endpoint;
}

// The path and query of a call with credential parameters removed, so that
// examples can be shared.
function examplePath(url: URL): string {
  const query = new URLSearchParams();
  for (const [name, value] of url.searchParams) if (!CREDENTIAL_PARAM.test(name)) query.append(name, value);
  const search = query.toString();
  return url.pathname + (search ? `?${search}` : "");
}

function queryParameters(calls: ApiCall[]): QueryParameter[] {
  const seen = new Map<string, { calls: number; examples: Set<string>; values: Set<string> }>();
  for (const call of calls) {
    const names = new Set<string>();
    for (const [name, value] of call.url.searchParams) {
      const entry = seen.get(name) ?? { calls: 0, examples: new Set<string>(), values: new Set<string>() };
      if (!names.has(name)) entry.calls += 1;
      names.add(name);
      entry.values.add(value);
      if (entry.examples.size < MAX_QUERY_EXAMPLES) entry.examples.add(value);
      seen.set(name, entry);
    }
  }
  return [...seen.entries()]
    .map(([name, { calls: count, examples, values }]) => {
      const param: QueryParameter = { name, required: count === calls.length, examples: [...examples] };
      if (CREDENTIAL_PARAM.test(name)) {
        param.credential = true;
        param.examples = [];
      } else if (count === calls.length && calls.length >= 2 && values.size === 1) {
        param.constant = [...values][0]!;
      }
      return param;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function responses(calls: ApiCall[]): EndpointResponse[] {
  const byStatus = new Map<number, ApiCall[]>();
  for (const call of calls) {
    const list = byStatus.get(call.status);
    if (list) list.push(call);
    else byStatus.set(call.status, [call]);
  }
  return [...byStatus.entries()]
    .sort(([a], [b]) => a - b)
    .map(([status, group]) => {
      const response: EndpointResponse = { status, count: group.length };
      const mimeType = group.find((c) => c.responseMimeType)?.responseMimeType;
      if (mimeType) response.mimeType = mimeType;
      const bodies = group.map((c) => c.responseBody).filter((b) => b !== undefined);
      if (bodies.length > 0) response.body = mergeAll(bodies.map(inferSchema));
      return response;
    });
}

function mergeAll(schemas: JsonSchema[]): JsonSchema {
  return schemas.reduce((acc, s) => mergeSchemas(acc, s));
}
