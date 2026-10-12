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
- `client <openapi.json> --lang ts|py`: generates a single-file, dependency-free TypeScript (fetch) or Python (standard library, 3.9+) client with typed methods, defaults, credential query parameters and session-file loading. (#12)
- `--keep-noise` for `analyze`, `openapi`, `deps` and `verify`. (#10)
- Query parameters with the same value on every call become optional parameters with that default; `ops` shows them as `--name <type>=value` and `call` fills them in. (#10)
- API keys and tokens sent as query parameters are treated as credentials: kept in the session file, added by `call`, left out of OpenAPI parameters and example paths, and listed under `x-api-anything.credentialQuery`. (#10)

### Changed

- POST actions are named after the action (`queryIndexProduct`, `login`), and POSTs that only read (`query`, `search`, `find`, `lookup`, `count`, ...) are treated as reads by `call`, `ops` and `verify`. (#10)
- Documentation positions api-anything for any web app, led by multi-tenant SaaS, instead of internal systems only. (#9)

### Fixed

Found by recording real public web apps:

- The same call to numbered hosts of one service (`t5-in-1.…`, `t32-usw-1.…`) is one operation instead of one per host; the OpenAPI operation lists every host as a server. (#11)
- Analytics, tag-manager, telemetry and bot-challenge requests (Google Analytics, `/cdn-cgi/`, `telemetry.*`, and similar) are no longer listed as operations. (#10)
- Requests that never got an answer (status 0 or below) are ignored. (#10)
- API versions such as `/1/indexes` or `/api/2/orders` are no longer turned into `{id}` parameters. (#10)
- Long signed or challenge tokens with separators are templated, and parameters after unreadable segments are named `id` instead of a mangled token. (#10)
- `indexes` is singularised to `index`, not `indexe`. (#10)
