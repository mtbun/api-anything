import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  analyzeHar,
  buildUrl,
  callOperation,
  extractApiCalls,
  extractSession,
  listOperations,
  loadHar,
  loadSession,
  parseCallArgs,
  saveSession,
  toOpenApi,
  type OpenApiDocument,
} from "../src/index.ts";

const FIXTURE = fileURLToPath(new URL("./fixtures/erp-session.har", import.meta.url));

const received: { method: string; url: string; cookie?: string; csrf?: string; contentType?: string; body: string }[] = [];
let server: Server;
let baseUrl: string;
let doc: OpenApiDocument;

before(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      received.push({
        method: req.method!,
        url: req.url!,
        cookie: req.headers.cookie,
        csrf: req.headers["x-csrf-token"] as string | undefined,
        contentType: req.headers["content-type"],
        body,
      });
      const status = req.url!.includes("9999") ? 404 : req.method === "POST" ? 201 : 200;
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: status < 300, path: req.url }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  doc = toOpenApi(await analyzeHar(FIXTURE));
});

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

test("extractSession keeps cookies and tokens, takes the latest values, drops other headers", async () => {
  const session = extractSession(extractApiCalls(await loadHar(FIXTURE)));
  assert.deepEqual(session.origins, {
    "https://erp.example.test": { cookie: "sid=fake-session-123", "x-csrf-token": "csrf-fake-456" },
  });
});

test("saveSession writes a private file that loadSession reads back", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "api-anything-")), "nested", "session.json");
  const session = extractSession(extractApiCalls(await loadHar(FIXTURE)));
  await saveSession(session, path);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.deepEqual(await loadSession(path), JSON.parse(await readFile(path, "utf8")));
  assert.equal(await loadSession(join(tmpdir(), "does-not-exist.json")), undefined);
});

test("listOperations describes every operation with its parameters", () => {
  const ops = listOperations(doc);
  assert.deepEqual(ops.map((o) => o.operationId), ["createOrder", "getOrder", "listCustomerInvoices", "listOrders"]);
  const list = ops.find((o) => o.operationId === "listOrders")!;
  // status was "open" on every observed call, so it becomes an optional parameter with that default.
  assert.deepEqual(list.parameters.map((p) => `${p.name}:${p.required}:${p.default ?? ""}`), ["page:true:", "sort:false:", "status:false:open"]);
  assert.equal(ops.find((o) => o.operationId === "createOrder")!.writes, true);
});

test("buildUrl fills path and query parameters", () => {
  assert.equal(buildUrl(doc, "getOrder", { orderId: "1042" }), "https://erp.example.test/api/v1/orders/1042");
  assert.equal(
    buildUrl(doc, "listOrders", { status: "closed", page: "2" }, "https://staging.example.test/"),
    "https://staging.example.test/api/v1/orders?page=2&status=closed",
  );
  assert.equal(buildUrl(doc, "listOrders", { page: "2" }), "https://erp.example.test/api/v1/orders?page=2&status=open", "defaults fill in");
  assert.equal(
    buildUrl(doc, "listOrders", { page: "1", sort: "date desc&x" }),
    "https://erp.example.test/api/v1/orders?page=1&sort=date+desc%26x&status=open",
    "values are URL-encoded",
  );
});

test("buildUrl rejects missing, unknown and misspelled parameters with guidance", () => {
  assert.throws(() => buildUrl(doc, "listOrders", { status: "open" }), /listOrders needs --page/);
  assert.throws(() => buildUrl(doc, "listOrders", { status: "open", page: "1", stauts: "x" }), /no parameter --stauts\. Valid: page, sort, status/);
  assert.throws(() => buildUrl(doc, "listOrdrs", {}), /unknown operation "listOrdrs"\. Available: createOrder/);
});

test("callOperation sends the saved session to the system", async () => {
  received.length = 0;
  const session = extractSession(extractApiCalls(await loadHar(FIXTURE)));
  const result = await callOperation(doc, { operationId: "listOrders", params: { status: "open", page: "1" }, baseUrl, session });
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.body), { ok: true, path: "/api/v1/orders?page=1&status=open" });
  assert.equal(received[0]!.cookie, "sid=fake-session-123");
  assert.equal(received[0]!.csrf, "csrf-fake-456");
});

test("callOperation refuses writes unless allowed, then sends the body", async () => {
  received.length = 0;
  const request = { operationId: "createOrder", params: {}, baseUrl, body: '{"customer":"ACME"}' };
  await assert.rejects(callOperation(doc, request), /createOrder is a POST and changes data; pass --allow-writes/);
  assert.equal(received.length, 0, "nothing is sent when a write is refused");

  const result = await callOperation(doc, { ...request, allowWrites: true });
  assert.equal(result.status, 201);
  assert.equal(received[0]!.contentType, "application/json");
  assert.equal(received[0]!.body, '{"customer":"ACME"}');
});

test("callOperation requires a body when the operation has one", async () => {
  await assert.rejects(
    callOperation(doc, { operationId: "createOrder", params: {}, baseUrl, allowWrites: true }),
    /needs a request body/,
  );
});

test("callOperation reports non-2xx responses instead of throwing", async () => {
  const result = await callOperation(doc, { operationId: "getOrder", params: { orderId: "9999" }, baseUrl });
  assert.equal(result.status, 404);
  assert.equal(result.ok, false);
});

test("parseCallArgs separates parameters from call options", () => {
  assert.deepEqual(
    parseCallArgs(["--status", "open", "--page=2", "-p", "body=x", "--body", "@order.json", "--session", "s.json", "--base-url", "http://h", "--allow-writes"]),
    { params: { status: "open", page: "2", body: "x" }, body: "@order.json", sessionPath: "s.json", baseUrl: "http://h", allowWrites: true },
  );
  assert.throws(() => parseCallArgs(["--status"]), /--status needs a value/);
  assert.throws(() => parseCallArgs(["open"]), /unexpected argument: open/);
});

test("call rejects a value that does not fit the observed type, before sending", () => {
  assert.throws(() => buildUrl(doc, "getOrder", { orderId: "abc" }), /--orderId must be an integer, got "abc"/);
  assert.throws(() => buildUrl(doc, "listOrders", { page: "two" }), /--page must be an integer/);
  const ops = listOperations(doc);
  assert.equal(ops.find((o) => o.operationId === "listCustomerInvoices")!.parameters[0]!.type, "uuid", "ops shows the format");
});
