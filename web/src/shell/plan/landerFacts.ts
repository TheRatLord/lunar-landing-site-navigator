import type { LanderProfile } from "../../scenario/types";

const LAYOUT_RE = /(?:Layout|estimate): ([^;.(]+)/;

const SHORT: Array<[RegExp, string]> = [
  [/top deck plus two/i, "Top deck + two side panels"],
  [/side panels/i, "Two side panels"],
  [/tracking/i, "Sun-tracking array"],
  [/top-deck/i, "Top-deck array"],
];

export function landerFacts(p: LanderProfile): string {
  const layout = LAYOUT_RE.exec(p.description ?? "")?.[1]?.trim();
  const panels = p.panels?.length ?? 0;
  const array = (layout && SHORT.find(([re]) => re.test(layout))?.[1]) ?? `${panels} solar panel${panels === 1 ? "" : "s"}`;
  return `${array} · antenna ${p.antenna_height_m} m`;
}
