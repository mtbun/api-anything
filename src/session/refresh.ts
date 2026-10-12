import { chmod } from "node:fs/promises";
import { SESSION_HEADER } from "../credentials.ts";
import type { Session } from "./session.ts";

// Gets a fresh session without storing a password: opens the system headless
// from a browser state the user saved after logging in once (record
// --save-state), lets the web app load, and collects the cookies and
// credential headers it uses. The login request itself is never replayed.

export interface RefreshOptions {
  // A page of the system that loads data, e.g. its start page.
  url: string;
  statePath: string;
  // Extra time to let the app finish its first API calls.
  settleMs?: number;
  channel?: string;
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

export async function refreshSession(options: RefreshOptions): Promise<Session> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true, channel: options.channel });
  try {
    const context = await browser.newContext({ storageState: options.statePath });
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

    const landed = new URL(page.url());
    if (landed.pathname !== start.pathname && LOGIN_PAGE.test(landed.pathname + landed.search)) {
      throw new SessionExpiredError(page.url());
    }

    const origins: Session["origins"] = {};
    const seen = new Set([start.origin, ...headers.keys()]);
    for (const origin of seen) {
      const cookies = await context.cookies(origin);
      const entry: Record<string, string> = { ...headers.get(origin) };
      if (cookies.length > 0) entry.cookie = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
      if (Object.keys(entry).length > 0) origins[origin] = entry;
    }
    if (Object.keys(origins).length === 0) throw new SessionExpiredError(page.url());

    // Cookies may have been rotated while loading; keep the state current.
    await context.storageState({ path: options.statePath });
    await chmod(options.statePath, 0o600);
    return { createdAt: new Date().toISOString(), origins };
  } finally {
    await browser.close().catch(() => {});
  }
}

// A response that means the session is gone rather than the request being wrong.
export function looksUnauthenticated(status: number, location?: string): boolean {
  if (status === 401 || status === 419 || status === 440) return true;
  if (status === 403) return true;
  return status >= 300 && status < 400 && location !== undefined && LOGIN_PAGE.test(location);
}
