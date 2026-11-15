import { spanText, whenText } from "../components/viz/units";
import { glue } from "./format";
import { parseUtc } from "./time";

interface ServedInstant {
  utc: string;
  value?: number;
  hold_s: number;
}

export type ServedWhen = Readonly<Record<string, ServedInstant | null | undefined>>;

export interface WhenLine {
  world: string;
  t_ms: number | null;
  value: number | null;
  text: string;
}

export const caseName = (world: string): string => (world === "pessimistic" ? "worst case" : world === "optimistic" ? "best case" : world);

export function whenLines(when: ServedWhen | null | undefined, fmt?: (v: number) => string): WhenLine[] {
  if (!when) return [];
  const out: WhenLine[] = [];
  for (const [world, inst] of Object.entries(when)) {
    if (inst === undefined) continue;
    if (inst === null) {
      out.push({ world, t_ms: null, value: null, text: `${caseName(world)}: none` });
      continue;
    }
    const ms = parseUtc(inst.utc);
    const at = ms === null ? inst.utc : whenText(ms);
    const value = typeof inst.value === "number" && Number.isFinite(inst.value) ? inst.value : null;
    const shown = value !== null && fmt ? `: ${fmt(value)}` : "";
    const hold = inst.hold_s !== 0 ? `, holds ${spanText(inst.hold_s * 1000)}` : "";
    out.push({ world, t_ms: ms, value, text: `${caseName(world)} ${glue(at)}${shown}${hold}` });
  }
  return out;
}
