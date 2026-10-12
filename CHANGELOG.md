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
- A social preview image for the repository (`docs/social-preview.png`, rendered from `docs/social-preview.html`). (#21)
- Project hygiene: issue templates that warn against attaching captures or cookies, a pull request checklist, a code of conduct, CODEOWNERS, Dependabot for npm and GitHub Actions, and CodeQL scanning. (#20)
- Release workflow: pushing a `v*` tag checks the version and changelog, runs the tests, publishes to npm with provenance and creates the GitHub release from the changelog section; see `docs/RELEASING.md`. Package metadata for npm. (#19)
- A demo HR app (`examples/demo-app/`) with a recording script, a demo GIF in the README rendered from `docs/demo.tape`, and a test that keeps the demo working. (#18)
- Interactive login: when the saved browser login has ended, `call` (in a terminal) and `refresh --interactive` open a browser for a person to log in, close it once the app is reached, and continue; `call` uses `.api-anything/state.json` automatically; `--no-interactive` for scripts. (#17)
- `record`, `session` and `refresh` show how long each saved credential lasts (cookie `Expires`/`Max-Age`, JWT `exp`) and suggest a "remember me" login for short-lived sessions; `call` warns before sending when a known expiry has passed and explains how to log in again after a `401`/`403`. (#16)
- Path and query parameters are typed from their observed values (integer, number, boolean, date, date-time, uuid); `ops` shows the format and `call` rejects a value that does not fit, with an example, before sending. (#15)
- `redact <capture.har>` masks secret fields in hand-exported HAR files; `openapi --no-examples` leaves out every example value for sharing. (#14)
- `--version`, and `--help` after any command. (#13)
- `client <openapi.json> --lang ts|py`: generates a single-file, dependency-free TypeScript (fetch) or Python (standard library, 3.9+) client with typed methods, defaults, credential query parameters and session-file loading. (#12)
- `--keep-noise` for `analyze`, `openapi`, `deps` and `verify`. (#10)
- Query parameters with the same value on every call become optional parameters with that default; `ops` shows them as `--name <type>=value` and `call` fills them in. (#10)
- API keys and tokens sent as query parameters are treated as credentials: kept in the session file, added by `call`, left out of OpenAPI parameters and example paths, and listed under `x-api-anything.credentialQuery`. (#10)

### Changed

- Releases use npm trusted publishing instead of a stored token, run in an `npm` environment that waits for the maintainer's approval, and only admins can create `v*` tags. (#20)
- POST actions are named after the action (`queryIndexProduct`, `login`), and POSTs that only read (`query`, `search`, `find`, `lookup`, `count`, ...) are treated as reads by `call`, `ops` and `verify`. (#10)
- Documentation positions api-anything for any web app, led by multi-tenant SaaS, instead of internal systems only. (#9)

### Security

- Fixed the findings of the first CodeQL scan: regular expressions that could be made slow by crafted paths or values in a capture (path placeholders in client generation, the email format check) are now linear; non-standard HTTP methods in a capture are ignored so they cannot become object keys; the release-notes script validates and fully escapes the version. (#22)
- `toOpenApi` also checks the HTTP method of endpoints passed in by library callers, so only standard methods become path item keys, and keeps path templates in a Map so a template such as `__proto__` cannot alter `Object.prototype`. (#27)

### Fixed

Found by recording a real HR portal (#14, #16):

- `deps` linked dates that merely repeat across calls (today's date in a forecast and in a timesheet query); dates are no longer dependencies. (#16)
- **Security:** the login password in a captured login request became an example value in the OpenAPI document. Credential fields (`password`, `token`, `secret`, `otp`, `apiKey`, ...) and JWTs are now described by type only, and `record` masks secret form fields before writing the capture with mode 600.
- RPC-style paths (`/api/get-pto-history`) are named by their verb (`getPtoHistory`) instead of `listGetPtoHistory`, and the verb decides read or write, so a `GET .../delete-item` needs `--allow-writes`.
- SignalR `negotiate` handshakes are filtered as noise.

- A missing or non-JSON capture, an empty capture passed to `openapi`, an invalid JSON `--body` and an unreachable host now give one readable `error:` line with what to do next instead of a raw library message; `openapi` no longer writes a document without operations. (#13)
- Sparse HAR exports without request headers, response headers or content no longer crash the analysis; entries without a URL, method or response are skipped. (#13)

Found by recording real public web apps:

- The same call to numbered hosts of one service (`t5-in-1.…`, `t32-usw-1.…`) is one operation instead of one per host; the OpenAPI operation lists every host as a server. (#11)
- Analytics, tag-manager, telemetry and bot-challenge requests (Google Analytics, `/cdn-cgi/`, `telemetry.*`, and similar) are no longer listed as operations. (#10)
- Requests that never got an answer (status 0 or below) are ignored. (#10)
- API versions such as `/1/indexes` or `/api/2/orders` are no longer turned into `{id}` parameters. (#10)
- Long signed or challenge tokens with separators are templated, and parameters after unreadable segments are named `id` instead of a mangled token. (#10)
- `indexes` is singularised to `index`, not `indexe`. (#10)
