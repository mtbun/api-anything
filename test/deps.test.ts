import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { authSources, extractApiCalls, findDependencies, groupEndpoints, loadHar, toOpenApi } from "../src/index.ts";

const LOGIN_FLOW = fileURLToPath(new URL("./fixtures/login-flow.har", import.meta.url));

async function load() {
  const calls = extractApiCalls(await loadHar(LOGIN_FLOW));
  return { calls, deps: findDependencies(calls) };
}

const describe = (d: { from: { operation: string; location: string }; to: { operation: string; location: string }; count: number }) =>
  `${d.from.operation} ${d.from.location} -> ${d.to.operation} ${d.to.location} x${d.count}`;

test("credentials from the login response are traced to every later call", async () => {
  const { deps } = await load();
  assert.deepEqual(
    deps.filter((d) => d.kind === "auth").map(describe).sort(),
    [
      "POST /api/login response.body:$.token -> GET /api/v1/orders request.header:authorization x1",
      "POST /api/login response.body:$.token -> GET /api/v1/orders/{orderId} request.header:authorization x2",
      "POST /api/login response.body:$.token -> POST /api/v1/notes request.header:authorization x1",
      "POST /api/login response.cookie:sid -> GET /api/v1/orders request.cookie:sid x1",
      "POST /api/login response.cookie:sid -> GET /api/v1/orders/{orderId} request.cookie:sid x2",
      "POST /api/login response.cookie:sid -> POST /api/v1/notes request.cookie:sid x1",
    ],
  );
});

test("IDs from a list response are traced into paths and request bodies", async () => {
  const { deps } = await load();
  assert.deepEqual(deps.filter((d) => d.kind === "data").map(describe), [
    "GET /api/v1/orders response.body:$.items[*].id -> GET /api/v1/orders/{orderId} request.path:orderId x2",
    "GET /api/v1/orders response.body:$.items[*].id -> POST /api/v1/notes request.body:$.orderId x1",
  ]);
});

test("small values do not create coincidental links and credentials are masked", async () => {
  const { deps } = await load();
  assert.ok(!deps.some((d) => d.to.location === "request.query:page"), "page=1 is not traced to page: 1 in a response");
  for (const d of deps.filter((x) => x.kind === "auth")) {
    assert.ok(!d.example.includes("2b9f4c1e8d7a") && !d.example.includes("77aa21"), `credential leaked in ${d.example}`);
  }
});

test("authSources names what to repeat to log in again", async () => {
  const { deps } = await load();
  assert.deepEqual(
    authSources(deps).map((s) => `${s.operation} ${s.location}`).sort(),
    ["POST /api/login response.body:$.token", "POST /api/login response.cookie:sid"],
  );
});

test("an operation never depends on itself", async () => {
  const { deps } = await load();
  assert.ok(deps.every((d) => d.from.endpoint !== d.to.endpoint));
});

test("OpenAPI export turns data flow into links and marks the credential source", async () => {
  const { calls, deps } = await load();
  const doc = toOpenApi(groupEndpoints(calls), { dependencies: deps });

  const list = doc.paths["/api/v1/orders"]!.get!;
  assert.deepEqual(list.responses["200"]!.links!.getOrder!.parameters, { orderId: "$response.body#/items/0/id" });
  assert.equal(list.responses["200"]!.links!.getOrder!.operationId, "getOrder");
  assert.equal(list.responses["200"]!.links!.createNote, undefined, "body values are not expressed as parameter links");

  const login = doc.paths["/api/login"]!.post!;
  assert.deepEqual(login["x-api-anything"].providesAuth, ["response.body:$.token", "response.cookie:sid"]);
  assert.equal(list["x-api-anything"].providesAuth, undefined);
});
