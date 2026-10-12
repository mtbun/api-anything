import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  analyzeHar,
  DEFAULT_STATE_PATH,
  SessionExpiredError,
  describeLifetime,
  expiredCredentials,
  isShortLived,
  type Session,
  redactHarFile,
  buildClientModel,
  renderPython,
  renderTypeScript,
  refreshSession,
  authSources,
  findDependencies,
  groupEndpoints,
  loadRecordScript,
  callOperation,
  DEFAULT_SESSION_PATH,
  extractApiCalls,
  extractSession,
  listOperations,
  loadHar,
  loadOpenApi,
  loadSession,
  saveSession,
  toOpenApi,
  parseCallArgs,
  recordSession,
  verifyCalls,
  type VerificationResult,
} from "./index.ts";

const USAGE = `api-anything — turn any web app into an API

Usage:
  api-anything record  <url> [--out <capture.har>] [--all-origins] [--channel chrome|msedge]
                       [--script <file>] [--headless|--headed] [--state <file>] [--save-state <file>]
  api-anything analyze <capture.har> [--json]
  api-anything openapi <capture.har> [--out <file>] [--title <title>] [--version <version>] [--no-examples]
  api-anything redact  <capture.har>
  api-anything verify  <capture.har> [--base-url <url>] [--allow-writes] [--delay <ms>] [--json]
  api-anything deps    <capture.har> [--json]
  api-anything session <capture.har> [--out <file>]
  api-anything ops     <openapi.json> [--json]
  api-anything call    <openapi.json> <operationId> [--<param> <value>]... [--body <json|@file>]
                       [--session <file>] [--base-url <url>] [--allow-writes]
                       [--refresh-state <file>] [--refresh-url <url>] [--no-interactive]
  api-anything refresh <url> [--state <file>] [--interactive] [--out <session.json>]
  api-anything client  <openapi.json> --lang ts|py [--out <file>]

Commands:
  record    Open a browser at <url>, use the app as usual, then close the
            browser: the session is saved as a HAR file (default capture.har).
            Only the app's own domain is recorded unless --all-origins.
            --script runs a file that default-exports async (page, { url }) =>
            {...} instead of waiting for a person; it runs headless unless
            --headed. --save-state keeps the login (cookies, storage) in a
            private file and --state starts from it, so a person logs in once
            and scripts reuse the session.
  analyze   List the API operations found in a HAR capture. Analytics,
            telemetry and bot-challenge traffic is left out unless
            --keep-noise (also accepted by openapi, deps and verify).
  openapi   Write an OpenAPI 3.1 document describing the operations.
            Credential values are never included; --no-examples also leaves
            out every example value, for sharing the document.
  redact    Mask passwords and other secret fields in a HAR exported by hand
            and make it private (mode 600). 'record' does this itself.
  verify    Replay one recorded call per operation against the live app and
            report each as verified, drifted, failed or skipped. Only reads are
            replayed unless --allow-writes is set. Exit code 2 if anything
            failed or drifted.
  deps      Show which values flow from one call's response into later
            calls: credentials (token, cookie) and data (IDs). Also shows
            which operation to repeat to log in again.
  session   Save the session headers (cookies, tokens) from a capture to
            ${DEFAULT_SESSION_PATH} (mode 600) for use by 'call'.
  ops       List the operations in an OpenAPI document with their parameters.
  call      Call one operation. Parameters are passed as --<name> <value>
            (or -p <name>=<value>). The response body goes to stdout; JSON is
            pretty-printed. Writes need --allow-writes. Exit code 2 on a
            non-2xx response. An expired session is renewed from the saved
            browser login (${DEFAULT_STATE_PATH} or --refresh-state) and the
            call retried once; if that login has ended too and a person is at
            the terminal, a browser opens for them to log in.
            --no-interactive never opens one.
  client    Generate a single-file client with one typed method per
            operation: TypeScript (fetch) or Python (standard library).
            Both can load the session file. Prints to stdout unless --out.
  refresh   Open <url> headless from the saved browser login and write a
            fresh session file. With --interactive, a browser opens for a
            person to log in when needed and closes by itself afterwards.
            No password is stored or replayed.
`;

async function main(argv: string[]): Promise<number> {
  const [command, file, ...rest] = argv;
  if (command === "--version" || command === "-v") {
    const pkg = JSON.parse(await readFile(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")) as { version: string };
    process.stdout.write(`${pkg.version}\n`);
    return 0;
  }
  if (command === undefined || argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(USAGE);
    return command === undefined ? 1 : 0;
  }
  if (!file) {
    process.stderr.write(USAGE);
    return 1;
  }

  switch (command) {
    case "record":
      return record(file, parseFlags(rest));
    case "analyze":
      return analyze(file, parseFlags(rest));
    case "redact":
      return redact(file);
    case "openapi":
      return openapi(file, parseFlags(rest));
    case "verify":
      return verify(file, parseFlags(rest));
    case "deps":
      return deps(file, parseFlags(rest));
    case "session":
      return session(file, parseFlags(rest));
    case "ops":
      return ops(file, parseFlags(rest));
    case "call":
      return call(file, rest);
    case "refresh":
      return refresh(file, parseFlags(rest));
    case "client":
      return client(file, parseFlags(rest));
    default:
      process.stderr.write(USAGE);
      return 1;
  }
}

async function record(url: string, flags: Flags): Promise<number> {
  const outPath = flags.out ?? "capture.har";
  const run = flags.script ? await loadRecordScript(flags.script) : undefined;
  const result = await recordSession({
    url,
    outPath,
    allOrigins: flags.allOrigins,
    channel: flags.channel,
    headless: flags.headless ?? (run !== undefined && !flags.headed),
    run,
    storageStatePath: flags.state,
    saveStatePath: flags.saveState,
    onReady: () =>
      process.stderr.write(
        run
          ? `Recording while ${flags.script} runs.\n`
          : `Recording. Use the app in the browser window, then close the window (or press Ctrl+C here) to save.\n`,
      ),
  });
  if (flags.saveState) process.stderr.write(`Saved browser state to ${flags.saveState} (private; reuse it with --state).\n`);
  reportLifetimes(extractSession(extractApiCalls(await loadHar(outPath))));
  process.stderr.write(
    `Saved ${outPath} (mode 600${result.redacted > 0 ? `, ${result.redacted} password or secret field(s) masked` : ""}). ` +
      `It contains your session cookies: keep it private.\n\n` +
      `Next:\n  api-anything analyze ${outPath}\n  api-anything openapi ${outPath} --out openapi.json\n  api-anything session ${outPath}\n`,
  );
  return 0;
}

async function redact(file: string): Promise<number> {
  const count = await redactHarFile(file);
  process.stderr.write(`Masked ${count} secret field(s) in ${file}; the file is now private (mode 600).\n`);
  return 0;
}

async function analyze(file: string, flags: Flags): Promise<number> {
  const endpoints = await analyzeHar(file, { keepNoise: flags.keepNoise });
  if (flags.json) {
    process.stdout.write(JSON.stringify(endpoints, null, 2) + "\n");
    return 0;
  }
  if (endpoints.length === 0) {
    process.stdout.write("No API calls found in this capture.\n");
    return 0;
  }
  for (const e of endpoints) {
    const statuses = e.responses.map((r) => r.status).join(",");
    process.stdout.write(`${e.method.padEnd(6)} ${e.origin}${e.pathTemplate}  calls=${e.callCount} status=${statuses}\n`);
  }
  process.stdout.write(`\n${endpoints.length} operations\n`);
  return 0;
}

async function openapi(file: string, flags: Flags): Promise<number> {
  const calls = extractApiCalls(await loadHar(file), { keepNoise: flags.keepNoise });
  const endpoints = groupEndpoints(calls);
  if (endpoints.length === 0) {
    throw new Error(
      `no API calls found in ${file}. Record while the app loads data, or try --keep-noise; if the API is on another domain, record with --all-origins`,
    );
  }
  const document = toOpenApi(endpoints, {
    title: flags.title,
    version: flags.version,
    dependencies: findDependencies(calls),
    examples: !flags.noExamples,
  });
  const json = JSON.stringify(document, null, 2) + "\n";
  if (flags.out) {
    await writeFile(flags.out, json);
    process.stderr.write(`Wrote ${endpoints.length} operations to ${flags.out}\n`);
  } else {
    process.stdout.write(json);
  }
  return 0;
}

async function verify(file: string, flags: Flags): Promise<number> {
  const results = await verifyCalls(extractApiCalls(await loadHar(file), { keepNoise: flags.keepNoise }), {
    baseUrl: flags.baseUrl,
    allowWrites: flags.allowWrites,
    delayMs: flags.delay === undefined ? 250 : Number(flags.delay),
  });
  if (flags.json) process.stdout.write(JSON.stringify(results, null, 2) + "\n");
  else printVerification(results);
  return results.some((r) => r.verdict === "failed" || r.verdict === "drifted") ? 2 : 0;
}

async function deps(file: string, flags: Flags): Promise<number> {
  const found = findDependencies(extractApiCalls(await loadHar(file), { keepNoise: flags.keepNoise }));
  if (flags.json) {
    process.stdout.write(JSON.stringify({ dependencies: found, authSources: authSources(found) }, null, 2) + "\n");
    return 0;
  }
  if (found.length === 0) {
    process.stdout.write("No values flow between calls in this capture.\n");
    return 0;
  }
  for (const kind of ["auth", "data"] as const) {
    const group = found.filter((d) => d.kind === kind);
    if (group.length === 0) continue;
    process.stdout.write(kind === "auth" ? "Credentials\n" : "Data\n");
    for (const d of group) {
      process.stdout.write(
        `  ${d.from.operation}  ${d.from.location}\n    -> ${d.to.operation}  ${d.to.location}  (${d.count}x, e.g. ${d.example})\n`,
      );
    }
  }
  const sources = authSources(found);
  if (sources.length > 0) {
    const ops = [...new Set(sources.map((s) => s.operation))];
    process.stdout.write(`\nTo log in again, repeat: ${ops.join(", ")}\n`);
  }
  return 0;
}

// Headless from the saved browser login first; a visible login only when that
// has ended and a person is there to log in.
async function renewSession(url: string, statePath: string, interactive: boolean, channel?: string) {
  try {
    return await refreshSession({ url, statePath, channel });
  } catch (error) {
    if (!(error instanceof SessionExpiredError)) throw error;
    if (!interactive) {
      throw new Error(
        `the saved login has ended and a person needs to log in. Run: api-anything refresh ${url} --interactive`,
      );
    }
    return refreshSession({
      url,
      statePath,
      channel,
      interactive: true,
      onLoginNeeded: () => {
        process.stderr.write("The session has ended. Log in in the browser window; it closes by itself once you are in.\n");
      },
    });
  }
}

async function refresh(url: string, flags: Flags): Promise<number> {
  const statePath = flags.state ?? DEFAULT_STATE_PATH;
  if (!flags.interactive && !existsSync(statePath)) {
    throw new Error(`no saved browser login at ${statePath}; run with --interactive to log in, or record with --save-state`);
  }
  const fresh = await renewSession(url, statePath, flags.interactive, flags.channel);
  const path = flags.out ?? DEFAULT_SESSION_PATH;
  await saveSession(fresh, path);
  for (const [origin, headers] of Object.entries(fresh.origins)) {
    process.stderr.write(`${origin}: ${Object.keys(headers).join(", ")}\n`);
  }
  process.stderr.write(`Saved a fresh session to ${path}.\n`);
  reportLifetimes(fresh);
  return 0;
}

async function client(file: string, flags: Flags): Promise<number> {
  const lang = flags.lang;
  if (lang !== "ts" && lang !== "py") throw new Error("client needs --lang ts or --lang py");
  const model = buildClientModel(await loadOpenApi(file));
  const code = lang === "ts" ? renderTypeScript(model) : renderPython(model);
  if (flags.out) {
    await writeFile(flags.out, code);
    process.stderr.write(`Wrote a ${lang === "ts" ? "TypeScript" : "Python"} client with ${model.operations.length} operations to ${flags.out}\n`);
  } else {
    process.stdout.write(code);
  }
  return 0;
}

// Tells the user how long the saved session lasts and what to do if it is short.
function reportLifetimes(session: Session): void {
  const lifetimes = session.lifetimes ?? [];
  for (const l of lifetimes) process.stderr.write(`  ${describeLifetime(l)}\n`);
  if (isShortLived(lifetimes)) {
    process.stderr.write(
      `This session is short-lived. If the login page offers "Remember me" or "Keep me signed in", ` +
        `record again with it checked; the app then usually issues a session that lasts days.\n`,
    );
  }
}

async function session(file: string, flags: Flags): Promise<number> {
  const extracted = extractSession(extractApiCalls(await loadHar(file)));
  const path = flags.out ?? DEFAULT_SESSION_PATH;
  await saveSession(extracted, path);
  const origins = new Set([...Object.keys(extracted.origins), ...Object.keys(extracted.query ?? {})]);
  for (const origin of origins) {
    const names = [...Object.keys(extracted.origins[origin] ?? {}), ...Object.keys(extracted.query?.[origin] ?? {}).map((n) => `?${n}`)];
    process.stderr.write(`${origin}: ${names.join(", ")}\n`);
  }
  process.stderr.write(`Saved session for ${origins.size} origin(s) to ${path}. Keep this file private.\n`);
  reportLifetimes(extracted);
  return 0;
}

async function ops(file: string, flags: Flags): Promise<number> {
  const operations = listOperations(await loadOpenApi(file));
  if (flags.json) {
    process.stdout.write(JSON.stringify(operations, null, 2) + "\n");
    return 0;
  }
  for (const op of operations) {
    const params = op.parameters
      .map((p) => {
        const flag = `--${p.name} <${p.type ?? "string"}>${p.default === undefined ? "" : `=${p.default}`}`;
        return p.required ? flag : `[${flag}]`;
      })
      .join(" ");
    const extras = [op.hasBody ? "--body <json>" : "", op.writes ? "(writes)" : ""].filter(Boolean).join(" ");
    process.stdout.write(`${op.operationId.padEnd(24)} ${op.method.padEnd(6)} ${op.path}\n`);
    if (params || extras) process.stdout.write(`${" ".repeat(25)}${[params, extras].filter(Boolean).join(" ")}\n`);
  }
  return 0;
}

async function call(file: string, args: string[]): Promise<number> {
  const [operationId, ...rest] = args;
  if (!operationId || operationId.startsWith("-")) throw new Error("call needs an operationId; run 'api-anything ops <openapi.json>' to list them");
  const options = parseCallArgs(rest);

  const doc = await loadOpenApi(file);
  const sessionPath = options.sessionPath ?? DEFAULT_SESSION_PATH;
  const refreshState = options.refreshState ?? (existsSync(DEFAULT_STATE_PATH) ? DEFAULT_STATE_PATH : undefined);
  const interactive = Boolean(process.stdin.isTTY) && !options.noInteractive;
  const savedSession = await loadSession(sessionPath);
  const origin = doc.servers[0] ? new URL(doc.servers[0].url).origin : "";
  for (const l of expiredCredentials(savedSession, origin)) {
    process.stderr.write(`warning: ${describeLifetime(l)}\n`);
  }
  const result = await callOperation(doc, {
    operationId,
    params: options.params,
    body: options.body === undefined ? undefined : await readBody(options.body),
    baseUrl: options.baseUrl,
    allowWrites: options.allowWrites,
    session: savedSession,
    refresh: refreshState
      ? () => renewSession(options.refreshUrl ?? `${new URL(doc.servers[0]!.url).origin}/`, refreshState, interactive)
      : undefined,
  });
  if (result.refreshedSession) {
    await saveSession(result.refreshedSession, sessionPath);
    process.stderr.write(`Session expired; renewed and retried.\n`);
  }

  process.stdout.write(formatBody(result.body, result.contentType));
  if (!result.ok) {
    process.stderr.write(`HTTP ${result.status} from ${result.url}\n`);
    if ((result.status === 401 || result.status === 403) && !refreshState) {
      process.stderr.write(
        `The session has probably ended. Log in again with 'api-anything record <url> --save-state .api-anything/state.json' ` +
          `and run 'api-anything session <capture.har>', or pass --refresh-state if the saved browser login is still valid.\n`,
      );
    }
    return 2;
  }
  return 0;
}

function formatBody(body: string, contentType: string | undefined): string {
  if (body === "") return "";
  if (contentType?.includes("json")) {
    try {
      return JSON.stringify(JSON.parse(body), null, 2) + "\n";
    } catch {
      // Not valid JSON despite the header; print as received.
    }
  }
  return body.endsWith("\n") ? body : body + "\n";
}

async function readBody(value: string): Promise<string> {
  return value.startsWith("@") ? readFile(value.slice(1), "utf8") : value;
}

function printVerification(results: VerificationResult[]): void {
  const marks: Record<VerificationResult["verdict"], string> = {
    verified: "✓",
    drifted: "~",
    failed: "✗",
    skipped: "-",
  };
  for (const r of results) {
    const time = r.durationMs === undefined ? "" : ` (${r.durationMs} ms)`;
    process.stdout.write(`${marks[r.verdict]} ${r.verdict.padEnd(8)} ${r.operation}${time}\n    ${r.reason}\n`);
    for (const issue of r.issues ?? []) process.stdout.write(`      ${issue.path}: ${issue.message}\n`);
  }
  const count = (v: VerificationResult["verdict"]) => results.filter((r) => r.verdict === v).length;
  process.stdout.write(
    `\n${count("verified")} verified, ${count("drifted")} drifted, ${count("failed")} failed, ${count("skipped")} skipped\n`,
  );
}

interface Flags {
  json: boolean;
  allowWrites: boolean;
  allOrigins: boolean;
  keepNoise: boolean;
  noExamples: boolean;
  interactive: boolean;
  headless?: boolean;
  headed: boolean;
  channel?: string;
  lang?: string;
  script?: string;
  state?: string;
  saveState?: string;
  out?: string;
  title?: string;
  version?: string;
  baseUrl?: string;
  delay?: string;
}

const VALUE_FLAGS: Record<string, "out" | "title" | "version" | "baseUrl" | "delay" | "channel" | "lang" | "script" | "state" | "saveState"> = {
  "--channel": "channel",
  "--lang": "lang",
  "--script": "script",
  "--state": "state",
  "--save-state": "saveState",
  "--out": "out",
  "--title": "title",
  "--version": "version",
  "--base-url": "baseUrl",
  "--delay": "delay",
};

function parseFlags(args: string[]): Flags {
  const flags: Flags = { json: false, allowWrites: false, allOrigins: false, keepNoise: false, noExamples: false, interactive: false, headed: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--json") flags.json = true;
    else if (arg === "--allow-writes") flags.allowWrites = true;
    else if (arg === "--all-origins") flags.allOrigins = true;
    else if (arg === "--keep-noise") flags.keepNoise = true;
    else if (arg === "--no-examples") flags.noExamples = true;
    else if (arg === "--interactive") flags.interactive = true;
    else if (arg === "--headless") flags.headless = true;
    else if (arg === "--headed") flags.headed = true;
    else if (arg in VALUE_FLAGS) {
      const value = args[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      flags[VALUE_FLAGS[arg]!] = value;
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  if (flags.delay !== undefined && !(Number(flags.delay) >= 0)) throw new Error("--delay must be a number of milliseconds");
  return flags;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);
