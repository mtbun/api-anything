import type { JsonSchema } from "./infer.ts";

// Checks a value against an inferred schema and reports every difference.
// Extra fields are allowed: a replay that returns more than was observed is
// not a failure.

export interface SchemaIssue {
  path: string;
  message: string;
}

export function validateAgainst(value: unknown, schema: JsonSchema, path = "$"): SchemaIssue[] {
  const allowed = typesOf(schema);
  const actual = typeOf(value);
  if (allowed.length > 0 && !allowed.includes(actual) && !(actual === "integer" && allowed.includes("number"))) {
    return [{ path, message: `expected ${allowed.join(" | ")}, got ${actual}` }];
  }

  const issues: SchemaIssue[] = [];
  if (actual === "object" && schema.properties) {
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in record)) issues.push({ path: `${path}.${key}`, message: "missing required field" });
    }
    for (const [key, child] of Object.entries(schema.properties)) {
      if (key in record) issues.push(...validateAgainst(record[key], child, `${path}.${key}`));
    }
  }
  if (actual === "array" && schema.items) {
    (value as unknown[]).forEach((item, i) => issues.push(...validateAgainst(item, schema.items!, `${path}[${i}]`)));
  }
  return issues;
}

function typesOf(schema: JsonSchema): string[] {
  if (schema.type === undefined) return [];
  return Array.isArray(schema.type) ? schema.type : [schema.type];
}

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}
