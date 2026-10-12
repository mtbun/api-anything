import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  cookieExpiry,
  credentialLifetimes,
  describeLifetime,
  expiredCredentials,
  extractApiCalls,
  extractSession,
  findDependencies,
  isShortLived,
  jwtExpiry,
  loadHar,
  type ApiCall,
  type Session,
} from "../src/index.ts";

const LOGIN_FLOW = fileURLToPath(new URL("./fixtures/login-flow.har", import.meta.url));
const AT = new Date("2026-10-12T09:00:00.000Z");

function fakeJwt(exp: number): string {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${part({ alg: "HS256", typ: "JWT" })}.${part({ sub: "fake", exp })}.signature`;
}

test("cookieExpiry reads Max-Age, then Expires, and marks cookies without either", () => {
  assert.deepEqual(cookieExpiry("sid=x; Path=/; Max-Age=1800; HttpOnly", AT), { expiresAt: "2026-10-12T09:30:00.000Z" });
  assert.deepEqual(cookieExpiry("sid=x; Expires=Wed, 21 Oct 2026 07:28:00 GMT", AT), { expiresAt: "2026-10-21T07:28:00.000Z" });
  assert.deepEqual(cookieExpiry("sid=x; Path=/; Secure; HttpOnly", AT), { serverDecides: true });
});

test("jwtExpiry reads the exp claim and ignores tokens that are not JWTs", () => {
  assert.equal(jwtExpiry(fakeJwt(1_791_800_000)), new Date(1_791_800_000 * 1000).toISOString());
  assert.equal(jwtExpiry("tok_fake_2b9f4c1e8d7a"), undefined);
  assert.equal(jwtExpiry("eyJ.not-json.x"), undefined);
});

test("the saved session records how long each credential lasts, never the value", async () => {
  const session = extractSession(extractApiCalls(await loadHar(LOGIN_FLOW)));
  assert.deepEqual(session.lifetimes, [
    { origin: "https://erp.example.test", name: "sid", kind: "cookie", serverDecides: true },
  ]);
  assert.ok(!JSON.stringify(session.lifetimes).includes("sess_fake"));
});

test("a bearer JWT's expiry is found from the session headers", () => {
  const call: ApiCall = {
    method: "GET", url: new URL("https://app.example.test/api/me"), requestHeaders: [], requestBody: undefined,
    requestBodyText: undefined, requestMimeType: undefined, status: 200, responseHeaders: [], responseBody: {},
    responseMimeType: "application/json", startedAt: AT.toISOString(),
  };
  const session: Session = { createdAt: "", origins: { "https://app.example.test": { authorization: `Bearer ${fakeJwt(1_791_800_000)}` } } };
  assert.deepEqual(credentialLifetimes([call], session), [
    { origin: "https://app.example.test", name: "authorization", kind: "token", expiresAt: new Date(1_791_800_000 * 1000).toISOString() },
  ]);
});

test("lifetimes are described for people and short ones are flagged", () => {
  const now = new Date("2026-10-12T09:00:00.000Z");
  const soon = { origin: "o", name: "sid", kind: "cookie" as const, expiresAt: "2026-10-12T09:25:00.000Z" };
  const later = { origin: "o", name: "auth", kind: "cookie" as const, expiresAt: "2026-11-11T09:00:00.000Z" };
  const past = { origin: "o", name: "old", kind: "token" as const, expiresAt: "2026-10-12T08:00:00.000Z" };
  assert.equal(describeLifetime(soon, now), "sid (cookie): expires 2026-10-12T09:25:00.000Z (in 25 min)");
  assert.equal(describeLifetime(later, now), "auth (cookie): expires 2026-11-11T09:00:00.000Z (in 30 days)");
  assert.equal(describeLifetime(past, now), "old (token): expired at 2026-10-12T08:00:00.000Z (expired)");
  assert.match(describeLifetime({ origin: "o", name: "sid", kind: "cookie", serverDecides: true }), /no expiry date; the app ends it/);
  assert.ok(isShortLived([soon], now));
  assert.ok(!isShortLived([later], now));
  assert.deepEqual(expiredCredentials({ createdAt: "", origins: {}, lifetimes: [soon, later, past] }, "o", now), [past]);
});

test("dates shared by unrelated calls are not dependencies", () => {
  const call = (path: string, body: unknown, at: string): ApiCall => ({
    method: "GET", url: new URL(`https://app.example.test${path}`), requestHeaders: [], requestBody: undefined,
    requestBodyText: undefined, requestMimeType: undefined, status: 200, responseHeaders: [], responseBody: body,
    responseMimeType: "application/json", startedAt: at,
  });
  const deps = findDependencies([
    call("/api/weather", { daily: [{ date: "2026-10-12", periodNumber: 4242 }] }, "2026-10-12T09:00:00Z"),
    call("/api/timesheet?date=2026-10-12&periodNumber=4242", {}, "2026-10-12T09:00:01Z"),
  ]);
  assert.deepEqual(deps.map((d) => d.to.location), ["request.query:periodNumber"], "the ID is linked, the date is not");
});
