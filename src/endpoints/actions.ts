// Many apps expose operations as POST /.../<verb>: a search is POST /query,
// an export is POST /export. The verb says what the call does better than
// the method does.

// POST actions that only read data: safe to replay and to call without
// --allow-writes.
const READ_ACTIONS = new Set(["query", "search", "find", "filter", "lookup", "count", "preview", "suggest", "autocomplete"]);

const ACTIONS = new Set([
  ...READ_ACTIONS,
  "login", "logout", "signin", "signout", "authenticate", "export", "import", "upload", "download",
  "send", "submit", "validate", "calculate", "batch", "refresh", "sync", "approve", "reject", "cancel",
]);

// The last literal (non-parameter) segment of a path template.
export function lastLiteral(pathTemplate: string): string | undefined {
  const segments = pathTemplate.split("/").filter(Boolean);
  const last = segments[segments.length - 1];
  return last && !last.startsWith("{") ? last : undefined;
}

export function actionOf(method: string, pathTemplate: string): string | undefined {
  if (method.toUpperCase() !== "POST") return undefined;
  const last = lastLiteral(pathTemplate)?.toLowerCase();
  return last && ACTIONS.has(last) ? last : undefined;
}

// RPC-style segments start with a verb: "get-pto-history", "delete-item",
// "saveDraft". The verb decides, whatever the HTTP method says: some apps
// delete with GET or read with POST.
const RPC_READ = /^(get|list|fetch|find|search|query|check|calculate|count|preview|lookup)(?:[-_]|[A-Z]|$)/;
const RPC_WRITE = /^(create|add|save|submit|update|set|delete|remove|cancel|approve|reject|send|upload|import|archive|restore|assign|close|reopen)(?:[-_]|[A-Z]|$)/;

export function isReadOperation(method: string, pathTemplate: string): boolean {
  const upper = method.toUpperCase();
  const last = lastLiteral(pathTemplate);
  if (last && RPC_WRITE.test(last)) return false;
  if (last && RPC_READ.test(last)) return true;
  if (upper === "GET" || upper === "HEAD" || upper === "OPTIONS") return true;
  const action = actionOf(upper, pathTemplate);
  return action !== undefined && READ_ACTIONS.has(action);
}
