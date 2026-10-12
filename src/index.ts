import { extractApiCalls, loadHar } from "./har/parse.ts";
import { groupEndpoints, type Endpoint } from "./endpoints/group.ts";

export { extractApiCalls, loadHar, parseBody, isApiEntry, type ApiCall } from "./har/parse.ts";
export { groupEndpoints, endpointKey, type Endpoint, type EndpointResponse, type QueryParameter } from "./endpoints/group.ts";
export { templatePath, isIdentifierSegment } from "./endpoints/normalize.ts";
export { inferSchema, mergeSchemas, type JsonSchema } from "./schema/infer.ts";
export { toOpenApi, operationIdFor, type OpenApiDocument, type OpenApiOptions } from "./openapi/export.ts";
export { validateAgainst, type SchemaIssue } from "./schema/validate.ts";
export { verifyCalls, explainStatus, type Verdict, type VerificationResult, type VerifyOptions } from "./verify/replay.ts";
export { extractSession, saveSession, loadSession, sessionHeaders, DEFAULT_SESSION_PATH, type Session } from "./session/session.ts";
export { loadOpenApi, listOperations, findOperation, buildUrl, callOperation, type OperationSummary, type CallRequest, type CallResult } from "./call/call.ts";
export { parseCallArgs, type CallArgs } from "./call/args.ts";
export { recordSession, sameSiteFilter, type RecordOptions, type RecordResult } from "./record/record.ts";
export type { Har, HarEntry } from "./har/types.ts";

export async function analyzeHar(path: string): Promise<Endpoint[]> {
  return groupEndpoints(extractApiCalls(await loadHar(path)));
}
