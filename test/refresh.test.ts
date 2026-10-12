import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync } from "node:fs";
import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import {
  callOperation,
  LoginTimeoutError,
  looksUnauthenticated,
  recordSession,
  refreshSession,
  SessionExpiredError,
  type OpenApiDocument,
  type Session,
} from "../src/index.ts";

// A system that sends people without a session to /login, and whose start
// page calls its API with a CSRF header.
let server: Server;
let origin: string;
const skip = !existsSync(chromium.executablePath()) && "Chromium not installed (npx playwright install chromium)";

before(async () => {
  server = createServer((req, res) => {
    const loggedIn = req.headers.cookie?.includes("sid=good") ?? false;
    if (req.url === "/login") {
      res.writeHead(200, { "content-type": "text/html", "set-cookie": "sid=good; Path=/" });
      return res.end('<p>logged in</p><a id="enter" href="/">Enter</a>');
    }
    if (req.url === "/") {
      if (!loggedIn) {
        res.writeHead(302, { location: "/login" });
        return res.end();
      }
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(`<script>fetch("/api/data", { headers: { "X-CSRF-Token": "csrf-fresh-123" } })</script>`);
    }
    if (req.url === "/api/data") {
      res.writeHead(loggedIn ? 200 : 401, { "content-type": "application/json" });
      return res.end(JSON.stringify(loggedIn ? { rows: [1, 2] } : { error: "unauthenticated" }));
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

async function loggedInState(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "api-anything-"));
  const statePath = join(dir, "state.json");
  await recordSession({ url: `${origin}/login`, outPath: join(dir, "login.har"), headless: true, saveStatePath: statePath, run: async () => {} });
  return statePath;
}

function docFor(): OpenApiDocument {
  return {
    openapi: "3.1.0",
    info: { title: "test", version: "1" },
    servers: [{ url: origin }],
    paths: {
      "/api/data": {
        get: { operationId: "getData", summary: "GET /api/data", responses: { "200": { description: "OK" } }, "x-api-anything": { observedCalls: 1, examplePaths: [] } },
      },
    },
  };
}

test("looksUnauthenticated recognises expired sessions but not ordinary errors", () => {
  assert.ok(looksUnauthenticated(401));
  assert.ok(looksUnauthenticated(403));
  assert.ok(looksUnauthenticated(302, "/login?next=/orders"));
  assert.ok(looksUnauthenticated(302, "https://sso.example.test/auth"));
  assert.ok(!looksUnauthenticated(302, "/orders/2"));
  assert.ok(!looksUnauthenticated(404));
  assert.ok(!looksUnauthenticated(500));
});

test("refreshSession collects cookies and credential headers from a saved login", { skip }, async () => {
  const statePath = await loggedInState();
  const session = await refreshSession({ url: `${origin}/`, statePath });
  assert.deepEqual(session.origins[origin], { cookie: "sid=good", "x-csrf-token": "csrf-fresh-123" });
  assert.equal((await stat(statePath)).mode & 0o777, 0o600);
});

test("refreshSession reports a state that is no longer logged in", { skip }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "api-anything-"));
  const statePath = join(dir, "empty.json");
  await writeFile(statePath, JSON.stringify({ cookies: [], origins: [] }));
  await assert.rejects(refreshSession({ url: `${origin}/`, statePath }), SessionExpiredError);
});

test("callOperation refreshes an expired session once and retries", { skip }, async () => {
  const statePath = await loggedInState();
  const stale: Session = { createdAt: "", origins: { [origin]: { cookie: "sid=stale" } } };

  const without = await callOperation(docFor(), { operationId: "getData", params: {}, session: stale });
  assert.equal(without.status, 401);
  assert.equal(without.refreshedSession, undefined);

  let refreshes = 0;
  const result = await callOperation(docFor(), {
    operationId: "getData",
    params: {},
    session: stale,
    refresh: () => {
      refreshes += 1;
      return refreshSession({ url: `${origin}/`, statePath });
    },
  });
  assert.equal(refreshes, 1);
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.body), { rows: [1, 2] });
  assert.equal(result.refreshedSession!.origins[origin]!.cookie, "sid=good");
});

test("a valid session is not refreshed", async () => {
  const good: Session = { createdAt: "", origins: { [origin]: { cookie: "sid=good" } } };
  const result = await callOperation(docFor(), {
    operationId: "getData",
    params: {},
    session: good,
    refresh: () => {
      throw new Error("refresh must not be called");
    },
  });
  assert.equal(result.status, 200);
});

test("an interactive refresh waits for a person to log in, then collects the fresh session", { skip }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "api-anything-"));
  const statePath = join(dir, "state.json");
  await writeFile(statePath, JSON.stringify({ cookies: [], origins: [] }));

  let asked = 0;
  const session = await refreshSession({
    url: `${origin}/`,
    statePath,
    interactive: true,
    headless: true,
    // Stands in for the person: the login page sets the cookie, then they continue to the app.
    onLoginNeeded: async (page) => {
      asked += 1;
      await page.click("#enter");
    },
  });
  assert.equal(asked, 1);
  assert.deepEqual(session.origins[origin], { cookie: "sid=good", "x-csrf-token": "csrf-fresh-123" });
  assert.equal((await stat(statePath)).mode & 0o777, 0o600, "the new login is saved for next time");
});

test("an interactive refresh gives up with a clear error when nobody logs in", { skip }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "api-anything-"));
  await assert.rejects(
    refreshSession({ url: `${origin}/`, statePath: join(dir, "missing.json"), interactive: true, headless: true, loginTimeoutMs: 1500 }),
    LoginTimeoutError,
  );
});
