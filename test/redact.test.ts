import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  extractApiCalls,
  findDependencies,
  groupEndpoints,
  inferSchema,
  loadHar,
  recordSession,
  redactHar,
  toOpenApi,
  type Har,
} from "../src/index.ts";

// Found by recording a real HR portal: the login request's password became
// an example value in the OpenAPI document.
const LOGIN_FLOW = fileURLToPath(new URL("./fixtures/login-flow.har", import.meta.url));
const PASSWORD = "fake-password-do-not-leak";
const TOKEN = "tok_fake_2b9f4c1e8d7a";
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlIn0.c2lnbmF0dXJl";

test("inferSchema keeps no example for credential fields or JWTs", () => {
  const schema = inferSchema({ email: "a@example.test", password: "pw-123456", accessToken: "abc123456", nested: { apiKey: "k-987654", note: JWT } });
  assert.deepEqual(schema.properties!.email!.examples, ["a@example.test"]);
  assert.equal(schema.properties!.password!.examples, undefined);
  assert.equal(schema.properties!.password!.type, "string", "the field is still described");
  assert.equal(schema.properties!.accessToken!.examples, undefined);
  assert.equal(schema.properties!.nested!.properties!.apiKey!.examples, undefined);
  assert.equal(schema.properties!.nested!.properties!.note!.examples, undefined);
});

test("the OpenAPI document never contains the login password or the issued token", async () => {
  const calls = extractApiCalls(await loadHar(LOGIN_FLOW));
  const doc = toOpenApi(groupEndpoints(calls), { dependencies: findDependencies(calls) });
  const json = JSON.stringify(doc);
  assert.ok(!json.includes(PASSWORD), "password leaked");
  assert.ok(!json.includes(TOKEN), "token leaked");
  const login = doc.paths["/api/login"]!.post!;
  assert.deepEqual(Object.keys(login.requestBody!.content["application/json"]!.schema.properties!).sort(), ["password", "username"]);
});

test("--no-examples leaves no example value or example path in the document", async () => {
  const calls = extractApiCalls(await loadHar(LOGIN_FLOW));
  const doc = toOpenApi(groupEndpoints(calls), { examples: false });
  const json = JSON.stringify(doc);
  assert.ok(!json.includes('"examples"'));
  assert.ok(Object.values(doc.paths).every((item) => Object.values(item).every((op) => op["x-api-anything"].examplePaths.length === 0)));
  assert.ok(!json.includes("ACME"), "response values are gone too");
});

test("redactHar masks secrets in JSON, form and params bodies and leaves the rest", () => {
  const entry = (text: string, mimeType: string, params?: { name: string; value: string }[]) => ({
    request: { method: "POST", url: "https://a.example.test/login", headers: [], postData: { mimeType, text, ...(params ? { params } : {}) } },
    response: { status: 200, headers: [], content: {} },
  });
  const har: Har = {
    log: {
      entries: [
        entry(JSON.stringify({ email: "a@example.test", password: "pw1", mfa: { otp: "123456" } }), "application/json"),
        entry("username=demo&password=pw2", "application/x-www-form-urlencoded", [{ name: "password", value: "pw2" }]),
        entry("plain text with password=pw3", "text/plain"),
      ],
    },
  };
  assert.equal(redactHar(har), 4);
  assert.deepEqual(JSON.parse(har.log.entries[0]!.request.postData!.text!), { email: "a@example.test", password: "[redacted]", mfa: { otp: "[redacted]" } });
  assert.equal(har.log.entries[1]!.request.postData!.text, "username=demo&password=%5Bredacted%5D");
  assert.equal(har.log.entries[1]!.request.postData!.params![0]!.value, "[redacted]");
  assert.equal(har.log.entries[2]!.request.postData!.text, "plain text with password=pw3", "non-structured bodies are untouched");
  assert.equal(redactHar(har), 0, "redacting twice changes nothing");
});

test("record masks a typed password and writes the capture with mode 600", { skip: !existsSync(chromium.executablePath()) && "Chromium not installed" }, async () => {
  const server = createServer((req, res) => {
    if (req.url === "/") {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end("<p>login</p>");
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const outPath = join(await mkdtemp(join(tmpdir(), "api-anything-")), "capture.har");
    const result = await recordSession({
      url: origin,
      outPath,
      headless: true,
      run: async (page) => {
        await page.evaluate((pw) =>
          fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "a@example.test", password: pw }) }),
        PASSWORD);
      },
    });
    assert.equal(result.redacted, 1);
    const text = await readFile(outPath, "utf8");
    assert.ok(!text.includes(PASSWORD), "password written to disk");
    assert.ok(text.includes("[redacted]"));
    assert.equal((await stat(outPath)).mode & 0o777, 0o600);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
