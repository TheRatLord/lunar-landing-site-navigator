import type { ScenarioItem } from "../../api/planning";
import type { Candidate } from "../../scenario/alternatives";
import type { Scenario, ScenarioSummary } from "../../scenario/types";

export interface Source {
  key: string;
  group: "work" | "saved" | "alternative";
  name: string;
  detail: string;
  item: ScenarioItem;
}

export function buildSources(
  doc: Scenario | null,
  saved: readonly ScenarioSummary[],
  alternatives: readonly Candidate[],
  savedId: string | null,
): Source[] {
  const out: Source[] = [];
  if (doc) {
    out.push({
      key: "work",
      group: "work",
      name: doc.name,
      detail: `${doc.site.name || "unnamed site"} · the open plan, including unsaved edits`,
      item: { scenario: doc },
    });
    for (const a of alternatives) {
      out.push({
        key: `alt:${a.id}`,
        group: "alternative",
        name: `${doc.name} @ ${a.name}`,
        detail: `${a.name} · the open plan moved to this site`,
        item: {
          scenario: doc,
          overrides: {
            site: {
              lat_deg: a.lat_deg,
              lon_deg: a.lon_deg,
              name: a.name,
              catalog_id: a.catalog_id,
            },
          },
        },
      });
    }
  }
  for (const s of saved) {
    if (s.id === savedId && doc) continue;
    out.push({
      key: `saved:${s.id}`,
      group: "saved",
      name: s.name,
      detail: `Saved v${s.version}, ${s.updated_utc.slice(0, 16).replace("T", " ")}Z`,
      item: { scenario_id: s.id },
    });
  }
  return out;
}

export function uniqueNames(names: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const k = (seen.get(n) ?? 0) + 1;
    seen.set(n, k);
    return k === 1 ? n : `${n} (${k})`;
  });
}
