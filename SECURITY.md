# Security policy

## Reporting a vulnerability

Please report security issues privately through GitHub's [private vulnerability reporting](https://github.com/mtbun/api-anything/security/advisories/new) rather than in a public issue. Include steps to reproduce and the affected version. You can expect an initial response within seven days.

## Files that hold credentials

api-anything works with the access of a signed-in user, so some of its files are as sensitive as a password:

| File | Contains | Protection |
|---|---|---|
| `*.har` captures | Everything the browser sent and received, including cookies, tokens and account data | Keep local; `.gitignore` excludes them outside the test fixtures |
| `.api-anything/session.json` | Cookie, authorization and CSRF headers used by `call` | Written with mode 600; the directory is gitignored |
| `.api-anything/state.json` (or any `--save-state` file) | Browser cookies and local storage of a logged-in session | Written with mode 600 |
| `openapi.json` | Operations and schemas only, no credentials | Safe to share, but it may reveal an app's internal structure and example values |

Passwords are never stored and the login request is never replayed. Credential values are masked in `deps` output.

All processing is local. `record`, `refresh`, `verify` and `call` send requests only to the web app being used (or the `--base-url` given); no data goes to any other service. Delete captures and session files when you no longer need them.
