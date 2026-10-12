import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ApiCall } from "../har/parse.ts";

// The headers that carry a user's session (cookies, bearer tokens, CSRF
// tokens), taken from the most recent call to each origin. Kept in its own
// file, never inside the OpenAPI document, because it is a credential.

export interface Session {
  createdAt: string;
  origins: Record<string, Record<string, string>>;
}

export const DEFAULT_SESSION_PATH = ".api-anything/session.json";

export const SESSION_HEADER = /^(cookie|authorization)$|csrf|xsrf|token|api[-_]?key|session|auth/i;

export function extractSession(calls: ApiCall[]): Session {
  const origins: Session["origins"] = {};
  // Later calls win: the end of a capture holds the freshest session.
  for (const call of calls) {
    const headers: Record<string, string> = {};
    for (const { name, value } of call.requestHeaders) {
      if (name.startsWith(":") || !SESSION_HEADER.test(name)) continue;
      headers[name.toLowerCase()] = value;
    }
    if (Object.keys(headers).length > 0) {
      origins[call.url.origin] = { ...origins[call.url.origin], ...headers };
    }
  }
  return { createdAt: new Date().toISOString(), origins };
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
