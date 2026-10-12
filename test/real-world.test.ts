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

test("numbered hosts of one service are one origin family", async () => {
  const { originFamily } = await import("../src/endpoints/normalize.ts");
  assert.equal(originFamily(new URL("https://t5-in-1.algolia.example.test/1/isalive")), "https://*.algolia.example.test");
  assert.equal(originFamily(new URL("https://eu-3.api.example.test:8443/x")), "https://*.api.example.test:8443");
  assert.equal(originFamily(new URL("https://api.example.test/x")), "https://api.example.test");
  assert.equal(originFamily(new URL("https://node1.test/x")), "https://node1.test", "two labels: nothing to share");
  assert.equal(originFamily(new URL("http://10.0.0.5/x")), "http://10.0.0.5");
});

test("an operation served by several numbered hosts is one operation with alternate servers", () => {
  const call = (host: string) => ({
    method: "GET",
    url: new URL(`https://${host}/1/isalive?probe=1`),
    requestHeaders: [],
    requestBody: undefined,
    requestBodyText: undefined,
    requestMimeType: undefined,
    status: 200,
    responseHeaders: [],
    responseBody: { ok: true },
    responseMimeType: "application/json",
    startedAt: undefined,
  });
  const calls = [call("t5-in-1.search.example.test"), call("t32-usw-1.search.example.test"), call("t32-usw-1.search.example.test")];
  const endpoints = groupEndpoints(calls);
  assert.equal(endpoints.length, 1);
  assert.equal(endpoints[0]!.origin, "https://t32-usw-1.search.example.test", "the most-called host leads");
  assert.deepEqual(endpoints[0]!.alternateOrigins, ["https://t5-in-1.search.example.test"]);
  assert.equal(endpoints[0]!.callCount, 3);

  const doc = toOpenApi(endpoints);
  assert.deepEqual(doc.paths["/1/isalive"]!.get!.servers, [
    { url: "https://t32-usw-1.search.example.test" },
    { url: "https://t5-in-1.search.example.test" },
  ]);
});

test("RPC-style paths are named by their verb, and the verb decides read or write", () => {
  // From a real HR portal that names operations get-..., calculate-..., not REST resources.
  assert.equal(operationIdFor("GET", "/api/get-pto-history"), "getPtoHistory");
  assert.equal(operationIdFor("GET", "/api/home-office/get-form-approval-dates"), "getHomeOfficeFormApprovalDates");
  assert.equal(operationIdFor("GET", "/api/announcements/get-announcements"), "getAnnouncements");
  assert.equal(operationIdFor("GET", "/api/work-place/get"), "getWorkPlace");
  assert.equal(operationIdFor("GET", "/api/sick-leave/calculate-work-days"), "calculateSickLeaveWorkDays");
  assert.equal(operationIdFor("POST", "/api/items/save-draft"), "saveItemDraft");
  assert.equal(operationIdFor("GET", "/api/v1/orders"), "listOrders", "REST paths keep REST names");

  assert.ok(!isReadOperation("GET", "/api/items/delete-item"), "a GET that deletes is a write");
  assert.ok(!isReadOperation("GET", "/api/forms/submitForm"));
  assert.ok(isReadOperation("POST", "/api/reports/get-summary"), "a POST that gets is a read");
  assert.ok(isReadOperation("GET", "/api/work-place/my-today"));
  assert.ok(!isReadOperation("POST", "/api/items"));
});

test("SignalR negotiate handshakes are noise", async () => {
  const { isNoise } = await import("../src/index.ts");
  assert.ok(isNoise(new URL("https://app.example.test/api/hubs/presence/negotiate?negotiateVersion=1")));
  assert.ok(!isNoise(new URL("https://app.example.test/api/contracts/negotiate")), "a business 'negotiate' without the handshake parameter stays");
});

test("hostile values in a capture stay fast and harmless", async () => {
  const { inferSchema, renderTypeScript, renderPython, extractApiCalls } = await import("../src/index.ts");
  // Patterns CodeQL flagged as slow regular expressions on crafted input.
  let started = performance.now();
  inferSchema("!@!." + "!.".repeat(50_000));
  assert.ok(performance.now() - started < 500, "email format check is linear");

  const model = {
    title: "t", server: "https://a.example.test",
    operations: [{ name: "op", method: "GET", path: "/" + "{{|".repeat(20_000), server: "https://a.example.test", summary: "s", writes: false, pathParams: [], queryParams: [], credentialQuery: [] }],
  };
  started = performance.now();
  renderTypeScript(model);
  renderPython(model);
  assert.ok(performance.now() - started < 500, "path placeholder replacement is linear");

  const har = { log: { entries: [{ request: { method: "__proto__", url: "https://a.example.test/api/x", headers: [] }, response: { status: 200, headers: [], content: { mimeType: "application/json", text: "{}" } } }] } };
  assert.deepEqual(extractApiCalls(har), [], "non-standard methods are not API calls");

  const [endpoint] = groupEndpoints(extractApiCalls(await loadHar(FIXTURE)));
  const doc = toOpenApi([{ ...endpoint!, method: "__proto__" }]);
  assert.deepEqual(doc.paths, {}, "endpoints passed in by library callers are checked too");
  const odd = toOpenApi([{ ...endpoint!, pathTemplate: "__proto__" }]);
  assert.ok(Object.hasOwn(odd.paths, "__proto__"), "any path template is kept as a plain key");
  assert.equal(({} as Record<string, unknown>).get, undefined);
});
