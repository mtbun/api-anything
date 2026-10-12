# api-anything

**api-anything turns any web app into an API that AI agents and scripts can call from the command line.** You use the site once in a normal browser session; api-anything reads the recorded traffic, finds the operations the web app calls behind the scenes, and describes them as API operations that an agent or a script can call directly.

It works with the web apps people sign in to every day: SaaS tools for HR, payroll, accounting, CRM, e-commerce, logistics and bookings, ERPs, supplier and customer portals, and internal admin panels.

> API anything with agents. Any web app you log in to becomes operations you call with one command.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Node 22+](https://img.shields.io/badge/node-%3E%3D22-brightgreen)
![Status: early](https://img.shields.io/badge/status-early-orange)

---

## What problem does api-anything solve?

Most day-to-day work happens inside web apps: a multi-tenant SaaS where hundreds of companies sign in at the same address to run HR or payroll, an accounting or CRM tool, an e-commerce or logistics panel, an ERP, a supplier portal. Many of these offer no API, keep it for an enterprise plan, or expose only part of what the screens can do. The result is manual work: exporting reports by hand, copying records into spreadsheets, re-typing data between tools, clicking through the same forms every morning.

Every one of these web apps already talks to its server through structured requests. api-anything makes those requests visible and reusable, so the work you do by hand in the browser can be done by an AI agent or a script, with the same access your account already has.

## How does it work?

```
1. Record     `api-anything record <url>` opens a browser; use the system as usual and
              close the window. The session is saved as a HAR file.
2. Analyze    api-anything filters out pages and assets and keeps the application calls.
3. Describe   Calls to the same operation are merged: /orders/1042 and /orders/1043
              become GET /orders/{orderId}, with query parameters and JSON schemas
              inferred from every observed request and response.
4. Export     Write an OpenAPI 3.1 document that any OpenAPI tool can read.
5. Verify     Replay one recorded call per operation against the live system and
              report each operation as verified, drifted, failed or skipped.
6. Call       Run any operation from the command line by its name:
              api-anything call openapi.json getOrder --orderId 1042
```

The command line is the primary interface. AI agents such as Claude Code, Codex and Cursor already work in a terminal, so they can discover operations with `ops` and run them with `call` without any extra setup, and the output pipes into `jq`, scripts or cron jobs.

The analysis is deterministic: parsing, grouping and schema inference involve no model calls, cost nothing to run and produce the same output every time.

## Quick start

Requirements: Node.js 22 or newer.

```bash
git clone https://github.com/mtbun/api-anything.git
cd api-anything
npm install
npm run cli -- record https://erp.yourcompany.com --out capture.har   # or try the bundled example:
npm run cli -- analyze test/fixtures/erp-session.har
```

Output for the bundled example capture:

```
GET    https://erp.example.test/api/v1/customers/{customerId}/invoices  calls=1 status=200
GET    https://erp.example.test/api/v1/orders  calls=2 status=200
POST   https://erp.example.test/api/v1/orders  calls=1 status=201
GET    https://erp.example.test/api/v1/orders/{orderId}  calls=2 status=200,404

4 operations
```

Add `--json` to get the full description of every operation, including inferred request and response schemas.

### How do I get an OpenAPI document?

```bash
npm run cli -- openapi capture.har --out openapi.json --title "Our ERP"
```

The result is an OpenAPI 3.1 document: one server for the system's main origin, a REST-style `operationId` for every operation (`listOrders`, `getOrder`, `createOrder`, `listCustomerInvoices`), typed path and query parameters, request bodies and responses per status code. Each operation also carries an `x-api-anything` extension with the number of observed calls and example paths, so you can see how much evidence a description rests on. Import the file into Postman, Swagger UI, an OpenAPI client generator or an agent framework.

### Which values flow between calls?

```bash
api-anything deps capture.har
```

```
Credentials
  POST /api/login  response.body:$.token
    -> GET /api/v1/orders  request.header:authorization  (1x, e.g. tok_…(21 chars))
  POST /api/login  response.cookie:sid
    -> GET /api/v1/orders/{orderId}  request.cookie:sid  (2x, e.g. sess…(16 chars))
Data
  GET /api/v1/orders  response.body:$.items[*].id
    -> GET /api/v1/orders/{orderId}  request.path:orderId  (2x, e.g. 1042)
  GET /api/v1/orders  response.body:$.items[*].id
    -> POST /api/v1/notes  request.body:$.orderId  (1x, e.g. 1042)

To log in again, repeat: POST /api/login
```

`deps` follows every value that one call receives and a later call sends back, in capture order:

- **Credentials**: a token from a login response that becomes the `Authorization` header, a cookie set by one response and sent with the next requests, CSRF tokens. This tells you which operation to repeat when the session expires. Credential values are always masked.
- **Data**: an ID from a list that becomes the path of a detail request or a field in a form submission. This tells an agent how to chain operations: list first, then open one.
- Short strings and small numbers (`page=1`, `status=open`) are ignored so that coincidences do not create links.

The `openapi` command uses the same analysis: data flowing into a path or query parameter becomes a standard [OpenAPI link](https://spec.openapis.org/oas/v3.1.0#link-object) on the producing response (`listOrders` → `getOrder` with `orderId: $response.body#/items/0/id`), and the operation that issues credentials is marked with `x-api-anything.providesAuth`.

### How do I call an operation from the command line?

```bash
api-anything session capture.har            # save cookies and tokens from the capture
api-anything ops openapi.json               # list operations and their parameters
api-anything call openapi.json listOrders --status open --page 2
api-anything call openapi.json getOrder --orderId 1042 | jq '.lines'
api-anything call openapi.json createOrder --body @order.json --allow-writes
```

`ops` prints every operation with its parameters:

```
createOrder              POST   /api/v1/orders
                         --body <json> (writes)
getOrder                 GET    /api/v1/orders/{orderId}
                         --orderId <integer>
listOrders               GET    /api/v1/orders
                         --page <integer> [--sort <string>] --status <string>
```

- **Parameters are flags named after the operation's parameters.** Missing or misspelled ones are rejected with the list of valid names, so an agent can correct itself.
- **The session is kept apart from the API description.** `session` writes the cookie, authorization and CSRF headers from the capture to `.api-anything/session.json` with file mode 600; `call` reads it from there (or from `--session <file>`). The OpenAPI document never contains credentials and can be shared.
- **Writes need `--allow-writes`.** POST, PUT, PATCH and DELETE operations are refused without it.
- **stdout carries only the response body** (pretty-printed JSON), so it can be piped. A non-2xx answer prints the status to stderr and exits with code 2.
- `--base-url` sends the call to another environment; `-p name=value` passes a parameter whose name clashes with an option.

### What happens when the session expires?

```bash
api-anything call openapi.json listOrders --status open --refresh-state .api-anything/state.json
```

With `--refresh-state`, a `401`, `403` or a redirect to a login page is treated as an expired session: api-anything opens the system headless from the browser state saved with `record --save-state`, lets the web app load, collects the fresh cookies and credential headers it uses, saves them to the session file and retries the call once. `api-anything refresh <url> --state <file>` does the same on demand.

No password is stored and the login request is never replayed. If the saved browser state itself has expired, api-anything says so and a person logs in again with `record --save-state`.

### How do I know the operations still work?

```bash
npm run cli -- verify capture.har
```

`verify` replays one recorded call per operation, preferring a successful one, and compares the live answer with what was recorded:

```
✓ verified GET /api/v1/orders (84 ms)
    status and response shape match
~ drifted  GET /api/v1/orders/{orderId} (61 ms)
    response no longer matches the recorded shape (1 difference)
      $.id: expected integer, got string
✗ failed   GET /api/v1/customers/{customerId}/invoices (40 ms)
    expected 200, got 401: session expired or not authorized; record a fresh capture
- skipped  POST /api/v1/orders
    POST changes data; pass --allow-writes to replay it

1 verified, 1 drifted, 1 failed, 1 skipped
```

- **Only reads are replayed by default.** GET, HEAD and OPTIONS are sent; POST, PUT, PATCH and DELETE are skipped unless you pass `--allow-writes`, because replaying them would create or change records in the real system.
- **Failures come with a reason**: an expired session, a redirect to a login page, a record that no longer exists, rate limiting or a server error.
- **Drift lists the exact differences**: missing fields and changed types, by JSON path. Extra fields are not treated as drift.
- `--base-url https://staging.example.com` replays against another environment, `--delay <ms>` spaces requests out (default 250 ms), `--json` prints machine-readable results.
- The command exits with code 2 if any operation failed or drifted, so scripts and agents can act on it.

### How do I record a session?

```bash
api-anything record https://erp.yourcompany.com --out capture.har
```

A browser window opens at that address. Log in and do the tasks you want to automate: open the order list, filter it, open an order, save a form. Close the window (or press Ctrl+C in the terminal) and the session is written to `capture.har`.

- Only the system's own domain and its subdomains are recorded (`erp.acme.com` also records `api.acme.com`), so analytics and CDN traffic stay out. `--all-origins` records everything.
- `--channel chrome` or `--channel msedge` uses the browser already installed on your machine. Otherwise run `npx playwright install chromium` once.

### Can an AI agent record the session itself?

Yes. An agent writes a short Playwright script and runs it with `--script`; the traffic is recorded while the script works, headless by default:

```ts
// steps.ts
export default async (page, { url }) => {
  await page.getByRole("link", { name: "Orders" }).click();
  await page.getByLabel("Status").selectOption("open");
  await page.getByRole("row").first().click();
};
```

```bash
api-anything record https://erp.yourcompany.com --script steps.ts --state .api-anything/state.json --out capture.har
```

Logging in stays with a person. They log in once in a visible browser and save the browser state; the agent's scripts then start from that state:

```bash
api-anything record https://erp.yourcompany.com/login --save-state .api-anything/state.json   # a person logs in, closes the window
api-anything record https://erp.yourcompany.com --script steps.ts --state .api-anything/state.json
```

The state file holds cookies and local storage, is written with mode 600 and lives in the gitignored `.api-anything/` directory. Because the script can be re-run, re-recording after a system change or an expired session is one command. `--headed` shows the browser while a script runs.

You can also export a HAR by hand. In Chrome or Edge, open DevTools (F12) → **Network** tab → tick **Preserve log** → use the system as you normally would → right-click the request list → **Save all as HAR with content**. Firefox has the same option in its Network panel.

A HAR file contains everything the browser sent and received, including session cookies. Treat it like a password: keep it local and do not commit it. The repository's `.gitignore` excludes `*.har` outside the test fixtures.

## What can I use it for?

| Situation | What api-anything gives you |
|---|---|
| A SaaS tool (HR, payroll, accounting, CRM) with no API on your plan | The operations behind its screens, ready to be called by an agent or a script |
| A SaaS whose public API covers only part of what the web app does | The missing operations, taken from the web app itself |
| A report that only exists as an "Export" button | A repeatable call that returns the same data as JSON |
| An ERP, supplier portal or admin panel with no API at all | A full description of the operations its screens use |
| Moving data between two tools that cannot talk to each other | Described operations on both sides to build the integration on |
| A web app whose own API was never documented | A generated OpenAPI description of the endpoints it actually serves |
| Giving an AI agent access to the tools you work in | Operations an agent can call directly instead of clicking through a UI |

## How is this different from browser automation or RPA?

| | RPA / browser automation | api-anything |
|---|---|---|
| What it repeats | Clicks and keystrokes on the screen | The underlying requests the screen sends |
| Speed | Seconds to minutes per task, waits for pages to render | One request per operation |
| Breaks when | The layout, a label or a button position changes | The server-side request format changes |
| Output | A recorded script | An OpenAPI 3.1 document and named operations you can call |
| Fit for AI agents | The agent has to drive a browser | The agent runs `api-anything call <operation>` in its terminal |

Browser automation is still the right tool when a task depends on what is rendered on screen. api-anything is for the large share of tasks that are really "read these records" or "submit this form".

## Status and roadmap

api-anything is early. What exists today and what is planned:

- [x] `record`: capture a session in a real browser without exporting a HAR by hand
- [x] Agent recording: `record --script` runs an agent-written Playwright script; `--save-state` / `--state` let a person log in once and scripts reuse the session
- [x] HAR parsing, with pages and static assets filtered out
- [x] Path templating: numeric IDs, UUIDs, dates and opaque IDs become named parameters
- [x] Grouping of calls into operations with call counts and status codes
- [x] Query parameter detection (required vs optional)
- [x] JSON schema inference for request and response bodies, merged across calls
- [x] CLI: `analyze` with text and JSON output
- [x] OpenAPI 3.1 export with REST-style operation IDs and typed parameters
- [x] Command-line calls: `session`, `ops` and `call` with parameter checking and a separate, private session file
- [x] Dependency mapping: credentials and IDs traced from the response that issues them to the requests that use them; OpenAPI links and a marked login operation
- [x] Session refresh: an expired session is renewed from a saved browser login and the call retried, without storing a password
- [x] Replay verification: verified / drifted / failed / skipped per operation, with reasons and schema differences; writes only on request
- [ ] MCP server as an optional thin layer over `call`
- [ ] Typed client generation (TypeScript and Python)

## FAQ

### Is this an alternative to an official API?

No. If a web app has an official API that covers your needs on your plan, use it. api-anything is for the apps, or the parts of apps, where no API is available to you and the only interface is the web screen.

### Which web apps does it work with?

Any web app whose interface loads data through HTTP requests: multi-tenant SaaS products where many companies sign in at the same address, single-page apps, ERPs, portals and admin panels, including many older systems that use XHR. Systems that render everything on the server and only exchange full HTML pages expose fewer reusable operations.

### Does it send my data anywhere?

No. `analyze` and `openapi` run entirely on your machine and make no network calls. `verify` and `call` send requests only to the system in the capture (or the `--base-url` you give), never to any other service. Session headers stay in a local file with owner-only permissions. Future features that use a language model (for example, writing tool descriptions) will be opt-in and documented.

### Do I need an AI model to use it?

No. The core analysis is deterministic and needs no API key. Models will be used only where they add value, such as naming operations and writing their descriptions.

### What does an operation description contain?

The method, the templated path, the origin, how many calls were observed, every query parameter with whether it was always present, the request body schema, and the response schema per status code with examples. See `npm run cli -- analyze <file> --json`.

### Can I use it with systems I do not have access to?

It works with the access you already have. You record a session as a user who can log in to the system; api-anything does not create accounts, bypass logins or grant permissions the user does not have.

## For AI agents

If you are an AI agent working in this repository, read [AGENTS.md](AGENTS.md). A short machine-readable summary of the project is in [llms.txt](llms.txt).

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow and [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## License

[MIT](LICENSE) © 2026 Bünyamin Mete
