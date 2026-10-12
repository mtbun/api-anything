// A small fake HR app to try api-anything on without an app of your own.
// Everything is invented. Run: npx tsx examples/demo-app/server.ts [port]
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

const PORT = Number(process.argv[2] ?? process.env.PORT ?? 4010);

const employees = [
  { id: 1042, name: "Ada Demo", team: "Platform", status: "active", startDate: "2023-03-01" },
  { id: 1043, name: "Linus Sample", team: "Platform", status: "active", startDate: "2024-07-15" },
  { id: 1044, name: "Grace Example", team: "Data", status: "active", startDate: "2022-11-20" },
  { id: 1045, name: "Alan Placeholder", team: "Data", status: "inactive", startDate: "2021-05-03" },
];
const leaveRequests = [
  { id: 501, employeeId: 1042, from: "2026-11-02", to: "2026-11-06", type: "annual", status: "approved" },
  { id: 502, employeeId: 1043, from: "2026-12-21", to: "2026-12-24", type: "annual", status: "pending" },
];
const sessions = new Set<string>();

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Demo HR</title>
<style>body{font:15px system-ui;margin:2rem;max-width:44rem}button{margin:.2rem}li{cursor:pointer}</style></head>
<body><h1>Demo HR</h1>
<label>Status <select id="status"><option>active</option><option>inactive</option></select></label>
<ul id="list"></ul><div id="detail"></div>
<button id="request" disabled>Request a day off</button>
<script>
let current;
async function load() {
  const status = document.getElementById("status").value;
  const res = await fetch("/api/v1/employees?status=" + status + "&page=1");
  const data = await res.json();
  document.getElementById("list").innerHTML = data.items.map(e => '<li data-id="' + e.id + '">' + e.name + '</li>').join("");
}
document.getElementById("status").onchange = load;
document.getElementById("list").onclick = async (ev) => {
  const id = ev.target.dataset.id; if (!id) return;
  current = await (await fetch("/api/v1/employees/" + id)).json();
  const leave = await (await fetch("/api/v1/leave-requests?employeeId=" + id)).json();
  document.getElementById("detail").textContent = current.name + " — " + leave.items.length + " leave request(s)";
  document.getElementById("request").disabled = false;
};
document.getElementById("request").onclick = () => fetch("/api/v1/leave-requests", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ employeeId: current.id, from: "2026-12-29", to: "2026-12-29", type: "annual" }),
});
load();
</script></body></html>`;

const LOGIN = `<!doctype html><html><body style="font:15px system-ui;margin:2rem">
<h1>Demo HR</h1><button id="demo">Sign in as demo user</button>
<script>document.getElementById("demo").onclick = async () => {
  await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ user: "demo" }) });
  location.href = "/";
};</script></body></html>`;

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function signedIn(req: IncomingMessage): boolean {
  const sid = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie ?? "")?.[1];
  return sid !== undefined && sessions.has(sid);
}

export function startDemoApp(port = PORT) {
  return createServer((req, res) => {
  const url = new URL(req.url!, `http://localhost:${PORT}`);
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    if (url.pathname === "/login") {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(LOGIN);
    }
    if (url.pathname === "/api/login" && req.method === "POST") {
      const sid = randomUUID();
      sessions.add(sid);
      res.writeHead(200, { "content-type": "application/json", "set-cookie": `sid=${sid}; Path=/; Max-Age=604800; HttpOnly` });
      return res.end(JSON.stringify({ user: { name: "Demo User", role: "manager" } }));
    }
    if (!signedIn(req)) {
      if (url.pathname.startsWith("/api/")) return json(res, 401, { error: "not signed in" });
      res.writeHead(302, { location: "/login" });
      return res.end();
    }
    if (url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(PAGE);
    }
    if (url.pathname === "/api/v1/employees" && req.method === "GET") {
      const status = url.searchParams.get("status") ?? "active";
      const items = employees.filter((e) => e.status === status).map(({ id, name, team }) => ({ id, name, team }));
      return json(res, 200, { items, page: Number(url.searchParams.get("page") ?? 1), total: items.length });
    }
    const employee = /^\/api\/v1\/employees\/(\d+)$/.exec(url.pathname);
    if (employee) {
      const found = employees.find((e) => e.id === Number(employee[1]));
      return found ? json(res, 200, found) : json(res, 404, { error: "no such employee" });
    }
    if (url.pathname === "/api/v1/leave-requests" && req.method === "GET") {
      const id = Number(url.searchParams.get("employeeId"));
      return json(res, 200, { items: leaveRequests.filter((l) => l.employeeId === id) });
    }
    if (url.pathname === "/api/v1/leave-requests" && req.method === "POST") {
      const input = JSON.parse(body || "{}") as { employeeId: number; from: string; to: string; type: string };
      const created = { id: 500 + leaveRequests.length + 1, ...input, status: "pending" };
      leaveRequests.push(created);
      return json(res, 201, created);
    }
    json(res, 404, { error: "not found" });
  });
}).listen(port, "127.0.0.1");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startDemoApp().on("listening", () => process.stderr.write(`Demo HR app on http://localhost:${PORT}\n`));
}
