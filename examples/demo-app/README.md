# Demo HR app

A small fake HR app (employees, leave requests, a sign-in) to try api-anything on without an app of your own. All data is invented.

```bash
npx tsx examples/demo-app/server.ts            # http://localhost:4010
api-anything record http://localhost:4010 --out demo.har                      # sign in with the demo button, click around, close
api-anything record http://localhost:4010 --script examples/demo-app/steps.ts --out demo.har   # or let a script do it
api-anything openapi demo.har --out demo.json
api-anything session demo.har
api-anything ops demo.json
api-anything call demo.json listEmployees --status active
```

`steps.ts` is a recording script of the kind an AI agent writes: it signs in with the demo button, opens two employees and switches the status filter.
