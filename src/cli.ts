#!/usr/bin/env -S npx tsx
import { writeFile } from "node:fs/promises";
import { analyzeHar, toOpenApi } from "./index.ts";

const USAGE = `api-anything — turn a recorded browser session into API operations

Usage:
  api-anything analyze <capture.har> [--json]
  api-anything openapi <capture.har> [--out <file>] [--title <title>] [--version <version>]

Commands:
  analyze   List the API operations found in a HAR capture.
            --json prints the full result (schemas included) as JSON.
  openapi   Write an OpenAPI 3.1 document describing the operations.
            Prints to stdout unless --out is given.
`;

async function main(argv: string[]): Promise<number> {
  const [command, file, ...rest] = argv;
  if (command === "--help" || command === "-h") {
    process.stdout.write(USAGE);
    return 0;
  }
  if (!file || (command !== "analyze" && command !== "openapi")) {
    process.stderr.write(USAGE);
    return 1;
  }

  const flags = parseFlags(rest);
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

interface Flags {
  json: boolean;
  out?: string;
  title?: string;
  version?: string;
}

function parseFlags(args: string[]): Flags {
  const flags: Flags = { json: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json") flags.json = true;
    else if (arg === "--out" || arg === "--title" || arg === "--version") {
      const value = args[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      flags[arg.slice(2) as "out" | "title" | "version"] = value;
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  return flags;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);
