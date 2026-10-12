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

// Traffic that every site sends but that is never the app's own API:
// analytics, tag managers, error and session reporting, bot challenges.
const NOISE_HOSTS = [
  /(^|\.)google-analytics\.com$/, /(^|\.)analytics\.google\.com$/, /(^|\.)googletagmanager\.com$/,
  /(^|\.)doubleclick\.net$/, /(^|\.)facebook\.(com|net)$/, /(^|\.)hotjar\.(com|io)$/,
  /(^|\.)segment\.(io|com)$/, /(^|\.)mixpanel\.com$/, /(^|\.)amplitude\.com$/,
  /(^|\.)sentry\.io$/, /(^|\.)ingest\.sentry\.io$/, /(^|\.)browser-intake-[a-z0-9-]+\.datadoghq\.(com|eu)$/,
  /(^|\.)nr-data\.net$/, /(^|\.)clarity\.ms$/, /(^|\.)plausible\.io$/, /(^|\.)posthog\.com$/,
  /^(telemetry|analytics|stats|metrics|tracking|beacon|rum)\./,
];
const NOISE_PATHS = [/^\/cdn-cgi\//, /^\/_vercel\/insights\//, /^\/\.well-known\//];

export interface ExtractOptions {
  // Keep analytics, telemetry and bot-challenge traffic.
  keepNoise?: boolean;
}

export async function loadHar(path: string): Promise<Har> {
  const har = JSON.parse(await readFile(path, "utf8")) as Har;
  if (!har?.log || !Array.isArray(har.log.entries)) {
    throw new Error(`${path} is not a HAR file: missing log.entries`);
  }
  return har;
}

export function extractApiCalls(har: Har, options: ExtractOptions = {}): ApiCall[] {
  return har.log.entries
    .filter(isApiEntry)
    .filter((entry) => options.keepNoise || !isNoise(new URL(entry.request.url)))
    .map(toApiCall);
}

export function isNoise(url: URL): boolean {
  return NOISE_HOSTS.some((host) => host.test(url.hostname)) || NOISE_PATHS.some((path) => path.test(url.pathname));
}

export function isApiEntry(entry: HarEntry): boolean {
  let url: URL;
  try {
    url = new URL(entry.request.url);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  // Status 0 or below means the request never got an answer (aborted,
  // blocked, offline); there is nothing to learn from it.
  if (entry.response.status <= 0) return false;

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
