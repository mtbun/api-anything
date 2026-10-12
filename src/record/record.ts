import type { Browser, BrowserContext, Page } from "playwright";

// Opens a browser, lets the user (or a script) work in the system, and saves
// the traffic as a HAR file when the browser is closed. Replaces exporting a
// HAR by hand from DevTools.

export interface RecordOptions {
  url: string;
  outPath: string;
  // Record traffic from every host, not only the system's own domain.
  allOrigins?: boolean;
  headless?: boolean;
  // "chrome" or "msedge" uses the installed browser; otherwise Playwright's Chromium.
  channel?: string;
  // Drives the page instead of a human, then the recording ends. Used by
  // tests and scripted captures.
  run?: (page: Page) => Promise<void>;
  onReady?: () => void;
}

export interface RecordResult {
  outPath: string;
  urlFilter: string;
}

export async function recordSession(options: RecordOptions): Promise<RecordResult> {
  const { chromium } = await loadPlaywright();
  const start = new URL(options.url);
  const urlFilter = options.allOrigins ? /.*/ : sameSiteFilter(start.hostname);

  const browser = await launch(chromium, options);
  let context: BrowserContext | undefined;
  try {
    context = await browser.newContext({
      recordHar: { path: options.outPath, content: "embed", mode: "full", urlFilter },
    });
    const page = await context.newPage();
    await page.goto(start.href);
    options.onReady?.();

    if (options.run) {
      await options.run(page);
    } else {
      await untilClosed(browser, context);
    }
  } finally {
    // Closing the context is what writes the HAR file.
    if (context) await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
  return { outPath: options.outPath, urlFilter: urlFilter.source };
}

// Matches the start host and its sibling subdomains: starting at
// erp.acme.com also records api.acme.com, but not analytics or CDNs on
// other domains. Single-label intranet hosts match only themselves.
export function sameSiteFilter(hostname: string): RegExp {
  const labels = hostname.split(".");
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
  const site = isIp || labels.length <= 2 ? hostname : labels.slice(-2).join(".");
  const escaped = site.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^https?://([^/?#]*\\.)?${escaped}(:\\d+)?([/?#]|$)`, "i");
}

function untilClosed(browser: Browser, context: BrowserContext): Promise<void> {
  return new Promise((resolve) => {
    const done = () => resolve();
    // The user closed the last tab or the whole browser window.
    context.on("close", done);
    browser.on("disconnected", done);
    context.on("page", (page) => page.on("close", () => context.pages().length === 0 && done()));
    for (const page of context.pages()) page.on("close", () => context.pages().length === 0 && done());
    // Ctrl+C in the terminal ends the recording and still saves the file.
    process.once("SIGINT", done);
  });
}

async function launch(chromium: typeof import("playwright").chromium, options: RecordOptions): Promise<Browser> {
  try {
    return await chromium.launch({ headless: options.headless ?? false, channel: options.channel });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/Executable doesn't exist|browserType\.launch/.test(message) && !options.channel) {
      throw new Error(
        "no browser available for recording. Run 'npx playwright install chromium', or use your installed Chrome with --channel chrome",
      );
    }
    throw error;
  }
}

async function loadPlaywright(): Promise<typeof import("playwright")> {
  try {
    return await import("playwright");
  } catch {
    throw new Error("recording needs Playwright: run 'npm install playwright'");
  }
}
