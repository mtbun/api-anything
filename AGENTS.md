# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, Cursor, Gemini CLI) working in this repository.

## What this project is

api-anything turns any web app into an API. It records a normal browser session (a HAR file), describes the application calls behind the web UI as operations (method, templated path, parameters, JSON schemas), traces how values flow between them, exports OpenAPI 3.1, and lets agents and scripts call the operations from the command line. Target apps are the ones people sign in to: SaaS tools (HR, payroll, accounting, CRM, e-commerce, logistics), ERPs, portals and admin panels, especially where no API is available.

## Commands

```bash
npm install
npx playwright install chromium   # once, for the recording and refresh tests
npm test                          # node:test via tsx, must pass before every commit
npm run typecheck                 # tsc --noEmit, must be clean
npm run cli -- <command> ...      # or `api-anything <command>` after `npm link`
```

CLI commands:

```bash
record  <url> [--out capture.har] [--all-origins] [--channel chrome|msedge]
              [--script steps.ts] [--headless|--headed] [--state file] [--save-state file]
analyze <capture.har> [--json] [--keep-noise]
openapi <capture.har> [--out file] [--title t] [--version v] [--keep-noise]
deps    <capture.har> [--json] [--keep-noise]
session <capture.har> [--out file]
ops     <openapi.json> [--json]
call    <openapi.json> <operationId> [--<param> value]... [--body json|@file]
        [--session file] [--base-url url] [--allow-writes] [--refresh-state file] [--refresh-url url]
refresh <url> --state <file> [--out session.json]
client  <openapi.json> --lang ts|py [--out file]
verify  <capture.har> [--base-url url] [--allow-writes] [--delay ms] [--json] [--keep-noise]
```

Exit codes: 0 success, 1 usage or input error, 2 non-2xx response (`call`) or failed/drifted operations (`verify`). `--version` prints the version; `--help` works after any command.

Errors are written to stderr as one line starting with `error:` and say what to do next. Keep new errors in that form; never let a raw stack trace or a bare library message (`fetch failed`, `ENOENT`) reach the user.

## Layout

```
bin/api-anything.js  command entry point; registers tsx and loads src/cli.ts
src/cli.ts        argument parsing and one function per command
src/record/       browser recording with Playwright; scripts and saved browser state
src/har/          HAR types and parsing; decides which entries are API calls, drops noise
src/endpoints/    path templating, origin families, grouping of calls into operations, POST actions and read/write rules
src/credentials.ts  the one place that decides which header and query names are credentials
src/schema/       JSON schema inference, merging and validation
src/deps/         value flow between calls: credentials and data dependencies
src/openapi/      OpenAPI 3.1 export, operationId naming, links
src/session/      session headers, the private session file, refresh from a saved browser login
src/call/         listing and calling operations from an OpenAPI document; call arguments
src/client/       client generation: a language-neutral model, TypeScript and Python renderers
src/verify/       replay verification against the live app
src/index.ts      public API
test/             tests; test/fixtures/ holds synthetic captures only
```

## Rules

- **The analysis is deterministic.** Parsing, grouping, schema inference and dependency mapping make no network or model calls. Model-based features, if ever added, go in their own module and must be opt-in.
- **Nothing writes by default.** `verify` replays only GET/HEAD/OPTIONS and `call` refuses POST/PUT/PATCH/DELETE unless `allowWrites` is set. Keep that default.
- **Generated clients stay dependency-free.** TypeScript uses `fetch`; Python uses only the standard library and must run on Python 3.9. Tests type-check the TypeScript output and run both against a local server.
- **Tests never touch a real app.** They run against local HTTP servers and synthetic fixtures; browser tests run headless.
- **Agents record with scripts, people log in.** `record --script` runs a file that default-exports `async (page, { url }) => {}`. Never type a user's password in a script; start from a state file the user saved with `--save-state`.
- **Never replay or store a login request.** Sessions are renewed only from a browser state the user saved (`refreshSession`).
- **Reads and writes are decided in one place.** Use `isReadOperation` from `src/endpoints/actions.ts`; do not check HTTP methods directly.
- **Credentials stay out of shared output.** They never enter the OpenAPI document, are masked in `deps` output, and live only in `.api-anything/` (mode 600, gitignored).
- **Never commit real captures.** HAR files contain session cookies and account data. Fixtures must be synthetic and use the `example.test` domain. When a real recording reveals a problem, reproduce its pattern in a synthetic fixture (see `test/fixtures/search-app.har`).
- **Every behaviour change gets a test and a docs update.** Update README.md, AGENTS.md, llms.txt and CHANGELOG.md in the same pull request.
- **Do not drop data silently.** If a body cannot be parsed, keep it as raw text; if an entry is skipped, it must be because a documented rule says so.
- TypeScript strict, ESM, `.ts` extensions in imports, Node 22+. No build step.
- Commit messages follow Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`, `ci:`).
