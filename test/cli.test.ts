import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractApiCalls, loadHar } from "../src/index.ts";

// Runs the real command entry point, as a user or an agent would.
const BIN = fileURLToPath(new URL("../bin/api-anything.js", import.meta.url));
const FIXTURE = fileURLToPath(new URL("./fixtures/erp-session.har", import.meta.url));

async function cli(...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await promisify(execFile)("node", [BIN, ...args]);
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code: number; stdout: string; stderr: string };
    return { code: e.code, stdout: e.stdout, stderr: e.stderr };
  }
}

async function tmp(name: string, content: string): Promise<string> {
  const path = join(await mkdtemp(join(tmpdir(), "api-anything-cli-")), name);
  await writeFile(path, content);
  return path;
}

test("--version prints the package version", async () => {
  const pkg = JSON.parse(await readFile(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));
  const { code, stdout } = await cli("--version");
  assert.equal(code, 0);
  assert.equal(stdout.trim(), pkg.version);
});

test("--help works after any command", async () => {
  const { code, stdout } = await cli("call", "--help");
  assert.equal(code, 0);
  assert.match(stdout, /^api-anything — turn any web app into an API/);
});

test("a missing or non-JSON capture gives a readable error", async () => {
  const missing = await cli("analyze", "/does/not/exist.har");
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /^error: \/does\/not\/exist\.har does not exist/);

  const notJson = await cli("analyze", await tmp("bad.har", "hello"));
  assert.equal(notJson.code, 1);
  assert.match(notJson.stderr, /is not valid JSON; expected a HAR file/);
});

test("openapi refuses an empty capture with a hint instead of writing an empty document", async () => {
  const { code, stderr } = await cli("openapi", await tmp("empty.har", '{"log":{"entries":[]}}'));
  assert.equal(code, 1);
  assert.match(stderr, /no API calls found .* --keep-noise; .* --all-origins/);
});

test("a sparse HAR without headers or content does not crash the analysis", async () => {
  const path = await tmp(
    "sparse.har",
    JSON.stringify({
      log: {
        entries: [
          { request: { method: "POST", url: "https://a.example.test/api/items" }, response: { status: 201 } },
          { request: { method: "GET" }, response: { status: 200 } },
          { request: { method: "GET", url: "https://a.example.test/api/items/12" } },
        ],
      },
    }),
  );
  const calls = extractApiCalls(await loadHar(path));
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url.pathname} ${c.status}`), ["POST /api/items 201"]);
});

test("call rejects an invalid JSON body before sending and names an unreachable host", async () => {
  const doc = await tmp("api.json", "");
  await cli("openapi", FIXTURE, "--out", doc);

  const badBody = await cli("call", doc, "createOrder", "--body", "{bad", "--allow-writes");
  assert.equal(badBody.code, 1);
  assert.match(badBody.stderr, /the body for createOrder is not valid JSON/);

  const unreachable = await cli("call", doc, "getOrder", "--orderId", "1", "--base-url", "http://127.0.0.1:9");
  assert.equal(unreachable.code, 1);
  assert.match(unreachable.stderr, /^error: could not reach http:\/\/127\.0\.0\.1:9: /);
});
