import { existsSync } from "node:fs";
import { chmod } from "node:fs/promises";
import type { Page } from "playwright";
import { SESSION_HEADER } from "../credentials.ts";
import type { Session } from "./session.ts";
import { jwtExpiry, type CredentialLifetime } from "./expiry.ts";

// Gets a fresh session without storing a password: opens the app from a
// browser state the user saved after logging in (record --save-state), lets
// the web app load, and collects the cookies and credential headers it uses.
// The login request itself is never replayed. When the saved login has ended
// and a person is at the keyboard, the browser is shown so they can log in;
// it closes by itself once the app is reached.

export interface RefreshOptions {
  // A page of the system that loads data, e.g. its start page.
  url: string;
  statePath: string;
  // Extra time to let the app finish its first API calls.
  settleMs?: number;
  channel?: string;
  // Show the browser and wait for a person to log in when the saved login
  // has ended, instead of failing.
  interactive?: boolean;
  // How long to wait for that login (default 5 minutes).
  loginTimeoutMs?: number;
  // Called when a login is needed; receives the page (tests log in through it).
  onLoginNeeded?: (page: Page) => void | Promise<void>;
  // Run without a window even when interactive (tests).
  headless?: boolean;
}

export class SessionExpiredError extends Error {
  constructor(url: string) {
    super(
      `the saved browser state is no longer logged in (ended at ${url}). ` +
        "Log in again with: api-anything record <url> --save-state <file>",
    );
    this.name = "SessionExpiredError";
  }
}

const LOGIN_PAGE = /log-?in|sign-?in|auth|sso|session\/new/i;

export class LoginTimeoutError extends Error {
  constructor() {
    super("no login within the time allowed; run the command again and log in in the browser window");
    this.name = "LoginTimeoutError";
  }
}

export async function refreshSession(options: RefreshOptions): Promise<Session> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: options.headless ?? !options.interactive, channel: options.channel });
  try {
    const context = await browser.newContext({
      storageState: existsSync(options.statePath) ? options.statePath : undefined,
    });
    const headers = new Map<string, Record<string, string>>();
    context.on("request", (request) => {
      void request.allHeaders().then((all) => {
        const origin = new URL(request.url()).origin;
        for (const [name, value] of Object.entries(all)) {
          if (name === "cookie" || name.startsWith(":") || !SESSION_HEADER.test(name)) continue;
          headers.set(origin, { ...headers.get(origin), [name]: value });
        }
      }).catch(() => {});
    });

    const page = await context.newPage();
    const start = new URL(options.url);
    await page.goto(start.href, { waitUntil: "networkidle" });
    if (options.settleMs) await page.waitForTimeout(options.settleMs);

    if (onLoginPage(page.url(), start)) {
      if (!options.interactive) throw new SessionExpiredError(page.url());
      await options.onLoginNeeded?.(page);
      try {
        await page.waitForURL((url) => !onLoginPage(url.href, start), { timeout: options.loginTimeoutMs ?? 300_000 });
      } catch {
        throw new LoginTimeoutError();
      }
      // Load the app again so its own API calls show which headers it sends.
      await page.goto(start.href, { waitUntil: "networkidle" });
      if (options.settleMs) await page.waitForTimeout(options.settleMs);
    }

    const origins: Session["origins"] = {};
    const lifetimes: CredentialLifetime[] = [];
    const seen = new Set([start.origin, ...headers.keys()]);
    for (const origin of seen) {
      const cookies = await context.cookies(origin);
      const entry: Record<string, string> = { ...headers.get(origin) };
      if (cookies.length > 0) entry.cookie = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
      if (Object.keys(entry).length > 0) origins[origin] = entry;
      for (const c of cookies) {
        // Playwright reports -1 for a cookie that lives until the browser closes.
        lifetimes.push(
          c.expires > 0
            ? { origin, name: c.name, kind: "cookie", expiresAt: new Date(c.expires * 1000).toISOString() }
            : { origin, name: c.name, kind: "cookie", serverDecides: true },
        );
      }
      for (const [name, value] of Object.entries(headers.get(origin) ?? {})) {
        const exp = jwtExpiry(value.replace(/^bearer\s+/i, ""));
        if (exp) lifetimes.push({ origin, name, kind: "token", expiresAt: exp });
      }
    }
    if (Object.keys(origins).length === 0) throw new SessionExpiredError(page.url());

    // Cookies may have been rotated while loading; keep the state current.
    await context.storageState({ path: options.statePath });
    await chmod(options.statePath, 0o600);
    const session: Session = { createdAt: new Date().toISOString(), origins };
    if (lifetimes.length > 0) session.lifetimes = lifetimes;
    return session;
  } finally {
    await browser.close().catch(() => {});
  }
}

function onLoginPage(current: string, start: URL): boolean {
  const landed = new URL(current);
  return landed.pathname !== start.pathname && LOGIN_PAGE.test(landed.pathname + landed.search);
}

// A response that means the session is gone rather than the request being wrong.
export function looksUnauthenticated(status: number, location?: string): boolean {
  if (status === 401 || status === 419 || status === 440) return true;
  if (status === 403) return true;
  return status >= 300 && status < 400 && location !== undefined && LOGIN_PAGE.test(location);
}
