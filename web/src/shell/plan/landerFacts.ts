import type { LanderProfile } from "../../scenario/types";

const LAYOUT_RE = /(?:Layout|estimate): ([^;.]+)/;

export function landerFacts(p: LanderProfile): string {
  const layout = LAYOUT_RE.exec(p.description ?? "")?.[1];
  const panels = p.panels?.length ?? 0;
  const array = layout ? layout.charAt(0).toUpperCase() + layout.slice(1) : `${panels} solar panel${panels === 1 ? "" : "s"}`;
  return `${array} · antenna at ${p.antenna_height_m} m`;
}
