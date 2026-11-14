import { formatValue, glue } from "./format";
import { formatUtc, parseUtc } from "./time";

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

export function whenLines(when: ServedWhen | null | undefined, fmt?: (v: number) => string): WhenLine[] {
  if (!when) return [];
  const out: WhenLine[] = [];
  for (const [world, inst] of Object.entries(when)) {
    if (inst === undefined) continue;
    if (inst === null) {
      out.push({ world, t_ms: null, value: null, text: world === "nominal" ? "no nominal instant" : `no ${world} instant` });
      continue;
    }
    const ms = parseUtc(inst.utc);
    const at = ms === null ? inst.utc : formatUtc(ms);
    const value = typeof inst.value === "number" && Number.isFinite(inst.value) ? inst.value : null;
    const shown = value !== null && fmt ? `: ${fmt(value)}` : "";
    const hold = inst.hold_s !== 0 ? `, holds ${formatValue(inst.hold_s, "s", 0)}` : "";
    out.push({ world, t_ms: ms, value, text: `${world} ${glue(at)}${shown}${hold}` });
  }
  return out;
}
