# api-anything

**api-anything turns web-based business systems that have no public API into typed APIs and MCP tools for AI agents.** You use the system once in a normal browser session; api-anything reads the recorded traffic, finds the operations the web app calls behind the scenes, and describes them as API operations that an agent or a script can call directly.

> API anything with agents. ERP screens, internal admin panels and legacy portals become callable operations.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Node 22+](https://img.shields.io/badge/node-%3E%3D22-brightgreen)
![Status: early](https://img.shields.io/badge/status-early-orange)

---

## What problem does api-anything solve?

Most companies run on web systems that their staff already use every day: ERPs, order and inventory screens, HR and finance portals, supplier portals, internal admin panels. Many of these systems offer no API, or an API that does not cover what the screens can do. The result is manual work: copying orders into spreadsheets, re-typing data between systems, clicking through the same forms every morning.

The web interface of such a system already talks to a server through structured requests. api-anything makes those requests visible and reusable, so the work your team does by hand in the browser can be done by an AI agent or a script, with the same access the user already has.

## How does it work?

```
1. Record     Use the system normally in a browser and save the session as a HAR file.
2. Analyze    api-anything filters out pages and assets and keeps the application calls.
3. Describe   Calls to the same operation are merged: /orders/1042 and /orders/1043
              become GET /orders/{orderId}, with query parameters and JSON schemas
              inferred from every observed request and response.
4. Export     Write an OpenAPI 3.1 document that any OpenAPI tool can read.
5. Use        (roadmap) Generate a typed client, or serve the operations as
              MCP tools that Claude Code, Codex or Cursor can call.
```

The analysis is deterministic: parsing, grouping and schema inference involve no model calls, cost nothing to run and produce the same output every time.

## Quick start

Requirements: Node.js 22 or newer.

```bash
git clone https://github.com/mtbun/api-anything.git
cd api-anything
npm install
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

### How do I record a HAR file?

In Chrome or Edge: open DevTools (F12) → **Network** tab → tick **Preserve log** → use the system as you normally would → right-click the request list → **Save all as HAR with content**. Firefox has the same option in its Network panel.

A HAR file contains everything the browser sent and received, including session cookies. Treat it like a password: keep it local and do not commit it. The repository's `.gitignore` excludes `*.har` outside the test fixtures.

## What can I use it for?

| Situation | What api-anything gives you |
|---|---|
| An ERP with no API for the screens your team uses | The operations behind those screens, ready to be called by an agent or a script |
| Daily manual exports from an internal panel | A repeatable call that returns the same data as JSON |
| Moving data between two systems that cannot talk to each other | Described operations on both sides to build the integration on |
| An internal service whose API was never documented | A generated description of the endpoints it actually serves |
| Giving an AI agent access to a company system | Operations an agent can call directly instead of clicking through the UI |

## How is this different from browser automation or RPA?

| | RPA / browser automation | api-anything |
|---|---|---|
| What it repeats | Clicks and keystrokes on the screen | The underlying requests the screen sends |
| Speed | Seconds to minutes per task, waits for pages to render | One request per operation |
| Breaks when | The layout, a label or a button position changes | The server-side request format changes |
| Output | A recorded script | Typed operations with schemas (OpenAPI and MCP on the roadmap) |
| Fit for AI agents | The agent has to drive a browser | The agent calls operations directly |

Browser automation is still the right tool when a task depends on what is rendered on screen. api-anything is for the large share of business tasks that are really "read these records" or "submit this form".

## Status and roadmap

api-anything is early. What exists today and what is planned:

- [x] HAR parsing, with pages and static assets filtered out
- [x] Path templating: numeric IDs, UUIDs, dates and opaque IDs become named parameters
- [x] Grouping of calls into operations with call counts and status codes
- [x] Query parameter detection (required vs optional)
- [x] JSON schema inference for request and response bodies, merged across calls
- [x] CLI: `analyze` with text and JSON output
- [x] OpenAPI 3.1 export with REST-style operation IDs and typed parameters
- [ ] Session capture with Playwright, without manual HAR export
- [ ] Session and request-dependency mapping (which call provides the token or ID the next call needs)
- [ ] Replay verification: every operation is re-run and reported as working or failing, with the reason
- [ ] MCP server: serve discovered operations as tools for AI agents
- [ ] Typed client generation (TypeScript and Python)

## FAQ

### Is this an alternative to an official API?

No. If a system has an official API that covers your needs, use it. api-anything is for the systems, or the parts of systems, where no API exists and the only interface is the web screen.

### Which systems does it work with?

Any system whose web interface loads data through HTTP requests, which covers most modern web applications, single-page apps and many older systems that use XHR. Systems that render everything on the server and only exchange full HTML pages expose fewer reusable operations.

### Does it send my data anywhere?

No. The current analysis runs entirely on your machine and makes no network calls. Future features that use a language model (for example, writing tool descriptions) will be opt-in and documented.

### Do I need an AI model to use it?

No. The core analysis is deterministic and needs no API key. Models will be used only where they add value, such as naming operations and writing descriptions for MCP tools.

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
