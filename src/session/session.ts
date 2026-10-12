import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ApiCall } from "../har/parse.ts";
import { CREDENTIAL_PARAM, SESSION_HEADER } from "../credentials.ts";

export { SESSION_HEADER } from "../credentials.ts";

// The headers that carry a user's session (cookies, bearer tokens, CSRF
// tokens), taken from the most recent call to each origin. Kept in its own
// file, never inside the OpenAPI document, because it is a credential.

export interface Session {
  createdAt: string;
  // Credential headers per origin.
  origins: Record<string, Record<string, string>>;
  // Credential query parameters per origin, e.g. an API key the web app
  // sends in the URL.
  query?: Record<string, Record<string, string>>;
}

export const DEFAULT_SESSION_PATH = ".api-anything/session.json";


export function extractSession(calls: ApiCall[]): Session {
  const origins: Session["origins"] = {};
  const query: NonNullable<Session["query"]> = {};
  // Later calls win: the end of a capture holds the freshest session.
  for (const call of calls) {
    for (const [name, value] of call.url.searchParams) {
      if (CREDENTIAL_PARAM.test(name)) query[call.url.origin] = { ...query[call.url.origin], [name]: value };
    }
    const headers: Record<string, string> = {};
    for (const { name, value } of call.requestHeaders) {
      if (name.startsWith(":") || !SESSION_HEADER.test(name)) continue;
      headers[name.toLowerCase()] = value;
    }
    if (Object.keys(headers).length > 0) {
      origins[call.url.origin] = { ...origins[call.url.origin], ...headers };
    }
  }
  const session: Session = { createdAt: new Date().toISOString(), origins };
  if (Object.keys(query).length > 0) session.query = query;
  return session;
}

export async function saveSession(session: Session, path = DEFAULT_SESSION_PATH): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(session, null, 2) + "\n", { mode: 0o600 });
  await chmod(path, 0o600);
}

export async function loadSession(path = DEFAULT_SESSION_PATH): Promise<Session | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Session;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export function sessionHeaders(session: Session | undefined, origin: string): Record<string, string> {
  return session?.origins[origin] ?? {};
}

export function sessionQuery(session: Session | undefined, origin: string): Record<string, string> {
  return session?.query?.[origin] ?? {};
}
