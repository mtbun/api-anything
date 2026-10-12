# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `record <url>`: records a session in a real browser and saves it as a HAR file when the window is closed; only the app's own site is recorded unless `--all-origins`. (#5)
- Agent recording: `record --script` runs an agent-written Playwright script, headless by default; `--save-state` and `--state` let a person log in once and scripts reuse the session. (#6)
- `analyze <capture.har>`: lists the operations in a capture, with templated paths, query parameters, call counts, status codes and JSON schemas merged across calls. (#1)
- `openapi <capture.har>`: OpenAPI 3.1 export with REST-style operation IDs and typed parameters. (#2)
- `verify <capture.har>`: replays one call per operation and reports verified, drifted, failed or skipped, with reasons and JSON-path differences; writes only with `--allow-writes`. (#3)
- `session`, `ops` and `call`: call any operation from the command line with parameter checking, a private session file (mode 600) and `--allow-writes` for writes. (#4)
- `deps <capture.har>`: traces credentials and IDs from the response that issues them to the requests that use them; exported as OpenAPI links and `x-api-anything.providesAuth`. (#7)
- Session refresh: `call --refresh-state` and `refresh <url> --state` renew an expired session from a saved browser login and retry once, without storing a password. (#8)
- `api-anything` command via `npm link`, with a Node entry point that runs the TypeScript sources through tsx. (#9)

### Changed

- Documentation positions api-anything for any web app, led by multi-tenant SaaS, instead of internal systems only. (#9)
