export type RowDeclaration = Record<string, string>;
type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function rowId(v: unknown): string | null {
  if (typeof v === "string") return v.replace(/[^A-Za-z0-9_.:-]+/g, "-").replace(/^-+|-+$/g, "") || null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

const globToRegExp = (g: string): RegExp => new RegExp(`^${g.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);

function declaredKey(declared: RowDeclaration, path: string): string | null {
  if (path in declared) return declared[path] || null;
  for (const [k, v] of Object.entries(declared)) if (k.includes("*") && globToRegExp(k).test(path)) return v || null;
  return null;
}

export interface CitedRow {
  id: string;
  path: string;
  item: Obj;
}

function collectRows(doc: unknown, declared?: RowDeclaration | null): CitedRow[] {
  const out: CitedRow[] = [];
  const walk = (node: unknown, path: string, shown: string, parent: string | null) => {
    if (Array.isArray(node)) {
      node.forEach((x, i) => walk(x, path, `${shown}[${i}]`, parent));
      return;
    }
    if (!isObj(node)) return;
    for (const [k, v] of Object.entries(node)) {
      const p = path === "" ? k : `${path}.${k}`;
      const s = shown === "" ? k : `${shown}.${k}`;
      let ids: (string | null)[] = [];
      if (Array.isArray(v) && v.length >= 2) {
        const key = declared ? declaredKey(declared, p) : null;
        ids = key ? v.map((x) => (isObj(x) ? rowId(x[key]) : null)) : [];
      }
      if (ids.length > 0 && ids.every((i) => i !== null)) {
        (v as unknown[]).forEach((item, i) => {
          const full = parent === null ? ids[i]! : `${parent}/${ids[i]!}`;
          const at = `${s}[${i}]`;
          out.push({ id: full, path: at, item: item as Obj });
          walk(item, p, at, full);
        });
      } else walk(v, p, s, parent);
    }
  };
  walk(doc, "", "", null);
  return out;
}

export function findCitedRow(doc: unknown, row: string, declared?: RowDeclaration | null): CitedRow | null {
  return collectRows(doc, declared).find((r) => r.id === row) ?? null;
}

export function hasRowTable(doc: unknown, declared?: RowDeclaration | null): boolean {
  return collectRows(doc, declared).length > 0;
}

export function parseResult(text: string | null | undefined): unknown {
  if (typeof text !== "string") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
