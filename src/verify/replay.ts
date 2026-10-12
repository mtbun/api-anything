import type { ApiCall } from "../har/parse.ts";
import { parseBody } from "../har/parse.ts";
import { endpointKey, groupEndpoints, type Endpoint } from "../endpoints/group.ts";
import { validateAgainst, type SchemaIssue } from "../schema/validate.ts";

// Replays one recorded call per operation against the live system and reports
// whether the operation still behaves as described.

export type Verdict = "verified" | "drifted" | "failed" | "skipped";

export interface VerificationResult {
  endpoint: string;
  operation: string;
  verdict: Verdict;
  reason: string;
  expectedStatus?: number;
  actualStatus?: number;
  durationMs?: number;
  issues?: SchemaIssue[];
}

export interface VerifyOptions {
  // Replace the recorded origin, e.g. to verify against a staging copy.
  baseUrl?: string;
  // POST, PUT, PATCH and DELETE change data; they are replayed only when set.
  allowWrites?: boolean;
  // Pause between requests so the system is not hit in a burst.
  delayMs?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const MAX_ISSUES = 10;

// Headers the HTTP client sets itself, or that would make the replay differ
// from a fresh request.
const DROPPED_HEADERS = new Set([
  "host", "content-length", "connection", "keep-alive", "transfer-encoding",
  "accept-encoding", "upgrade", "te", "trailer", "proxy-connection",
]);

export async function verifyCalls(calls: ApiCall[], options: VerifyOptions = {}): Promise<VerificationResult[]> {
  const endpoints = groupEndpoints(calls);
  const byKey = new Map<string, ApiCall[]>();
  for (const call of calls) {
    const key = endpointKey(call);
    const list = byKey.get(key);
    if (list) list.push(call);
    else byKey.set(key, [call]);
  }

  const results: VerificationResult[] = [];
  let first = true;
  for (const endpoint of endpoints) {
    const sample = pickSample(byKey.get(endpoint.id) ?? []);
    const operation = `${endpoint.method} ${endpoint.pathTemplate}`;
    if (!sample) {
      results.push({ endpoint: endpoint.id, operation, verdict: "skipped", reason: "no recorded call to replay" });
      continue;
    }
    if (!SAFE_METHODS.has(sample.method) && !options.allowWrites) {
      results.push({
        endpoint: endpoint.id,
        operation,
        verdict: "skipped",
        reason: `${sample.method} changes data; pass --allow-writes to replay it`,
      });
      continue;
    }
    if (!first && options.delayMs) await sleep(options.delayMs);
    first = false;
    results.push(await replayOne(endpoint, sample, options));
  }
  return results;
}

// Prefer a successful call: it shows what the operation should return.
function pickSample(calls: ApiCall[]): ApiCall | undefined {
  return calls.find((c) => c.status >= 200 && c.status < 300) ?? calls[0];
}

async function replayOne(endpoint: Endpoint, sample: ApiCall, options: VerifyOptions): Promise<VerificationResult> {
  const doFetch = options.fetch ?? fetch;
  const url = targetUrl(sample.url, options.baseUrl);
  const operation = `${endpoint.method} ${endpoint.pathTemplate}`;
  const base = { endpoint: endpoint.id, operation, expectedStatus: sample.status };

  const started = performance.now();
  let response: Response;
  try {
    response = await doFetch(url, {
      method: sample.method,
      headers: replayHeaders(sample),
      body: sample.method === "GET" || sample.method === "HEAD" ? undefined : sample.requestBodyText,
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
    });
  } catch (error) {
    return { ...base, verdict: "failed", reason: `unreachable: ${errorMessage(error)}` };
  }
  const durationMs = Math.round(performance.now() - started);
  const actualStatus = response.status;
  const text = await response.text().catch(() => "");

  if (actualStatus !== sample.status) {
    return { ...base, actualStatus, durationMs, verdict: "failed", reason: explainStatus(sample.status, actualStatus) };
  }

  const expected = endpoint.responses.find((r) => r.status === actualStatus)?.body;
  if (!expected) {
    return { ...base, actualStatus, durationMs, verdict: "verified", reason: "status matches; no body schema to compare" };
  }
  const body = parseBody(text, response.headers.get("content-type") ?? undefined);
  const issues = validateAgainst(body, expected);
  if (issues.length > 0) {
    return {
      ...base,
      actualStatus,
      durationMs,
      verdict: "drifted",
      reason: `response no longer matches the recorded shape (${issues.length} difference${issues.length === 1 ? "" : "s"})`,
      issues: issues.slice(0, MAX_ISSUES),
    };
  }
  return { ...base, actualStatus, durationMs, verdict: "verified", reason: "status and response shape match" };
}

function targetUrl(recorded: URL, baseUrl: string | undefined): string {
  if (!baseUrl) return recorded.href;
  const base = new URL(baseUrl);
  const prefix = base.pathname.replace(/\/$/, "");
  return `${base.origin}${prefix}${recorded.pathname}${recorded.search}`;
}

function replayHeaders(call: ApiCall): Headers {
  const headers = new Headers();
  for (const { name, value } of call.requestHeaders) {
    const lower = name.toLowerCase();
    if (lower.startsWith(":") || DROPPED_HEADERS.has(lower)) continue;
    headers.append(name, value);
  }
  return headers;
}

export function explainStatus(expected: number, actual: number): string {
  const prefix = `expected ${expected}, got ${actual}`;
  if (actual === 401 || actual === 403) return `${prefix}: session expired or not authorized; record a fresh capture`;
  if (actual === 404) return `${prefix}: resource not found; the recorded record may no longer exist`;
  if (actual === 429) return `${prefix}: rate limited; retry with a larger --delay`;
  if (actual >= 300 && actual < 400) return `${prefix}: redirected, often to a login page; record a fresh capture`;
  if (actual >= 500) return `${prefix}: server error`;
  return prefix;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause;
    return cause instanceof Error ? `${error.message} (${cause.message})` : error.message;
  }
  return String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
