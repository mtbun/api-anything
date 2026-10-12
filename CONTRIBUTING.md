# Contributing to api-anything

Thanks for your interest. This document describes how changes get in.

## Development setup

```bash
git clone https://github.com/mtbun/api-anything.git
cd api-anything
npm install
npx playwright install chromium   # the recording and session-refresh tests drive a headless browser
npm test
npm run typecheck
```

Node.js 22 or newer is required. `npm link` makes the `api-anything` command available while you work; otherwise use `npm run cli -- <command>`.

## Workflow

1. Open an issue describing the problem or feature before large changes.
2. Create a branch from `main`: `feat/<short-name>`, `fix/<short-name>` or `docs/<short-name>`.
3. Make the change with tests. `npm test` and `npm run typecheck` must pass.
4. Update the documentation in the same pull request: README.md, AGENTS.md, llms.txt and the Unreleased section of CHANGELOG.md.
5. Use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages.
6. Open a pull request against `main` and describe what changed and how it was tested. CI runs the type check and tests on Node 22 and 24.

## Tests

- Tests use `node:test` and run against local HTTP servers started inside the test. They never contact a real web app.
- Browser tests run Playwright's Chromium headless and are skipped when it is not installed.
- Fixtures in `test/fixtures/` must be synthetic. Never add a HAR file recorded from a real app: captures contain session cookies and account data. Use the `example.test` domain and obviously fake credential values.

## Demo

`examples/demo-app/` is a fake HR app used by the README, by `test/demo-app.test.ts`, and by the GIF at the top of the README. When a change alters what the demo shows, regenerate the GIF from the repository root:

```bash
brew install vhs   # once; see https://github.com/charmbracelet/vhs for other systems
npm link
vhs docs/demo.tape
```

## Releases

Maintainers release by tagging; see [docs/RELEASING.md](docs/RELEASING.md). Contributors only add their changes to the `## [Unreleased]` section of `CHANGELOG.md`.

## Code style

TypeScript strict mode, ES modules, `.ts` extensions in imports, two-space indentation, no build step. Keep the analysis deterministic: no network or model calls outside the commands that are meant to talk to the app (`record`, `refresh`, `verify`, `call`).
