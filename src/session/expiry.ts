import type { ApiCall } from "../har/parse.ts";
import type { Session } from "./session.ts";

// How long the saved credentials last. Cookies say so with Expires or
// Max-Age, JWTs with their exp claim. A cookie with neither lives until the
// browser closes, and the app usually ends it on the server after some idle
// time that cannot be read from the outside.

export interface CredentialLifetime {
  origin: string;
  // Cookie name or header name; never the value.
  name: string;
  kind: "cookie" | "token";
  // ISO time when the credential stops working, when it is known.
  expiresAt?: string;
  // A cookie without Expires or Max-Age: the server decides, often after minutes of inactivity.
  serverDecides?: boolean;
}

export function credentialLifetimes(calls: ApiCall[], session: Session): CredentialLifetime[] {
  const setCookies = latestSetCookies(calls);
  const out: CredentialLifetime[] = [];
  for (const [origin, headers] of Object.entries(session.origins)) {
    for (const [header, value] of Object.entries(headers)) {
      if (header === "cookie") {
        for (const pair of value.split(";")) {
          const name = pair.split("=")[0]?.trim();
          const set = name ? setCookies.get(name) : undefined;
          if (!name || !set) continue;
          out.push({ origin, name, kind: "cookie", ...cookieExpiry(set.line, set.at) });
        }
      } else {
        const exp = jwtExpiry(value.replace(/^bearer\s+/i, ""));
        if (exp) out.push({ origin, name: header, kind: "token", expiresAt: exp });
      }
    }
  }
  return out;
}

// From the attributes of one Set-Cookie line, received at `at`.
export function cookieExpiry(line: string, at: Date): { expiresAt?: string; serverDecides?: boolean } {
  const attributes = line.split(";").slice(1).map((a) => a.trim());
  const maxAge = attributes.find((a) => /^max-age=/i.test(a));
  if (maxAge) {
    const seconds = Number(maxAge.split("=")[1]);
    if (Number.isFinite(seconds)) return { expiresAt: new Date(at.getTime() + seconds * 1000).toISOString() };
  }
  const expires = attributes.find((a) => /^expires=/i.test(a));
  if (expires) {
    const date = new Date(expires.slice(expires.indexOf("=") + 1));
    if (!Number.isNaN(date.getTime())) return { expiresAt: date.toISOString() };
  }
  return { serverDecides: true };
}

// The exp claim of a JWT, without verifying it: only the time is needed.
export function jwtExpiry(token: string): string | undefined {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[0]!.startsWith("eyJ")) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as { exp?: unknown };
    return typeof payload.exp === "number" ? new Date(payload.exp * 1000).toISOString() : undefined;
  } catch {
    return undefined;
  }
}

// One line per credential, for the terminal.
export function describeLifetime(l: CredentialLifetime, now = new Date()): string {
  if (l.serverDecides) {
    return `${l.name} (cookie): no expiry date; the app ends it after a period of inactivity, often minutes`;
  }
  if (!l.expiresAt) return `${l.name} (${l.kind}): expiry unknown`;
  const minutes = Math.round((Date.parse(l.expiresAt) - now.getTime()) / 60_000);
  const when = minutes <= 0 ? "expired" : minutes < 120 ? `in ${minutes} min` : minutes < 2880 ? `in ${Math.round(minutes / 60)} h` : `in ${Math.round(minutes / 1440)} days`;
  return `${l.name} (${l.kind}): ${minutes <= 0 ? "expired at" : "expires"} ${l.expiresAt} (${when})`;
}

// Short-lived sessions are worth a hint: a "remember me" login usually
// issues a cookie that lasts days or weeks.
export function isShortLived(lifetimes: CredentialLifetime[], now = new Date()): boolean {
  return lifetimes.some((l) => l.serverDecides || (l.expiresAt !== undefined && Date.parse(l.expiresAt) - now.getTime() < 24 * 3_600_000));
}

export function expiredCredentials(session: Session | undefined, origin: string, now = new Date()): CredentialLifetime[] {
  return (session?.lifetimes ?? []).filter((l) => l.origin === origin && l.expiresAt !== undefined && Date.parse(l.expiresAt) <= now.getTime());
}

function latestSetCookies(calls: ApiCall[]): Map<string, { line: string; at: Date }> {
  const found = new Map<string, { line: string; at: Date }>();
  for (const call of calls) {
    const at = call.startedAt ? new Date(call.startedAt) : new Date();
    for (const { name, value } of call.responseHeaders) {
      if (name.toLowerCase() !== "set-cookie") continue;
      for (const line of value.split("\n")) {
        const cookie = line.split("=")[0]?.trim();
        if (cookie) found.set(cookie, { line, at });
      }
    }
  }
  return found;
}
