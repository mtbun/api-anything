import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import {
  analyzeHar,
  callOperation,
  extractApiCalls,
  extractSession,
  findDependencies,
  groupEndpoints,
  isReadOperation,
  listOperations,
  loadHar,
  operationIdFor,
  templatePath,
  toOpenApi,
} from "../src/index.ts";

// Patterns seen when recording real web apps: a versioned search API with
// the API key in the query string, analytics and bot-challenge traffic, and
// requests that were aborted before an answer.
const FIXTURE = fileURLToPath(new URL("./fixtures/search-app.har", import.meta.url));
const KEY = "fakeKey0123456789abcdef";

test("analytics, telemetry, bot challenges and unanswered requests are left out", async () => {
  const ops = await analyzeHar(FIXTURE);
  assert.deepEqual(ops.map((e) => `${e.method} ${e.pathTemplate} ${e.callCount}`), [
    "POST /1/indexes/Item_dev/query 2",
    "GET /1/items/{itemId} 2",
    "POST /api/login 1",
    "POST /api/v2/exports 1",
  ]);
  const all = await analyzeHar(FIXTURE, { keepNoise: true });
  assert.ok(all.some((e) => e.origin === "https://www.google-analytics.com"), "--keep-noise keeps them");
  assert.ok(all.every((e) => e.responses.every((r) => r.status > 0)), "unanswered requests are dropped even with --keep-noise");
});

test("path templates keep API versions and template long tokens", () => {
  assert.equal(templatePath("/1/items/40000001"), "/1/items/{itemId}");
  assert.equal(templatePath("/api/2/orders/15"), "/api/2/orders/{orderId}");
  assert.equal(
    templatePath("/fo/3470092412:1791781507:oUi8291RHMNx9zXCHSele5k0pbgEaV/808bYRvOkU_79cnGnpNb8R_Gnut-1791787854-1.2.1.1-agTUrUs"),
    "/fo/{foId}/{id}",
  );
});

test("POST actions are named after the action and searches count as reads", () => {
  assert.equal(operationIdFor("POST", "/1/indexes/Item_dev/query"), "queryIndexItemDev");
  assert.equal(operationIdFor("POST", "/api/login"), "login");
  assert.equal(operationIdFor("POST", "/api/v2/exports"), "createExport");
  assert.equal(operationIdFor("GET", "/api/indexes"), "listIndexes");
  assert.equal(operationIdFor("GET", "/api/indexes/{indexId}"), "getIndex");

  assert.ok(isReadOperation("POST", "/1/indexes/Item_dev/query"));
  assert.ok(isReadOperation("POST", "/api/search"));
  assert.ok(!isReadOperation("POST", "/api/login"));
  assert.ok(!isReadOperation("POST", "/api/v2/exports"));
  assert.ok(!isReadOperation("DELETE", "/api/items/{itemId}"));
});

test("an API key in the query string is a credential, never a parameter or an example", async () => {
  const calls = extractApiCalls(await loadHar(FIXTURE));
  const [query] = groupEndpoints(calls);
  const key = query!.queryParameters.find((p) => p.name === "x-algolia-api-key")!;
  assert.equal(key.credential, true);
  assert.deepEqual(key.examples, []);

  const doc = toOpenApi(groupEndpoints(calls), { dependencies: findDependencies(calls) });
  const json = JSON.stringify(doc);
  assert.ok(!json.includes(KEY), "the key does not appear anywhere in the OpenAPI document");
  const op = doc.paths["/1/indexes/Item_dev/query"]!.post!;
  assert.deepEqual(op["x-api-anything"].credentialQuery, ["x-algolia-api-key"]);
  assert.ok(!op.parameters!.some((p) => p.name === "x-algolia-api-key"));

  assert.deepEqual(extractSession(calls).query, { "https://search.example.test": { "x-algolia-api-key": KEY } });
});

test("values the app always sends become defaults, so callers only pass real inputs", async () => {
  const doc = toOpenApi(await analyzeHar(FIXTURE));
  const params = doc.paths["/1/indexes/Item_dev/query"]!.post!.parameters!;
  assert.deepEqual(
    params.map((p) => [p.name, p.required, p.schema.default]),
    [["x-algolia-agent", false, "Search (4.0)"], ["x-algolia-application-id", false, "APPID123"]],
  );
  const listed = listOperations(doc).find((o) => o.operationId === "queryIndexItemDev")!;
  assert.equal(listed.writes, false, "a search is not a write");
});

test("call adds defaults and the session's API key, and runs a search without --allow-writes", async () => {
  const seen: string[] = [];
  const server = createServer((req, res) => {
    seen.push(req.url!);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ hits: [] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const calls = extractApiCalls(await loadHar(FIXTURE));
    const doc = toOpenApi(groupEndpoints(calls));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const result = await callOperation(doc, {
      operationId: "queryIndexItemDev",
      params: {},
      body: '{"query":"rust"}',
      baseUrl,
      session: extractSession(calls),
    });
    assert.equal(result.status, 200);
    const url = new URL(seen[0]!, baseUrl);
    assert.equal(url.searchParams.get("x-algolia-application-id"), "APPID123");
    assert.equal(url.searchParams.get("x-algolia-api-key"), KEY);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
