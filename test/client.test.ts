import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  buildClientModel,
  extractApiCalls,
  extractSession,
  findDependencies,
  groupEndpoints,
  loadHar,
  renderPython,
  renderTypeScript,
  saveSession,
  toOpenApi,
  type OpenApiDocument,
} from "../src/index.ts";

const run = promisify(execFile);
const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const ROOT = fileURLToPath(new URL("..", import.meta.url));

// Records every request so the tests can check what the generated clients send.
const received: { method: string; url: string; cookie?: string; auth?: string; body: string }[] = [];
let server: Server;
let baseUrl: string;

before(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ method: req.method!, url: req.url!, cookie: req.headers.cookie, auth: req.headers.authorization, body });
      const status = req.url!.includes("9999") ? 404 : req.method === "POST" ? 201 : 200;
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(status === 404 ? { error: "not found" } : { ok: true, url: req.url }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

async function docFor(name: string): Promise<{ doc: OpenApiDocument; dir: string; sessionPath: string }> {
  const calls = extractApiCalls(await loadHar(fixture(name)));
  const doc = toOpenApi(groupEndpoints(calls), { dependencies: findDependencies(calls) });
  const dir = await mkdtemp(join(tmpdir(), "api-anything-client-"));
  const sessionPath = join(dir, "session.json");
  await saveSession(extractSession(calls), sessionPath);
  return { doc, dir, sessionPath };
}

test("the TypeScript client type-checks in strict mode", async () => {
  const { doc, dir } = await docFor("search-app.har");
  const file = join(dir, "client.ts");
  await writeFile(file, renderTypeScript(buildClientModel(doc)));
  await run(join(ROOT, "node_modules/.bin/tsc"), [
    "--noEmit", "--strict", "--skipLibCheck", "--target", "es2022", "--module", "nodenext",
    "--moduleResolution", "nodenext", "--types", "node", "--typeRoots", join(ROOT, "node_modules/@types"), file,
  ]);
});

test("the TypeScript client calls operations with session, defaults and credentials", async () => {
  const { doc, dir, sessionPath } = await docFor("search-app.har");
  const file = join(dir, "client.ts");
  await writeFile(file, renderTypeScript(buildClientModel(doc)));
  const { ApiClient, ApiError } = await import(pathToFileURL(file).href);

  received.length = 0;
  const client = await ApiClient.fromSessionFile(sessionPath, { baseUrl });

  await client.queryIndexItemDev({}, { query: "rust", hitsPerPage: 5 });
  const url = new URL(received[0]!.url, baseUrl);
  assert.equal(received[0]!.method, "POST");
  assert.equal(url.pathname, "/1/indexes/Item_dev/query");
  assert.equal(url.searchParams.get("x-algolia-application-id"), "APPID123", "default filled in");
  assert.equal(url.searchParams.get("x-algolia-api-key"), "fakeKey0123456789abcdef", "credential from the session");
  assert.deepEqual(JSON.parse(received[0]!.body), { query: "rust", hitsPerPage: 5 });

  const item = await client.getItem({ itemId: 40000001 });
  assert.equal(item.url, "/1/items/40000001");
  await assert.rejects(client.getItem({ itemId: 9999 }), (e: unknown) => e instanceof ApiError && (e as { status: number }).status === 404);
});

test("the Python client runs on the standard library with session, defaults and credentials", async () => {
  const { doc, dir, sessionPath } = await docFor("search-app.har");
  await writeFile(join(dir, "client.py"), renderPython(buildClientModel(doc)));
  await writeFile(
    join(dir, "main.py"),
    `import json, sys
from client import ApiClient, ApiError
api = ApiClient.from_session_file(sys.argv[1], base_url=sys.argv[2])
print(json.dumps(api.query_index_item_dev({"query": "rust", "hitsPerPage": 5})))
print(json.dumps(api.get_item(40000001)))
try:
    api.get_item(9999)
except ApiError as e:
    print(json.dumps({"error": e.status}))
`,
  );
  received.length = 0;
  const { stdout } = await run("python3", [join(dir, "main.py"), sessionPath, baseUrl], { cwd: dir });
  const lines = stdout.trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines[1].url, "/1/items/40000001");
  assert.deepEqual(lines[2], { error: 404 });

  const url = new URL(received[0]!.url, baseUrl);
  assert.equal(url.searchParams.get("x-algolia-application-id"), "APPID123");
  assert.equal(url.searchParams.get("x-algolia-api-key"), "fakeKey0123456789abcdef");
  assert.deepEqual(JSON.parse(received[0]!.body), { query: "rust", hitsPerPage: 5 });
});

test("both clients send session headers loaded from the session file", async () => {
  const { doc, dir, sessionPath } = await docFor("login-flow.har");
  const model = buildClientModel(doc);
  await writeFile(join(dir, "client.ts"), renderTypeScript(model));
  await writeFile(join(dir, "client.py"), renderPython(model));

  received.length = 0;
  const { ApiClient } = await import(pathToFileURL(join(dir, "client.ts")).href);
  await (await ApiClient.fromSessionFile(sessionPath, { baseUrl })).listOrders({ page: 1 });
  assert.equal(received[0]!.cookie, "sid=sess_fake_77aa21");
  assert.equal(received[0]!.auth, "Bearer tok_fake_2b9f4c1e8d7a");

  await writeFile(
    join(dir, "main.py"),
    `import sys
from client import ApiClient
ApiClient.from_session_file(sys.argv[1], base_url=sys.argv[2]).get_order(1042)
`,
  );
  await run("python3", [join(dir, "main.py"), sessionPath, baseUrl], { cwd: dir });
  assert.equal(received[1]!.url, "/api/v1/orders/1042");
  assert.equal(received[1]!.auth, "Bearer tok_fake_2b9f4c1e8d7a");
});
