import { extractApiCalls, loadHar } from "./har/parse.ts";
import { groupEndpoints, type Endpoint } from "./endpoints/group.ts";

export { extractApiCalls, loadHar, parseBody, isApiEntry, type ApiCall } from "./har/parse.ts";
export { groupEndpoints, endpointKey, type Endpoint, type EndpointResponse, type QueryParameter } from "./endpoints/group.ts";
export { templatePath, isIdentifierSegment } from "./endpoints/normalize.ts";
export { inferSchema, mergeSchemas, type JsonSchema } from "./schema/infer.ts";
export type { Har, HarEntry } from "./har/types.ts";

export async function analyzeHar(path: string): Promise<Endpoint[]> {
  return groupEndpoints(extractApiCalls(await loadHar(path)));
}
