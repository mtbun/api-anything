#!/usr/bin/env -S npx tsx
import { writeFile } from "node:fs/promises";
import { analyzeHar, extractApiCalls, loadHar, toOpenApi, verifyCalls, type VerificationResult } from "./index.ts";

const USAGE = `api-anything — turn a recorded browser session into API operations

Usage:
  api-anything analyze <capture.har> [--json]
  api-anything openapi <capture.har> [--out <file>] [--title <title>] [--version <version>]
  api-anything verify <capture.har> [--base-url <url>] [--allow-writes] [--delay <ms>] [--json]

Commands:
  analyze   List the API operations found in a HAR capture.
            --json prints the full result (schemas included) as JSON.
  openapi   Write an OpenAPI 3.1 document describing the operations.
            Prints to stdout unless --out is given.
  verify    Replay one recorded call per operation against the live system
            and report each as verified, drifted, failed or skipped.
            Only GET/HEAD/OPTIONS are replayed unless --allow-writes is set.
            --base-url replays against another origin (e.g. staging).
            Exits with code 2 if any operation failed or drifted.
`;

async function main(argv: string[]): Promise<number> {
  const [command, file, ...rest] = argv;
  if (command === "--help" || command === "-h") {
    process.stdout.write(USAGE);
    return 0;
  }
  if (!file || !["analyze", "openapi", "verify"].includes(command ?? "")) {
    process.stderr.write(USAGE);
    return 1;
  }

  const flags = parseFlags(rest);

  if (command === "verify") {
    const results = await verifyCalls(extractApiCalls(await loadHar(file)), {
      baseUrl: flags.baseUrl,
      allowWrites: flags.allowWrites,
      delayMs: flags.delay === undefined ? 250 : Number(flags.delay),
    });
    if (flags.json) process.stdout.write(JSON.stringify(results, null, 2) + "\n");
    else printVerification(results);
    return results.some((r) => r.verdict === "failed" || r.verdict === "drifted") ? 2 : 0;
  }

  const endpoints = await analyzeHar(file);

  if (command === "openapi") {
    const document = toOpenApi(endpoints, { title: flags.title, version: flags.version });
    const json = JSON.stringify(document, null, 2) + "\n";
    if (flags.out) {
      await writeFile(flags.out, json);
      process.stderr.write(`Wrote ${endpoints.length} operations to ${flags.out}\n`);
    } else {
      process.stdout.write(json);
    }
    return 0;
  }

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
