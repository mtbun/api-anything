import { CREDENTIAL_FIELD, JWT } from "../credentials.ts";

// Infers a JSON Schema (draft 2020-12 subset) from observed sample values and
// merges schemas across samples. Deterministic: no model calls. Values of
// credential fields (password, token, secret, ...) and JWTs are never kept as
// examples.

export type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  format?: string;
  default?: unknown;
  examples?: unknown[];
};

const MAX_EXAMPLES = 3;

export function inferSchema(value: unknown): JsonSchema {
  if (value === null) return { type: "null" };
  if (Array.isArray(value)) {
    const items = value.map(inferSchema).reduce<JsonSchema | undefined>(
      (acc, s) => (acc ? mergeSchemas(acc, s) : s),
      undefined,
    );
    return items ? { type: "array", items } : { type: "array" };
  }
  switch (typeof value) {
    case "string":
      return JWT.test(value) ? { type: "string" } : withFormat({ type: "string", examples: [value] }, value);
    case "number":
      return { type: Number.isInteger(value) ? "integer" : "number", examples: [value] };
    case "boolean":
      return { type: "boolean" };
    case "object": {
      const entries = Object.entries(value as Record<string, unknown>);
      return {
        type: "object",
        properties: Object.fromEntries(
          entries.map(([k, v]) => [k, CREDENTIAL_FIELD.test(k) ? withoutExamples(inferSchema(v)) : inferSchema(v)]),
        ),
        required: entries.map(([k]) => k).sort(),
      };
    }
    default:
      return {};
  }
}

export function withoutExamples(schema: JsonSchema): JsonSchema {
  const { examples: _examples, default: _default, ...rest } = schema;
  const out: JsonSchema = { ...rest };
  if (schema.properties) {
    out.properties = Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, withoutExamples(v)]));
  }
  if (schema.items) out.items = withoutExamples(schema.items);
  return out;
}

export function mergeSchemas(a: JsonSchema, b: JsonSchema): JsonSchema {
  const types = unionTypes(a.type, b.type);
  const merged: JsonSchema = {};
  if (types.length > 0) merged.type = types.length === 1 ? types[0] : types;

  if (a.properties || b.properties) {
    const keys = new Set([...Object.keys(a.properties ?? {}), ...Object.keys(b.properties ?? {})]);
    merged.properties = {};
    for (const key of [...keys].sort()) {
      const left = a.properties?.[key];
      const right = b.properties?.[key];
      merged.properties[key] = left && right ? mergeSchemas(left, right) : (left ?? right)!;
    }
    // A field is required only if every sample carried it.
    const required = (a.required ?? []).filter((k) => (b.required ?? []).includes(k));
    if (a.properties && b.properties) merged.required = required;
    else merged.required = a.required ?? b.required ?? [];
  }

  if (a.items || b.items) {
    merged.items = a.items && b.items ? mergeSchemas(a.items, b.items) : (a.items ?? b.items);
  }

  if (a.format && a.format === b.format) merged.format = a.format;

  const examples = [...(a.examples ?? []), ...(b.examples ?? [])];
  const unique = [...new Map(examples.map((e) => [JSON.stringify(e), e])).values()];
  if (unique.length > 0) merged.examples = unique.slice(0, MAX_EXAMPLES);

  return merged;
}

function unionTypes(a: JsonSchema["type"], b: JsonSchema["type"]): string[] {
  const all = new Set([...toArray(a), ...toArray(b)]);
  // An integer seen alongside a non-integer number is just a number.
  if (all.has("integer") && all.has("number")) all.delete("integer");
  return [...all].sort();
}

function toArray(type: JsonSchema["type"]): string[] {
  if (type === undefined) return [];
  return Array.isArray(type) ? type : [type];
}

function withFormat(schema: JsonSchema, value: string): JsonSchema {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return { ...schema, format: "date-time" };
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return { ...schema, format: "date" };
  // Dots separate the domain labels unambiguously, so this stays linear on any input.
  if (value.length <= 320 && /^[^@\s]+@[^@\s.]+(?:\.[^@\s.]+)+$/.test(value)) return { ...schema, format: "email" };
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    return { ...schema, format: "uuid" };
  }
  return schema;
}
