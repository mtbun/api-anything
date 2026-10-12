import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { analyzeHar, operationIdFor, toOpenApi } from "../src/index.ts";

const FIXTURE = fileURLToPath(new URL("./fixtures/erp-session.har", import.meta.url));

test("operationIdFor follows REST naming", () => {
  assert.equal(operationIdFor("GET", "/api/v1/orders"), "listOrders");
  assert.equal(operationIdFor("GET", "/api/v1/orders/{orderId}"), "getOrder");
  assert.equal(operationIdFor("POST", "/api/v1/orders"), "createOrder");
  assert.equal(operationIdFor("PATCH", "/api/v1/orders/{orderId}"), "updateOrder");
  assert.equal(operationIdFor("DELETE", "/api/v1/orders/{orderId}"), "deleteOrder");
  assert.equal(operationIdFor("GET", "/api/v1/customers/{customerId}/invoices"), "listCustomerInvoices");
  assert.equal(operationIdFor("GET", "/"), "listRoot");
});

test("toOpenApi produces a 3.1 document with one server and every operation", async () => {
  const doc = toOpenApi(await analyzeHar(FIXTURE), { title: "Example ERP" });
  assert.equal(doc.openapi, "3.1.0");
  assert.equal(doc.info.title, "Example ERP");
  assert.deepEqual(doc.servers, [{ url: "https://erp.example.test" }]);
  assert.deepEqual(Object.keys(doc.paths).sort(), [
    "/api/v1/customers/{customerId}/invoices",
    "/api/v1/orders",
    "/api/v1/orders/{orderId}",
  ]);
  assert.deepEqual(Object.keys(doc.paths["/api/v1/orders"]!).sort(), ["get", "post"]);
});

test("operation IDs are unique", async () => {
  const doc = toOpenApi(await analyzeHar(FIXTURE));
  const ids = Object.values(doc.paths).flatMap((item) => Object.values(item).map((op) => op.operationId));
  assert.equal(new Set(ids).size, ids.length);
});

test("path parameters are typed from observed values", async () => {
  const doc = toOpenApi(await analyzeHar(FIXTURE));
  const [orderId] = doc.paths["/api/v1/orders/{orderId}"]!.get!.parameters!;
  assert.deepEqual(orderId, { name: "orderId", in: "path", required: true, schema: { type: "integer", examples: [1042, 9999] } });

  const [customerId] = doc.paths["/api/v1/customers/{customerId}/invoices"]!.get!.parameters!;
  assert.equal(customerId!.schema.format, "uuid");
});

test("query parameters, request bodies and responses are carried over", async () => {
  const doc = toOpenApi(await analyzeHar(FIXTURE));
  const list = doc.paths["/api/v1/orders"]!.get!;
  assert.deepEqual(
    list.parameters!.map((p) => [p.name, p.in, p.required, p.schema.type, p.schema.default]),
    [["page", "query", true, "integer", undefined], ["sort", "query", false, "string", undefined], ["status", "query", false, "string", "open"]],
  );
  assert.equal(list["x-api-anything"].observedCalls, 2);

  const create = doc.paths["/api/v1/orders"]!.post!;
  assert.ok(create.requestBody!.content["application/json"]!.schema.properties!.lines);

  const get = doc.paths["/api/v1/orders/{orderId}"]!.get!;
  assert.deepEqual(Object.keys(get.responses), ["200", "404"]);
  assert.equal(get.responses["404"]!.description, "Not Found");
});

test("operations on a secondary origin get their own server", () => {
  const base = { queryParameters: [], responses: [{ status: 200, count: 1 }], examplePaths: [] };
  const doc = toOpenApi([
    { ...base, id: "a", origin: "https://erp.example.test", method: "GET", pathTemplate: "/a", callCount: 5 },
    { ...base, id: "b", origin: "https://files.example.test", method: "GET", pathTemplate: "/b", callCount: 1 },
  ]);
  assert.deepEqual(doc.servers, [{ url: "https://erp.example.test" }]);
  assert.equal(doc.paths["/a"]!.get!.servers, undefined);
  assert.deepEqual(doc.paths["/b"]!.get!.servers, [{ url: "https://files.example.test" }]);
});
