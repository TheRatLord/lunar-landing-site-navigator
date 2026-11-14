import schema from "../api/openapi.json";
import type { Scenario } from "./types";

interface JsonSchema {
  $ref?: string;
  type?: string;
  anyOf?: JsonSchema[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  prefixItems?: JsonSchema[];
  enum?: unknown[];
  default?: unknown;
}

const SCHEMAS = schema.components.schemas as unknown as Record<string, JsonSchema>;

export interface NormalizeProblem {
  path: string;
  message: string;
}

export interface Normalized {
  scenario: Scenario | null;
  unknownFields: string[];
  problems: NormalizeProblem[];
}

interface Ctx {
  unknown: string[];
  problems: NormalizeProblem[];
}

function resolve(s: JsonSchema): JsonSchema {
  let cur = s;
  while (cur.$ref) {
    const name = cur.$ref.split("/").pop() ?? "";
    const target = SCHEMAS[name];
    if (!target) throw new Error(`openapi.json: unresolved ${cur.$ref}`);
    cur = target;
  }
  return cur;
}

const join = (path: string, key: string | number): string => (path ? `${path}.${key}` : String(key));

function jsonType(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}

function typeMatches(v: unknown, type: string): boolean {
  const t = jsonType(v);
  return t === type || (type === "number" && t === "integer");
}

function describe(type: string): string {
  return type === "integer" ? "a whole number" : type === "array" ? "a list" : type === "object" ? "an object" : `a ${type}`;
}

function walk(value: unknown, s: JsonSchema, path: string, ctx: Ctx): unknown {
  const sc = resolve(s);
  if (sc.anyOf) {
    if (value === null && sc.anyOf.some((b) => resolve(b).type === "null")) return null;
    const branches = sc.anyOf.filter((b) => resolve(b).type !== "null");
    let first: { out: unknown; ctx: Ctx } | null = null;
    for (const b of branches) {
      const sub: Ctx = { unknown: [], problems: [] };
      const out = walk(value, b, path, sub);
      if (!sub.problems.length) {
        ctx.unknown.push(...sub.unknown);
        return out;
      }
      first ??= { out, ctx: sub };
    }
    if (first) {
      ctx.unknown.push(...first.ctx.unknown);
      ctx.problems.push(...first.ctx.problems);
      return first.out;
    }
    return value;
  }
  if (sc.type && !typeMatches(value, sc.type)) {
    ctx.problems.push({ path, message: `expected ${describe(sc.type)}, found ${jsonType(value)}` });
    return value;
  }
  if (sc.enum && !sc.enum.includes(value)) {
    ctx.problems.push({ path, message: `“${String(value)}” is not one of ${sc.enum.map(String).join(", ")}` });
    return value;
  }
  if (sc.type === "array" && Array.isArray(value)) {
    return value.map((item, i) => {
      const itemSchema = sc.prefixItems?.[i] ?? sc.items;
      return itemSchema ? walk(item, itemSchema, join(path, i), ctx) : item;
    });
  }
  if ((sc.type === "object" || sc.properties) && value && typeof value === "object" && !Array.isArray(value)) {
    const src = value as Record<string, unknown>;
    const props = sc.properties ?? {};
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(src)) {
      const ps = props[key];
      if (ps) out[key] = walk(v, ps, join(path, key), ctx);
      else if (sc.additionalProperties === false) ctx.unknown.push(join(path, key));
      else if (sc.additionalProperties && typeof sc.additionalProperties === "object") out[key] = walk(v, sc.additionalProperties, join(path, key), ctx);
      else out[key] = v;
    }
    for (const [key, ps] of Object.entries(props)) {
      if (key in src) continue;
      if ("default" in ps) out[key] = walk(structuredClone(ps.default), ps, join(path, key), ctx);
      else if (sc.required?.includes(key)) ctx.problems.push({ path: join(path, key), message: "missing (required)" });
    }
    return out;
  }
  return value;
}

export function normalizeScenario(raw: unknown): Normalized {
  const ctx: Ctx = { unknown: [], problems: [] };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { scenario: null, unknownFields: [], problems: [{ path: "", message: `expected a scenario object, found ${jsonType(raw)}` }] };
  }
  const out = walk(raw, { $ref: "#/components/schemas/Scenario" }, "", ctx);
  const scenario = ctx.problems.length ? null : (out as Scenario);
  return { scenario, unknownFields: ctx.unknown, problems: ctx.problems };
}

export function schemaDefaults(name: string): Record<string, unknown> {
  const sc = SCHEMAS[name];
  if (!sc) throw new Error("openapi.json has no schema " + name);
  const out: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(sc.properties ?? {})) if ("default" in prop) out[key] = structuredClone(prop.default);
  return out;
}

export function formatProblems(problems: NormalizeProblem[]): string[] {
  return problems.map((p) => (p.path ? `${p.path}: ${p.message}` : p.message));
}
