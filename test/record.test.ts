import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync } from "node:fs";
import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { analyzeHar, loadRecordScript, recordSession, sameSiteFilter } from "../src/index.ts";

// A tiny web app: a page whose script calls its own API, plus a call to a
// different host that the default filter must leave out.
const PAGE = `<!doctype html><html><body>
<button id="load">Load</button><button id="save">Save</button>
<script>
  document.getElementById("load").onclick = () => fetch("/api/items?status=open").then(r => r.json());
  document.getElementById("save").onclick = () =>
    fetch("/api/items", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "bolt" }) });
  fetch(location.origin.replace("127.0.0.1", "localhost") + "/api/elsewhere").catch(() => {});
</script></body></html>`;

let server: Server;
let origin: string;
const cookiesSeen: (string | undefined)[] = [];
const browserInstalled = existsSync(chromium.executablePath());

before(async () => {
  server = createServer((req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    if (req.url === "/") {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(PAGE);
    }
    if (req.url === "/login") {
      res.writeHead(200, { "content-type": "text/html", "set-cookie": "sid=logged-in; Path=/" });
      return res.end("<p>welcome</p>");
    }
    if (req.url === "/api/me") {
      cookiesSeen.push(req.headers.cookie);
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ user: req.headers.cookie?.includes("sid=logged-in") ? "alice" : null }));
    }
    res.writeHead(req.method === "POST" ? 201 : 200, { "content-type": "application/json" });
    res.end(JSON.stringify(req.method === "POST" ? { id: 7 } : { items: [{ id: 1, name: "nut" }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

test("sameSiteFilter records the system's domain and its subdomains only", () => {
  const filter = sameSiteFilter("erp.acme.com");
  assert.ok(filter.test("https://erp.acme.com/api/orders"));
  assert.ok(filter.test("https://api.acme.com:8443/v1"));
  assert.ok(!filter.test("https://www.google-analytics.com/collect"));
  assert.ok(!filter.test("https://acme.com.evil.test/x"));

  const intranet = sameSiteFilter("erp");
  assert.ok(intranet.test("http://erp/orders"));
  assert.ok(!intranet.test("http://erp-backup/orders"));

  const ip = sameSiteFilter("10.0.0.5");
  assert.ok(ip.test("http://10.0.0.5:8080/api"));
  assert.ok(!ip.test("http://10.0.0.50/api"));
});

test("recordSession captures the app's API calls into a HAR that analyze understands", { skip: !browserInstalled && "Chromium not installed (npx playwright install chromium)" }, async () => {
  const outPath = join(await mkdtemp(join(tmpdir(), "api-anything-")), "capture.har");
  await recordSession({
    url: origin,
    outPath,
    headless: true,
    run: async (page) => {
      await page.click("#load");
      await page.waitForResponse((r) => r.url().includes("/api/items?"));
      await page.click("#save");
      await page.waitForResponse((r) => r.request().method() === "POST");
    },
  });

  const endpoints = await analyzeHar(outPath);
  assert.deepEqual(
    endpoints.map((e) => `${e.method} ${e.pathTemplate} ${e.responses.map((r) => r.status).join(",")}`),
    ["GET /api/items 200", "POST /api/items 201"],
  );
  const post = endpoints.find((e) => e.method === "POST")!;
  assert.deepEqual(post.requestBody!.required, ["name"]);
  assert.ok(endpoints.every((e) => e.origin === origin), "calls to other hosts are not recorded");
});

const skip = !browserInstalled && "Chromium not installed (npx playwright install chromium)";

test("a login saved with saveStatePath is reused by a later headless run", { skip }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "api-anything-"));
  const statePath = join(dir, "state.json");

  await recordSession({
    url: `${origin}/login`,
    outPath: join(dir, "login.har"),
    headless: true,
    saveStatePath: statePath,
    run: async () => {},
  });
  assert.equal((await stat(statePath)).mode & 0o777, 0o600);

  cookiesSeen.length = 0;
  await recordSession({
    url: origin,
    outPath: join(dir, "work.har"),
    headless: true,
    storageStatePath: statePath,
    run: async (page) => {
      await page.evaluate(() => fetch("/api/me").then((r) => r.json()));
    },
  });
  assert.ok(cookiesSeen.some((c) => c?.includes("sid=logged-in")), "the saved session cookie is sent");
  const ops = await analyzeHar(join(dir, "work.har"));
  assert.ok(ops.some((e) => e.pathTemplate === "/api/me"));
});

test("loadRecordScript runs an agent-written script file", { skip }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "api-anything-"));
  const script = join(dir, "steps.ts");
  await writeFile(
    script,
    `export default async (page: any, { url }: { url: string }) => {
      if (!url.startsWith("http")) throw new Error("url not passed");
      await page.evaluate(() => fetch("/api/items?status=open").then((r) => r.json()));
    };\n`,
  );
  const outPath = join(dir, "capture.har");
  await recordSession({ url: origin, outPath, headless: true, run: await loadRecordScript(script) });
  const ops = await analyzeHar(outPath);
  assert.ok(ops.some((e) => e.method === "GET" && e.pathTemplate === "/api/items"));
});

test("loadRecordScript rejects a file without a default function", async () => {
  const dir = await mkdtemp(join(tmpdir(), "api-anything-"));
  const script = join(dir, "bad.ts");
  await writeFile(script, "export const x = 1;\n");
  await assert.rejects(loadRecordScript(script), /must default-export an async function/);
});
