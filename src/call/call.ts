import { readFile } from "node:fs/promises";
import type { OpenApiDocument, OpenApiOperation, OpenApiParameter } from "../openapi/export.ts";
import { sessionHeaders, sessionQuery, type Session } from "../session/session.ts";
import { isReadOperation } from "../endpoints/actions.ts";
import { looksUnauthenticated } from "../session/refresh.ts";

// Calls one operation of an OpenAPI document by its operationId, so that a
// discovered system can be used from the command line, a script or an agent.

export interface OperationSummary {
  operationId: string;
  method: string;
  path: string;
  server: string;
  parameters: { name: string; in: "path" | "query"; required: boolean; type?: string; default?: string }[];
  hasBody: boolean;
  writes: boolean;
}

export interface CallRequest {
  operationId: string;
  params: Record<string, string>;
  body?: string;
  baseUrl?: string;
  allowWrites?: boolean;
  session?: Session;
  // Called once when the response says the session is gone; the call is
  // retried with the session it returns.
  refresh?: () => Promise<Session>;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export interface CallResult {
  status: number;
  ok: boolean;
  contentType: string | undefined;
  body: string;
  url: string;
  location?: string;
  // Set when the session was refreshed and the call retried.
  refreshedSession?: Session;
}


export async function loadOpenApi(path: string): Promise<OpenApiDocument> {
  const doc = JSON.parse(await readFile(path, "utf8")) as OpenApiDocument;
  if (!doc?.openapi || !doc.paths) throw new Error(`${path} is not an OpenAPI document`);
  return doc;
}

export function listOperations(doc: OpenApiDocument): OperationSummary[] {
  const out: OperationSummary[] = [];
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(item)) {
      out.push({
        operationId: op.operationId,
        method: method.toUpperCase(),
        path,
        server: serverFor(doc, op),
        parameters: (op.parameters ?? []).map((p) => ({
          name: p.name,
          in: p.in,
          required: p.required,
          type: typeof p.schema.type === "string" ? p.schema.type : undefined,
          default: p.schema.default === undefined ? undefined : String(p.schema.default),
        })),
        hasBody: op.requestBody !== undefined,
        writes: !isReadOperation(method, path),
      });
    }
  }
  return out.sort((a, b) => a.operationId.localeCompare(b.operationId));
}

export function findOperation(doc: OpenApiDocument, operationId: string): { method: string; path: string; op: OpenApiOperation } {
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(item)) {
      if (op.operationId === operationId) return { method: method.toUpperCase(), path, op };
    }
  }
  const known = listOperations(doc).map((o) => o.operationId).join(", ");
  throw new Error(`unknown operation "${operationId}". Available: ${known}`);
}

export function buildUrl(doc: OpenApiDocument, operationId: string, params: Record<string, string>, baseUrl?: string): string {
  const { path, op } = findOperation(doc, operationId);
  const declared = op.parameters ?? [];
  checkParams(operationId, declared, params);

  let resolved = path;
  const query = new URLSearchParams();
  for (const p of declared) {
    const value = params[p.name] ?? (p.schema.default === undefined ? undefined : String(p.schema.default));
    if (value === undefined) continue;
    if (p.in === "path") resolved = resolved.replace(`{${p.name}}`, encodeURIComponent(value));
    else query.append(p.name, value);
  }

  const server = (baseUrl ?? serverFor(doc, op)).replace(/\/$/, "");
  const search = query.toString();
  return `${server}${resolved}${search ? `?${search}` : ""}`;
}

export async function callOperation(doc: OpenApiDocument, request: CallRequest): Promise<CallResult> {
  const { method, path, op } = findOperation(doc, request.operationId);
  if (!isReadOperation(method, path) && !request.allowWrites) {
    throw new Error(`${request.operationId} is a ${method} and changes data; pass --allow-writes to call it`);
  }
  if (op.requestBody?.required && request.body === undefined) {
    throw new Error(`${request.operationId} needs a request body; pass --body '<json>' or --body @file.json`);
  }

  const origin = serverFor(doc, op);
  const built = new URL(buildUrl(doc, request.operationId, request.params, request.baseUrl));
  // Credentials the web app sends in the URL come from the session file.
  for (const [name, value] of Object.entries(sessionQuery(request.session, origin))) {
    if ((op["x-api-anything"].credentialQuery ?? []).includes(name) && !built.searchParams.has(name)) built.searchParams.set(name, value);
  }
  const url = built.href;
  const mediaType = Object.keys(op.requestBody?.content ?? {})[0] ?? "application/json";

  const send = async (session: Session | undefined): Promise<CallResult> => {
    const headers = new Headers(sessionHeaders(session, origin));
    if (request.body !== undefined) headers.set("content-type", mediaType);
    headers.set("accept", "application/json, */*");
    const response = await (request.fetch ?? fetch)(url, {
      method,
      headers,
      body: request.body,
      redirect: "manual",
      signal: AbortSignal.timeout(request.timeoutMs ?? 30_000),
    });
    const result: CallResult = {
      status: response.status,
      ok: response.ok,
      contentType: response.headers.get("content-type") ?? undefined,
      body: await response.text(),
      url,
    };
    const location = response.headers.get("location");
    if (location) result.location = location;
    return result;
  };

  const first = await send(request.session);
  if (!request.refresh || !looksUnauthenticated(first.status, first.location)) return first;

  const fresh = await request.refresh();
  return { ...(await send(fresh)), refreshedSession: fresh };
}

function checkParams(operationId: string, declared: OpenApiParameter[], given: Record<string, string>): void {
  const names = new Set(declared.map((p) => p.name));
  const unknown = Object.keys(given).filter((n) => !names.has(n));
  if (unknown.length > 0) {
    const valid = declared.map((p) => p.name).join(", ") || "none";
    throw new Error(`${operationId} has no parameter ${unknown.map((n) => `--${n}`).join(", ")}. Valid: ${valid}`);
  }
  const missing = declared.filter((p) => p.required && given[p.name] === undefined).map((p) => `--${p.name}`);
  if (missing.length > 0) throw new Error(`${operationId} needs ${missing.join(", ")}`);
}

function serverFor(doc: OpenApiDocument, op: OpenApiOperation): string {
  const url = op.servers?.[0]?.url ?? doc.servers[0]?.url;
  if (!url) throw new Error("the OpenAPI document has no server URL; pass --base-url");
  return url;
}
