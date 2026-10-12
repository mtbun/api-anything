import { chmod, readFile, writeFile } from "node:fs/promises";
import { CREDENTIAL_FIELD, REDACTED } from "../credentials.ts";
import type { Har } from "./types.ts";

// Masks secrets that a browser sends in request bodies (a login form's
// password, a one-time code) so they are never written to disk. Cookies and
// authorization headers stay: they are the session the other commands use.

export function redactHar(har: Har): number {
  let count = 0;
  for (const entry of har.log.entries) {
    const postData = entry.request.postData;
    if (!postData) continue;

    for (const param of postData.params ?? []) {
      if (CREDENTIAL_FIELD.test(param.name) && param.value !== REDACTED) {
        param.value = REDACTED;
        count += 1;
      }
    }
    if (!postData.text) continue;

    const mime = postData.mimeType?.toLowerCase() ?? "";
    if (mime.includes("x-www-form-urlencoded")) {
      const form = new URLSearchParams(postData.text);
      let changed = false;
      for (const [name, value] of form) {
        if (CREDENTIAL_FIELD.test(name) && value !== REDACTED) {
          form.set(name, REDACTED);
          changed = true;
          count += 1;
        }
      }
      if (changed) postData.text = form.toString();
      continue;
    }

    try {
      const body = JSON.parse(postData.text) as unknown;
      const masked = maskJson(body);
      if (masked.count > 0) {
        postData.text = JSON.stringify(masked.value);
        count += masked.count;
      }
    } catch {
      // Not JSON: leave as is.
    }
  }
  return count;
}

export async function redactHarFile(path: string): Promise<number> {
  const har = JSON.parse(await readFile(path, "utf8")) as Har;
  const count = redactHar(har);
  if (count > 0) await writeFile(path, JSON.stringify(har));
  await chmod(path, 0o600);
  return count;
}

function maskJson(value: unknown): { value: unknown; count: number } {
  if (Array.isArray(value)) {
    let count = 0;
    const out = value.map((item) => {
      const r = maskJson(item);
      count += r.count;
      return r.value;
    });
    return { value: out, count };
  }
  if (value !== null && typeof value === "object") {
    let count = 0;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (CREDENTIAL_FIELD.test(key) && (typeof child === "string" || typeof child === "number") && child !== REDACTED && child !== "") {
        out[key] = REDACTED;
        count += 1;
      } else {
        const r = maskJson(child);
        out[key] = r.value;
        count += r.count;
      }
    }
    return { value: out, count };
  }
  return { value, count: 0 };
}
