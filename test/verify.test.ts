import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { explainStatus, extractApiCalls, loadHar, validateAgainst, verifyCalls, inferSchema } from "../src/index.ts";

const FIXTURE = fileURLToPath(new URL("./fixtures/erp-session.har", import.meta.url));

// A stand-in for the recorded ERP. Each route can be switched to simulate
// the ways a live system diverges from a capture.
let mode: "healthy" | "expired" | "drifted" = "healthy";
const received: { method: string; url: string; cookie?: string; body: string }[] = [];
let server: Server;
let baseUrl: string;

before(async () => {
  server = createServer(async (req, res) => {
    const body = await readBody(req);
    received.push({ method: req.method!, url: req.url!, cookie: req.headers.cookie, body });
    const json = (status: number, value: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(value));
    };
    if (mode === "expired") return json(401, { error: "session expired" });

    const url = new URL(req.url!, "http://localhost");
    if (url.pathname === "/api/v1/orders" && req.method === "GET") {
      if (mode === "drifted") return json(200, { items: [{ id: "1042", customer: "ACME" }], page: 1 });
      return json(200, { items: [{ id: 1042, customer: "ACME", total: 1250.5, createdAt: "2026-10-01T09:30:00Z", extra: true }], page: 1 });
    }
    if (url.pathname === "/api/v1/orders/1042") return json(200, { id: 1042, lines: [{ sku: "A-1", qty: 2 }] });
    if (url.pathname === "/api/v1/orders" && req.method === "POST") return json(201, { id: 1045 });
    if (url.pathname.endsWith("/invoices")) return json(200, [{ number: "INV-001", dueDate: "2026-11-01" }]);
    return json(404, { error: "not found" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

async function run(options: { allowWrites?: boolean } = {}) {
  received.length = 0;
  const calls = extractApiCalls(await loadHar(FIXTURE));
  return verifyCalls(calls, { baseUrl, ...options });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
  });
}

test("a healthy system verifies every read operation and skips writes", async () => {
  mode = "healthy";
  const results = await run();
  const byOp = Object.fromEntries(results.map((r) => [r.operation, r.verdict]));
  assert.deepEqual(byOp, {
    "GET /api/v1/customers/{customerId}/invoices": "verified",
    "GET /api/v1/orders": "verified",
    "POST /api/v1/orders": "skipped",
    "GET /api/v1/orders/{orderId}": "verified",
  });
  assert.ok(received.every((r) => r.method === "GET"), "no write request is sent without --allow-writes");
});

test("the successful recorded call is replayed, not the 404 one", async () => {
  mode = "healthy";
  await run();
  assert.ok(received.some((r) => r.url === "/api/v1/orders/1042"));
  assert.ok(!received.some((r) => r.url === "/api/v1/orders/9999"));
});

test("an expired session fails with an actionable reason", async () => {
  mode = "expired";
  const results = await run();
  const failed = results.filter((r) => r.verdict === "failed");
  assert.equal(failed.length, 3);
  assert.match(failed[0]!.reason, /expected 200, got 401: session expired/);
});

test("a changed response shape is reported as drift with the differences", async () => {
  mode = "drifted";
  const results = await run();
  const list = results.find((r) => r.operation === "GET /api/v1/orders")!;
  assert.equal(list.verdict, "drifted");
  assert.deepEqual(
    list.issues!.map((i) => `${i.path}: ${i.message}`),
    [
      "$.items[0].createdAt: missing required field",
      "$.items[0].total: missing required field",
      "$.items[0].id: expected integer, got string",
    ],
  );
});

test("--allow-writes replays the recorded body", async () => {
  mode = "healthy";
  const results = await run({ allowWrites: true });
  assert.equal(results.find((r) => r.operation === "POST /api/v1/orders")!.verdict, "verified");
  const post = received.find((r) => r.method === "POST")!;
  assert.deepEqual(JSON.parse(post.body), { customer: "ACME", lines: [{ sku: "A-1", qty: 1 }] });
});

test("an unreachable system fails without throwing", async () => {
  const calls = extractApiCalls(await loadHar(FIXTURE));
  const results = await verifyCalls(calls, { baseUrl: "http://127.0.0.1:9", timeoutMs: 2000 });
  assert.ok(results.filter((r) => r.verdict !== "skipped").every((r) => r.verdict === "failed" && r.reason.startsWith("unreachable")));
});

test("validateAgainst allows extra fields and widens integer to number", () => {
  const schema = inferSchema({ a: 1.5, b: "x" });
  assert.deepEqual(validateAgainst({ a: 2, b: "y", c: true }, schema), []);
  assert.deepEqual(validateAgainst({ a: "2" }, schema).map((i) => i.path), ["$.b", "$.a"]);
});

test("explainStatus names the likely cause", () => {
  assert.match(explainStatus(200, 302), /login page/);
  assert.match(explainStatus(200, 429), /--delay/);
  assert.match(explainStatus(200, 503), /server error/);
});
