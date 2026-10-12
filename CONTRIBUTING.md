# Contributing to api-anything

Thanks for your interest. This document describes how changes get in.

## Development setup

```bash
git clone https://github.com/mtbun/api-anything.git
cd api-anything
npm install
npm test
npm run typecheck
```

Node.js 22 or newer is required.

## Workflow

1. Open an issue describing the problem or feature before large changes.
2. Create a branch from `main`: `feat/<short-name>`, `fix/<short-name>` or `docs/<short-name>`.
3. Make the change with tests. `npm test` and `npm run typecheck` must pass.
4. Use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages.
5. Open a pull request against `main` and describe what changed and how it was tested.

## Test data

Fixtures in `test/fixtures/` must be synthetic. Never add a HAR file recorded from a real system: captures contain session cookies and business data. Use the `example.test` domain for fixture URLs.

## Code style

TypeScript strict mode, ES modules, two-space indentation. Keep the core analysis deterministic: no network or model calls outside opt-in modules.
