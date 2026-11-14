import { fuzzyScore } from "../../lib/fuzzy";
import type { SiteEntry } from "../../scenario/api";

export type SiteKind = SiteEntry["kind"];
export type Shape = "triangle" | "cross" | "diamond" | "square" | "ring" | "dot";

export interface KindStyle {
  label: string;
  shape: Shape;
  token: string;
  z: number;
}

export const KIND_STYLE: Record<SiteKind, KindStyle> = {
  planned: { label: "Planned", shape: "diamond", token: "c-sun", z: 6 },
  landed: { label: "Landed", shape: "triangle", token: "c-earth", z: 5 },
  not_landed: { label: "Not landed", shape: "square", token: "c-dark", z: 3 },
  impact: { label: "Impact", shape: "cross", token: "c-fail", z: 4 },
  region: { label: "Region", shape: "ring", token: "c-uncertainty", z: 2 },
  poi: { label: "Feature", shape: "dot", token: "text-2", z: 1 },
};

export const KIND_ORDER: readonly SiteKind[] = ["planned", "landed", "not_landed", "impact", "region", "poi"];

export interface SiteFilter {
  kinds: ReadonlySet<SiteKind>;
  confidence: string | null;
  status: string | null;
  query: string;
}

function matchScore(site: SiteEntry, query: string): number {
  const q = query.trim();
  if (!q) return 0;
  const fields = [site.name, site.mission, site.id.replace(/[-_]/g, " "), site.country, site.operator];
  let best = -1;
  for (const f of fields) {
    if (!f) continue;
    const s = fuzzyScore(q, f);
    if (s > best) best = s;
  }
  return best;
}

export function filterSites(sites: readonly SiteEntry[], f: SiteFilter): SiteEntry[] {
  const scored: Array<{ s: SiteEntry; score: number; i: number }> = [];
  sites.forEach((s, i) => {
    if (!f.kinds.has(s.kind)) return;
    if (f.confidence && s.confidence !== f.confidence) return;
    if (f.status && s.status !== f.status) return;
    const score = matchScore(s, f.query);
    if (score < 0) return;
    scored.push({ s, score, i });
  });
  if (f.query.trim()) scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.map((x) => x.s);
}

export function countBy(sites: readonly SiteEntry[], pick: (s: SiteEntry) => string): Array<{ value: string; count: number }> {
  const m = new Map<string, number>();
  for (const s of sites) {
    const v = pick(s);
    m.set(v, (m.get(v) ?? 0) + 1);
  }
  return [...m].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}
