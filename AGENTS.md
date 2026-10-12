# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, Cursor, Gemini CLI) working in this repository.

## What this project is

api-anything turns the recorded traffic of a normal browser session (a HAR file) into API operations: method, templated path, query parameters and inferred JSON schemas. The goal is to make web-based business systems without an API callable by agents and scripts.

## Commands

```bash
npm install
npm test             # node:test via tsx, must pass before every commit
npx playwright install chromium   # once, for the recording test
npm run typecheck    # tsc --noEmit, must be clean
npm run cli -- record <url> [--out capture.har] [--all-origins] [--channel chrome]
               [--script steps.ts] [--headless|--headed] [--state file] [--save-state file]
npm run cli -- analyze test/fixtures/erp-session.har [--json]
npm run cli -- openapi test/fixtures/erp-session.har [--out file] [--title t]
npm run cli -- verify <capture.har> [--base-url url] [--allow-writes] [--delay ms] [--json]
npm run cli -- deps <capture.har> [--json]
npm run cli -- session <capture.har> [--out file]
npm run cli -- ops <openapi.json> [--json]
npm run cli -- call <openapi.json> <operationId> [--<param> value]... [--body json|@file] [--allow-writes] [--refresh-state file]
npm run cli -- refresh <url> --state <file> [--out session.json]
```

## Layout

```
src/record/       browser recording with Playwright (headed by default)
src/har/          HAR types and parsing; decides which entries are API calls
src/endpoints/    path templating and grouping of calls into operations
src/schema/       deterministic JSON schema inference and merging
src/openapi/      OpenAPI 3.1 export and operationId naming
src/deps/         value flow between calls: credentials and data dependencies
src/verify/       replay verification against the live system
src/session/      session header extraction, the private session file, and refresh from a saved browser login
src/call/         listing and calling operations from an OpenAPI document
src/index.ts      public API
src/cli.ts        command line entry point
test/             tests; test/fixtures/ holds synthetic captures only
```

## Rules

- **The core is deterministic.** Parsing, grouping and schema inference make no network or model calls. Keep it that way; model-based features go in their own module and must be opt-in.
- **Nothing writes by default.** `verify` replays only GET/HEAD/OPTIONS and `call` refuses POST/PUT/PATCH/DELETE unless `allowWrites` is set. Keep that default; tests run against a local server, never a real system.
- **Agents record with scripts, people log in.** `record --script` runs a file that default-exports `async (page, { url }) => {}`. Never type a user's password in a script; start from a state file saved by the user with `--save-state`.
- **Never replay or store a login request.** Sessions are renewed only from a browser state the user saved (`refreshSession`).
- **Credential values are always masked in output.** `deps` prints only a prefix and length for tokens and cookies.
- **Credentials never enter the OpenAPI document.** Session headers live only in `.api-anything/session.json` (mode 600, gitignored).
- **Never commit real captures.** HAR files contain session cookies and business data. Fixtures must be synthetic and use the `example.test` domain.
- **Every behaviour change gets a test.** Add or update a case in `test/` and keep the fixture minimal.
- **Do not drop data silently.** If a body cannot be parsed, keep it as raw text; if an entry is skipped, it must be because a documented rule says so.
- TypeScript strict, ESM, `.ts` extensions in imports, Node 22+. No build step.
- Commit messages follow Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`, `ci:`).
