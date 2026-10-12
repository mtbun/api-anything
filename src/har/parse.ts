import { readFile } from "node:fs/promises";
import type { Har, HarEntry, HarNameValue } from "./types.ts";

// A request the browser made that looks like an application call rather than
// a page asset. Only these are worth turning into API operations.
export interface ApiCall {
  method: string;
  url: URL;
  requestHeaders: HarNameValue[];
  requestBody: unknown;
  // The body exactly as sent, for replaying the call.
  requestBodyText: string | undefined;
  requestMimeType: string | undefined;
  status: number;
  responseHeaders: HarNameValue[];
  responseBody: unknown;
  responseMimeType: string | undefined;
  startedAt: string | undefined;
}

const STATIC_EXTENSIONS = new Set([
  "js", "mjs", "css", "map", "png", "jpg", "jpeg", "gif", "svg", "webp", "ico",
  "avif", "woff", "woff2", "ttf", "otf", "eot", "mp4", "webm", "mp3", "wav",
]);

const API_RESOURCE_TYPES = new Set(["xhr", "fetch"]);

export async function loadHar(path: string): Promise<Har> {
  const har = JSON.parse(await readFile(path, "utf8")) as Har;
  if (!har?.log || !Array.isArray(har.log.entries)) {
    throw new Error(`${path} is not a HAR file: missing log.entries`);
  }
  return har;
}

export function extractApiCalls(har: Har): ApiCall[] {
  return har.log.entries.filter(isApiEntry).map(toApiCall);
}

export function isApiEntry(entry: HarEntry): boolean {
  let url: URL;
  try {
    url = new URL(entry.request.url);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;

  // Browsers record the resource type; when present it is the best signal.
  const type = entry._resourceType?.toLowerCase();
  if (type) return API_RESOURCE_TYPES.has(type);

  const extension = url.pathname.split(".").pop()?.toLowerCase();
  if (extension && url.pathname.includes(".") && STATIC_EXTENSIONS.has(extension)) {
    return false;
  }

  const mime = entry.response.content.mimeType?.toLowerCase() ?? "";
  return mime.includes("json") || mime.includes("xml") || entry.request.method !== "GET";
}

function toApiCall(entry: HarEntry): ApiCall {
  const { request, response } = entry;
  return {
    method: request.method.toUpperCase(),
    url: new URL(request.url),
    requestHeaders: request.headers,
    requestBody: parseBody(request.postData?.text, request.postData?.mimeType),
    requestBodyText: request.postData?.text,
    requestMimeType: request.postData?.mimeType,
    status: response.status,
    responseHeaders: response.headers,
    responseBody: parseBody(decode(response.content.text, response.content.encoding), response.content.mimeType),
    responseMimeType: response.content.mimeType,
    startedAt: entry.startedDateTime,
  };
}

function decode(text: string | undefined, encoding: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  return encoding === "base64" ? Buffer.from(text, "base64").toString("utf8") : text;
}

// JSON bodies become values; form bodies become objects; anything else is kept
// as raw text so nothing is silently dropped.
export function parseBody(text: string | undefined, mimeType: string | undefined): unknown {
  if (text === undefined || text === "") return undefined;
  const mime = mimeType?.toLowerCase() ?? "";
  if (mime.includes("json") || /^\s*[[{]/.test(text)) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  if (mime.includes("x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(text));
  }
  return text;
}
