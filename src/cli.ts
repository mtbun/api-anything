#!/usr/bin/env -S npx tsx
import { readFile, writeFile } from "node:fs/promises";
import {
  analyzeHar,
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
  verifyCalls,
  type VerificationResult,
} from "./index.ts";

const USAGE = `api-anything — turn a recorded browser session into API operations

Usage:
  api-anything analyze <capture.har> [--json]
  api-anything openapi <capture.har> [--out <file>] [--title <title>] [--version <version>]
  api-anything verify  <capture.har> [--base-url <url>] [--allow-writes] [--delay <ms>] [--json]
  api-anything session <capture.har> [--out <file>]
  api-anything ops     <openapi.json> [--json]
  api-anything call    <openapi.json> <operationId> [--<param> <value>]... [--body <json|@file>]
                       [--session <file>] [--base-url <url>] [--allow-writes]

Commands:
  analyze   List the API operations found in a HAR capture.
  openapi   Write an OpenAPI 3.1 document describing the operations.
  verify    Replay one recorded call per operation against the live system and
            report each as verified, drifted, failed or skipped. Only reads are
            replayed unless --allow-writes is set. Exit code 2 if anything
            failed or drifted.
  session   Save the session headers (cookies, tokens) from a capture to
            ${DEFAULT_SESSION_PATH} (mode 600) for use by 'call'.
  ops       List the operations in an OpenAPI document with their parameters.
  call      Call one operation. Parameters are passed as --<name> <value>
            (or -p <name>=<value>). The response body goes to stdout; JSON is
            pretty-printed. Writes need --allow-writes. Exit code 2 on a
            non-2xx response.
`;

async function main(argv: string[]): Promise<number> {
  const [command, file, ...rest] = argv;
  if (command === undefined || command === "--help" || command === "-h") {
    process.stdout.write(USAGE);
    return command === undefined ? 1 : 0;
  }
  if (!file) {
    process.stderr.write(USAGE);
    return 1;
  }

  switch (command) {
    case "analyze":
      return analyze(file, parseFlags(rest));
    case "openapi":
      return openapi(file, parseFlags(rest));
    case "verify":
      return verify(file, parseFlags(rest));
    case "session":
      return session(file, parseFlags(rest));
    case "ops":
      return ops(file, parseFlags(rest));
    case "call":
      return call(file, rest);
    default:
      process.stderr.write(USAGE);
      return 1;
  }
}

async function analyze(file: string, flags: Flags): Promise<number> {
  const endpoints = await analyzeHar(file);
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
  const endpoints = await analyzeHar(file);
  const json = JSON.stringify(toOpenApi(endpoints, { title: flags.title, version: flags.version }), null, 2) + "\n";
  if (flags.out) {
    await writeFile(flags.out, json);
    process.stderr.write(`Wrote ${endpoints.length} operations to ${flags.out}\n`);
  } else {
    process.stdout.write(json);
  }
  return 0;
}

async function verify(file: string, flags: Flags): Promise<number> {
  const results = await verifyCalls(extractApiCalls(await loadHar(file)), {
    baseUrl: flags.baseUrl,
    allowWrites: flags.allowWrites,
    delayMs: flags.delay === undefined ? 250 : Number(flags.delay),
  });
  if (flags.json) process.stdout.write(JSON.stringify(results, null, 2) + "\n");
  else printVerification(results);
  return results.some((r) => r.verdict === "failed" || r.verdict === "drifted") ? 2 : 0;
}

async function session(file: string, flags: Flags): Promise<number> {
  const extracted = extractSession(extractApiCalls(await loadHar(file)));
  const path = flags.out ?? DEFAULT_SESSION_PATH;
  await saveSession(extracted, path);
  for (const [origin, headers] of Object.entries(extracted.origins)) {
    process.stderr.write(`${origin}: ${Object.keys(headers).join(", ")}\n`);
  }
  process.stderr.write(`Saved session for ${Object.keys(extracted.origins).length} origin(s) to ${path}. Keep this file private.\n`);
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
      .map((p) => (p.required ? `--${p.name} <${p.type ?? "string"}>` : `[--${p.name} <${p.type ?? "string"}>]`))
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

  const result = await callOperation(await loadOpenApi(file), {
    operationId,
    params: options.params,
    body: options.body === undefined ? undefined : await readBody(options.body),
    baseUrl: options.baseUrl,
    allowWrites: options.allowWrites,
    session: await loadSession(options.sessionPath),
  });

  process.stdout.write(formatBody(result.body, result.contentType));
  if (!result.ok) {
    process.stderr.write(`HTTP ${result.status} from ${result.url}\n`);
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
  out?: string;
  title?: string;
  version?: string;
  baseUrl?: string;
  delay?: string;
}

const VALUE_FLAGS: Record<string, "out" | "title" | "version" | "baseUrl" | "delay"> = {
  "--out": "out",
  "--title": "title",
  "--version": "version",
  "--base-url": "baseUrl",
  "--delay": "delay",
};

function parseFlags(args: string[]): Flags {
  const flags: Flags = { json: false, allowWrites: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--json") flags.json = true;
    else if (arg === "--allow-writes") flags.allowWrites = true;
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
