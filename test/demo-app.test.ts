import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { startDemoApp } from "../examples/demo-app/server.ts";
import {
  callOperation,
  extractApiCalls,
  extractSession,
  findDependencies,
  groupEndpoints,
  loadHar,
  loadRecordScript,
  recordSession,
  toOpenApi,
} from "../src/index.ts";

// Keeps the demo in the README working: records the demo app with its
// script and checks what the README and the demo GIF show.
const STEPS = fileURLToPath(new URL("../examples/demo-app/steps.ts", import.meta.url));

test("the demo app records into the operations the README shows", { skip: !existsSync(chromium.executablePath()) && "Chromium not installed" }, async () => {
  const server = startDemoApp(0);
  await new Promise<void>((resolve) => server.on("listening", () => resolve()));
  try {
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const outPath = join(await mkdtemp(join(tmpdir(), "api-anything-demo-")), "demo.har");
    await recordSession({ url: origin, outPath, headless: true, run: await loadRecordScript(STEPS) });

    const calls = extractApiCalls(await loadHar(outPath));
    const doc = toOpenApi(groupEndpoints(calls), { dependencies: findDependencies(calls) });
    const ids = Object.values(doc.paths).flatMap((item) => Object.values(item).map((op) => op.operationId)).sort();
    assert.deepEqual(ids, ["getEmployee", "listEmployees", "listLeaveRequests", "login"]);

    const session = extractSession(calls);
    assert.deepEqual(session.lifetimes!.map((l) => [l.name, l.serverDecides ?? false]), [["sid", false]]);

    const result = await callOperation(doc, { operationId: "listEmployees", params: { status: "active" }, session });
    assert.equal(result.status, 200);
    assert.equal(JSON.parse(result.body).items[0].name, "Ada Demo");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
