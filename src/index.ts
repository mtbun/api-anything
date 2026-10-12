import { extractApiCalls, loadHar, type ExtractOptions } from "./har/parse.ts";
import { groupEndpoints, type Endpoint } from "./endpoints/group.ts";

export { extractApiCalls, loadHar, parseBody, isApiEntry, isNoise, type ApiCall, type ExtractOptions } from "./har/parse.ts";
export { isReadOperation, actionOf } from "./endpoints/actions.ts";
export { SESSION_HEADER, CREDENTIAL_PARAM } from "./credentials.ts";
export { groupEndpoints, endpointKey, type Endpoint, type EndpointResponse, type QueryParameter } from "./endpoints/group.ts";
export { templatePath, isIdentifierSegment } from "./endpoints/normalize.ts";
export { inferSchema, mergeSchemas, type JsonSchema } from "./schema/infer.ts";
export { toOpenApi, operationIdFor, type OpenApiDocument, type OpenApiOptions } from "./openapi/export.ts";
export { validateAgainst, type SchemaIssue } from "./schema/validate.ts";
export { verifyCalls, explainStatus, type Verdict, type VerificationResult, type VerifyOptions } from "./verify/replay.ts";
export { extractSession, saveSession, loadSession, sessionHeaders, sessionQuery, DEFAULT_SESSION_PATH, type Session } from "./session/session.ts";
export { refreshSession, looksUnauthenticated, SessionExpiredError, type RefreshOptions } from "./session/refresh.ts";
export { loadOpenApi, listOperations, findOperation, buildUrl, callOperation, type OperationSummary, type CallRequest, type CallResult } from "./call/call.ts";
export { parseCallArgs, type CallArgs } from "./call/args.ts";
export { recordSession, sameSiteFilter, loadRecordScript, type RecordOptions, type RecordResult, type RecordScript } from "./record/record.ts";
export { findDependencies, authSources, type Dependency, type DependencyEnd, type DependencyKind } from "./deps/deps.ts";
export { buildClientModel, type ClientModel, type ClientOperation } from "./client/model.ts";
export { renderTypeScript } from "./client/typescript.ts";
export { renderPython } from "./client/python.ts";
export { redactHar, redactHarFile } from "./har/redact.ts";
export { CREDENTIAL_FIELD } from "./credentials.ts";
export { credentialLifetimes, cookieExpiry, jwtExpiry, describeLifetime, isShortLived, expiredCredentials, type CredentialLifetime } from "./session/expiry.ts";
export type { Har, HarEntry } from "./har/types.ts";

export async function analyzeHar(path: string, options: ExtractOptions = {}): Promise<Endpoint[]> {
  return groupEndpoints(extractApiCalls(await loadHar(path), options));
}
