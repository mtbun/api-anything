# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, Cursor, Gemini CLI) working in this repository.

## What this project is

api-anything turns the recorded traffic of a normal browser session (a HAR file) into API operations: method, templated path, query parameters and inferred JSON schemas. The goal is to make web-based business systems without an API callable by agents and scripts.

## Commands

```bash
npm install
npm test             # node:test via tsx, must pass before every commit
npm run typecheck    # tsc --noEmit, must be clean
npm run cli -- analyze test/fixtures/erp-session.har [--json]
npm run cli -- openapi test/fixtures/erp-session.har [--out file] [--title t]
```

## Layout

```
src/har/          HAR types and parsing; decides which entries are API calls
src/endpoints/    path templating and grouping of calls into operations
src/schema/       deterministic JSON schema inference and merging
src/openapi/      OpenAPI 3.1 export and operationId naming
src/index.ts      public API
src/cli.ts        command line entry point
test/             tests; test/fixtures/ holds synthetic captures only
```

## Rules

- **The core is deterministic.** Parsing, grouping and schema inference make no network or model calls. Keep it that way; model-based features go in their own module and must be opt-in.
- **Never commit real captures.** HAR files contain session cookies and business data. Fixtures must be synthetic and use the `example.test` domain.
- **Every behaviour change gets a test.** Add or update a case in `test/` and keep the fixture minimal.
- **Do not drop data silently.** If a body cannot be parsed, keep it as raw text; if an entry is skipped, it must be because a documented rule says so.
- TypeScript strict, ESM, `.ts` extensions in imports, Node 22+. No build step.
- Commit messages follow Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`, `ci:`).
