# Security policy

## Reporting a vulnerability

Please report security issues privately through GitHub's [private vulnerability reporting](https://github.com/mtbun/api-anything/security/advisories/new) rather than in a public issue. Include steps to reproduce and the affected version. You can expect an initial response within seven days.

## Files that hold credentials

api-anything works with the access of a signed-in user, so some of its files are as sensitive as a password:

| File | Contains | Protection |
|---|---|---|
| `*.har` captures | Everything the browser sent and received, including cookies, tokens and account data | `record` masks passwords and other secret form fields and writes mode 600; run `api-anything redact` on hand-exported files; `.gitignore` excludes them outside the test fixtures |
| `.api-anything/session.json` | Cookie, authorization and CSRF headers, and API keys the app sends in URLs, used by `call` | Written with mode 600; the directory is gitignored |
| `.api-anything/state.json` (or any `--save-state` file) | Browser cookies and local storage of a logged-in session | Written with mode 600 |
| `openapi.json` | Operations and schemas only; credential headers, query parameters and credential field values (passwords, tokens, JWTs) are left out | Contains example values from your data; use `--no-examples` before sharing it outside your team |

Passwords are never stored and the login request is never replayed. Credential values are masked in `deps` output.

## Release integrity

Packages are published only from GitHub Actions on a protected version tag, after the maintainer approves the run, using npm trusted publishing (no stored npm token) and npm provenance, so every published version can be traced to the commit and workflow that built it. Dependencies are kept current by Dependabot, and the code is scanned with CodeQL on every pull request and weekly.

## Local processing

All processing is local. `record`, `refresh`, `verify` and `call` send requests only to the web app being used (or the `--base-url` given); no data goes to any other service. Delete captures and session files when you no longer need them.
