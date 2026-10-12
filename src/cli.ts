#!/usr/bin/env -S npx tsx
import { analyzeHar } from "./index.ts";

const USAGE = `api-anything — turn a recorded browser session into API operations

Usage:
  api-anything analyze <capture.har> [--json]

Commands:
  analyze   List the API operations found in a HAR capture.
            --json prints the full result (schemas included) as JSON.
`;

async function main(argv: string[]): Promise<number> {
  const [command, file, ...flags] = argv;
  if (command !== "analyze" || !file) {
    process.stderr.write(USAGE);
    return command === "--help" || command === "-h" ? 0 : 1;
  }

  const endpoints = await analyzeHar(file);
  if (flags.includes("--json")) {
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

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);
