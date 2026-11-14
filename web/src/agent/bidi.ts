const BIDI = /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/g;
const HAS_BIDI = /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/;

export function stripBidi(s: string): string {
  return HAS_BIDI.test(s) ? s.replace(BIDI, "") : s;
}

export function stripBidiDeep<T>(value: T): T {
  return walk(value) as T;
}

function walk(v: unknown): unknown {
  if (typeof v === "string") return stripBidi(v);
  if (Array.isArray(v)) {
    let changed = false;
    const out = v.map((x) => {
      const y = walk(x);
      if (y !== x) changed = true;
      return y;
    });
    return changed ? out : v;
  }
  if (v !== null && typeof v === "object") {
    const src = v as Record<string, unknown>;
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src)) {
      const nk = stripBidi(k);
      const y = walk(src[k]);
      if (nk !== k || y !== src[k]) changed = true;
      out[nk] = y;
    }
    return changed ? out : v;
  }
  return v;
}
