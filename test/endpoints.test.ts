import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { analyzeHar, inferSchema, mergeSchemas, parseBody, templatePath } from "../src/index.ts";

const FIXTURE = fileURLToPath(new URL("./fixtures/erp-session.har", import.meta.url));

test("templatePath replaces identifiers and names them after the collection", () => {
  assert.equal(templatePath("/api/v1/orders/1042"), "/api/v1/orders/{orderId}");
  assert.equal(templatePath("/api/v1/orders/1042/lines"), "/api/v1/orders/{orderId}/lines");
  assert.equal(
    templatePath("/api/v1/customers/3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b/invoices"),
    "/api/v1/customers/{customerId}/invoices",
  );
  assert.equal(templatePath("/api/v1/categories/7"), "/api/v1/categories/{categoryId}");
  assert.equal(templatePath("/reports/2026-10-01"), "/reports/{reportId}");
  // Short words and version markers are literals, not identifiers.
  assert.equal(templatePath("/api/v2/orders"), "/api/v2/orders");
  assert.equal(templatePath("/items/1/2"), "/items/{itemId}/{id}");
});

test("analyzeHar keeps application calls and drops pages and assets", async () => {
  const endpoints = await analyzeHar(FIXTURE);
  assert.deepEqual(
    endpoints.map((e) => `${e.method} ${e.pathTemplate}`),
    [
      "GET /api/v1/customers/{customerId}/invoices",
      "GET /api/v1/orders",
      "POST /api/v1/orders",
      "GET /api/v1/orders/{orderId}",
    ],
  );
});

test("calls to the same operation are merged", async () => {
  const endpoints = await analyzeHar(FIXTURE);
  const byId = endpoints.find((e) => e.method === "GET" && e.pathTemplate === "/api/v1/orders/{orderId}")!;
  assert.equal(byId.callCount, 2);
  assert.deepEqual(byId.responses.map((r) => r.status), [200, 404]);
});

test("query parameters seen on every call are required, others optional", async () => {
  const endpoints = await analyzeHar(FIXTURE);
  const list = endpoints.find((e) => e.method === "GET" && e.pathTemplate === "/api/v1/orders")!;
  assert.deepEqual(
    list.queryParameters.map((p) => [p.name, p.required]),
    [["page", true], ["sort", false], ["status", true]],
  );
});

test("response schemas merge across calls; a field missing in one call is optional", async () => {
  const endpoints = await analyzeHar(FIXTURE);
  const list = endpoints.find((e) => e.method === "GET" && e.pathTemplate === "/api/v1/orders")!;
  const item = list.responses[0]!.body!.properties!.items!.items!;
  assert.deepEqual(item.required, ["createdAt", "customer", "id", "total"]);
  assert.ok(item.properties!.note, "optional field is still described");
  assert.equal(item.properties!.total!.type, "number", "integer + decimal samples widen to number");
  assert.equal(item.properties!.createdAt!.format, "date-time");
});

test("request bodies and base64 response bodies are decoded", async () => {
  const endpoints = await analyzeHar(FIXTURE);
  const create = endpoints.find((e) => e.method === "POST")!;
  assert.deepEqual(create.requestBody!.required, ["customer", "lines"]);
  assert.deepEqual(create.responses.map((r) => r.status), [201]);

  const invoices = endpoints.find((e) => e.pathTemplate.endsWith("/invoices"))!;
  assert.equal(invoices.responses[0]!.body!.items!.properties!.dueDate!.format, "date");
});

test("parseBody handles JSON, forms and raw text", () => {
  assert.deepEqual(parseBody('{"a":1}', "application/json"), { a: 1 });
  assert.deepEqual(parseBody("a=1&b=x", "application/x-www-form-urlencoded"), { a: "1", b: "x" });
  assert.equal(parseBody("plain", "text/plain"), "plain");
  assert.equal(parseBody("", "application/json"), undefined);
});

test("mergeSchemas unions types", () => {
  const merged = mergeSchemas(inferSchema("x"), inferSchema(null));
  assert.deepEqual(merged.type, ["null", "string"]);
});
