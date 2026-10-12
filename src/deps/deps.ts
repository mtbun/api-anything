import type { ApiCall } from "../har/parse.ts";
import { endpointKey } from "../endpoints/group.ts";
import { templatePath } from "../endpoints/normalize.ts";
import { CREDENTIAL_PARAM, SESSION_HEADER } from "../credentials.ts";

// Finds values that one call receives and a later call sends back: a token
// from a login response that becomes the Authorization header, an order ID
// from a list that becomes the path of a detail request. Deterministic: values
// are matched exactly, in capture order.

export type DependencyKind = "auth" | "data";

export interface DependencyEnd {
  // endpointKey of the operation, as used by groupEndpoints.
  endpoint: string;
  // "METHOD /path/{template}"
  operation: string;
  // Where the value sits, e.g. "response.body:$.items[*].id",
  // "response.cookie:sid", "request.path:orderId", "request.header:authorization".
  location: string;
}

export interface Dependency {
  from: DependencyEnd;
  to: DependencyEnd;
  kind: DependencyKind;
  count: number;
  // A sample of the value; credentials are masked.
  example: string;
}

// Values this short or this small match by coincidence (page=1, status=open).
const MIN_STRING_LENGTH = 4;
const MIN_NUMBER = 100;

const AUTH_HEADER = SESSION_HEADER;

interface Produced {
  value: string;
  endpoint: string;
  operation: string;
  location: string;
}

export function findDependencies(calls: ApiCall[]): Dependency[] {
  const ordered = [...calls].sort(byTime);
  const firstProducer = new Map<string, Produced>();
  const links = new Map<string, Dependency>();

  for (const call of ordered) {
    const endpoint = endpointKey(call);
    const operation = `${call.method} ${templatePath(call.url.pathname)}`;

    for (const used of consumedValues(call)) {
      const source = firstProducer.get(used.value);
      if (!source || source.endpoint === endpoint) continue;
      const kind: DependencyKind =
        used.location.startsWith("request.header") || used.location.startsWith("request.cookie") || isCredentialQuery(used.location)
          ? "auth"
          : "data";
      const key = `${source.endpoint}|${source.location}|${endpoint}|${used.location}`;
      const existing = links.get(key);
      if (existing) {
        existing.count += 1;
        continue;
      }
      links.set(key, {
        from: { endpoint: source.endpoint, operation: source.operation, location: source.location },
        to: { endpoint, operation, location: used.location },
        kind,
        count: 1,
        example: kind === "auth" ? mask(used.value) : truncate(used.value),
      });
    }

    // Register this call's outputs only after its inputs, so a call never
    // depends on itself.
    for (const made of producedValues(call)) {
      if (!firstProducer.has(made.value)) firstProducer.set(made.value, { ...made, endpoint, operation });
    }
  }

  return [...links.values()].sort(
    (a, b) => (a.kind === b.kind ? 0 : a.kind === "auth" ? -1 : 1) || a.from.operation.localeCompare(b.from.operation) || a.to.operation.localeCompare(b.to.operation),
  );
}

// The operations whose responses supply credentials for later calls: what
// has to be repeated to log in again.
export function authSources(deps: Dependency[]): DependencyEnd[] {
  const seen = new Map<string, DependencyEnd>();
  for (const d of deps) if (d.kind === "auth") seen.set(`${d.from.endpoint}|${d.from.location}`, d.from);
  return [...seen.values()];
}

interface Located {
  value: string;
  location: string;
}

function producedValues(call: ApiCall): Located[] {
  const out: Located[] = [];
  for (const [path, value] of flatten(call.responseBody, "$")) out.push({ value, location: `response.body:${path}` });
  for (const { name, value } of call.responseHeaders) {
    const lower = name.toLowerCase();
    if (lower === "set-cookie") {
      // A HAR may hold several cookies in one header, separated by newlines.
      for (const line of value.split("\n")) {
        const [pair] = line.split(";");
        const eq = pair?.indexOf("=") ?? -1;
        if (pair && eq > 0) addString(out, pair.slice(eq + 1).trim(), `response.cookie:${pair.slice(0, eq).trim()}`);
      }
    } else if (AUTH_HEADER.test(lower)) {
      addString(out, value, `response.header:${lower}`);
    }
  }
  return out;
}

function consumedValues(call: ApiCall): Located[] {
  const out: Located[] = [];

  const template = templatePath(call.url.pathname).split("/");
  call.url.pathname.split("/").forEach((segment, i) => {
    const match = /^\{(.+)\}$/.exec(template[i] ?? "");
    if (match) addString(out, decodeURIComponent(segment), `request.path:${match[1]}`);
  });

  for (const [name, value] of call.url.searchParams) addString(out, value, `request.query:${name}`);
  for (const [path, value] of flatten(call.requestBody, "$")) out.push({ value, location: `request.body:${path}` });

  for (const { name, value } of call.requestHeaders) {
    const lower = name.toLowerCase();
    if (lower === "cookie") {
      for (const pair of value.split(";")) {
        const eq = pair.indexOf("=");
        if (eq > 0) addString(out, pair.slice(eq + 1).trim(), `request.cookie:${pair.slice(0, eq).trim()}`);
      }
    } else if (lower === "authorization") {
      addString(out, value.replace(/^(bearer|token|basic)\s+/i, ""), "request.header:authorization");
    } else if (AUTH_HEADER.test(lower)) {
      addString(out, value, `request.header:${lower}`);
    }
  }
  return out;
}

// Leaf values with JSON paths; array indices collapse to [*] so that the
// same field of different list items is one location.
function* flatten(value: unknown, path: string): Generator<[string, string]> {
  if (Array.isArray(value)) {
    for (const item of value) yield* flatten(item, `${path}[*]`);
  } else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) yield* flatten(child, `${path}.${key}`);
  } else if (typeof value === "string" && value.length >= MIN_STRING_LENGTH && !DATE_VALUE.test(value)) {
    yield [path, value];
  } else if (typeof value === "number" && Number.isFinite(value) && Math.abs(value) >= MIN_NUMBER) {
    yield [path, String(value)];
  }
}

// Dates repeat across unrelated calls (today's date in a forecast and in a
// timesheet query); they are not identifiers that one call hands to another.
const DATE_VALUE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}.*)?$/;

function addString(out: Located[], value: string, location: string): void {
  if (DATE_VALUE.test(value)) return;
  const isNumber = /^-?\d+(\.\d+)?$/.test(value);
  if (isNumber ? Math.abs(Number(value)) >= MIN_NUMBER : value.length >= MIN_STRING_LENGTH) out.push({ value, location });
}

function isCredentialQuery(location: string): boolean {
  return location.startsWith("request.query:") && CREDENTIAL_PARAM.test(location.slice("request.query:".length));
}

function byTime(a: ApiCall, b: ApiCall): number {
  if (!a.startedAt || !b.startedAt) return 0;
  return Date.parse(a.startedAt) - Date.parse(b.startedAt);
}

function mask(value: string): string {
  return value.length <= 8 ? "****" : `${value.slice(0, 4)}…(${value.length} chars)`;
}

function truncate(value: string): string {
  return value.length > 40 ? `${value.slice(0, 37)}...` : value;
}
