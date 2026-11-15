import { NBSP } from "./format";

export const REQUIREMENT_NAME: Record<string, string> = {
  min_total_sunlit_contact_h: "Sunlight with Earth link",
  max_dark_span_h: "Longest dark span",
  max_slope_deg: "Slope",
  min_state_of_charge: "Battery minimum",
  min_total_sunlit_h: "Sunlight total",
  min_total_contact_h: "Earth link total",
  landing_sun_elevation_deg: "Sun elevation",
  landing_hours_after_sunrise: "Since sunrise",
  dte_at_landing_deg: "Earth elevation",
  min_sunlit_hours_after_landing: "Sunlight after landing",
  min_contact_fraction: "Earth link share",
  max_contact_gap_h: "Earth link gap",
  min_link_margin_db: "Link margin",
};

export function requirementName(key: string | null | undefined, fallback?: string | null): string {
  if (!key) return fallback ?? "";
  return REQUIREMENT_NAME[key] ?? fallback ?? key;
}

const METRIC_NAME: Record<string, string> = {
  sun_elevation_at_landing_deg: "Sun elevation at landing",
  hours_after_sunrise_at_landing: "Since sunrise at landing",
  dte_clearance_at_landing_deg: "Earth elevation at landing",
  continuous_sunlight_after_landing_h: "Sunlight after landing",
  longest_dark_span_h: "Longest dark span",
  sunlit_hours: "Sunlight total",
  contact_fraction: "Earth link share",
  contact_hours: "Earth link total",
  contact_sunlit_hours: "Sunlight with Earth link",
  longest_outage_h: "Earth link gap",
  slope_deg: "Slope",
  time_to_next_earthset_h: "Earth link ends",
};

export function metricName(key: string, label: string): string {
  return METRIC_NAME[key] ?? REQUIREMENT_NAME[key] ?? label.replace(/ \(from landing\)$/, "").replace(/\bloss of contact\b/g, "Earth link loss").replace(/\bcontact\b/g, "Earth link");
}

const MINUS = "−";

function one(v: number): string {
  const s = v.toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

export function formatQuantity(v: number | null | undefined, unit: string | null | undefined, opts: { sign?: boolean } = {}): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const u = unit ?? "";
  let body: string;
  if (u === "h") body = a < 48 ? `${a.toFixed(1)}${NBSP}h` : `${one(a / 24)}${NBSP}d`;
  else if (u === "fraction" || u === "") body = `${Math.round(a * 100)}${NBSP}%`;
  else if (u === "deg" || u === "°") body = `${one(a)}°`;
  else body = `${one(a)}${NBSP}${u}`;
  const zero = body.startsWith("0") && !/[1-9]/.test(body.replace(/[^0-9]/g, ""));
  if (v < 0 && !zero) return MINUS + body;
  return opts.sign ? `+${body}` : body;
}

export function formatLimit(min: number | null | undefined, max: number | null | undefined, unit: string | null | undefined): string {
  const lo = min ?? null;
  const hi = max ?? null;
  if (lo !== null && hi !== null) return `${formatQuantity(lo, unit)}–${formatQuantity(hi, unit)}`;
  if (lo !== null) return `≥${NBSP}${formatQuantity(lo, unit)}`;
  if (hi !== null) return `≤${NBSP}${formatQuantity(hi, unit)}`;
  return "";
}

export interface RequirementOutcome {
  key: string;
  label?: string | null;
  unit: string;
  state: "pass" | "marginal" | "fail" | string;
  value: number | null;
  margin: number | null;
  marginWorst: number | null;
  worstValue: number | null;
  limitMin: number | null;
  limitMax: number | null;
  headingDependent?: boolean;
}

const fin = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function outcomeFromJson(c: {
  key: string;
  label?: string | null;
  unit: string;
  state: string;
  value: number | null;
  margin: number | null;
  margin_worst?: number | null;
  limit_min: number | null;
  limit_max: number | null;
  value_worlds?: Record<string, number | null> | null;
  worst_world?: string | null;
  heading_dependent?: boolean;
}): RequirementOutcome {
  return {
    key: c.key,
    label: c.label,
    unit: c.unit,
    state: c.state,
    value: fin(c.value),
    margin: fin(c.margin),
    marginWorst: fin(c.margin_worst),
    worstValue: c.worst_world ? fin(c.value_worlds?.[c.worst_world]) : null,
    limitMin: fin(c.limit_min),
    limitMax: fin(c.limit_max),
    headingDependent: c.heading_dependent === true,
  };
}

function share(o: RequirementOutcome, m: number | null): number {
  if (m === null) return -Infinity;
  const lim = Math.abs(o.limitMin ?? o.limitMax ?? 0);
  return lim > 0 ? m / lim : m;
}

export interface VerdictContext {
  batteryEveryHeading?: boolean;
  batteryWorst?: number | null;
}

function against(v: number, o: RequirementOutcome): string {
  const text = formatQuantity(v, o.unit);
  const lim = o.limitMin ?? o.limitMax;
  if (lim === null || v === lim || text !== formatQuantity(lim, o.unit)) return text;
  if (o.unit === "h" && Math.abs(v) >= 48) return `${(v / 24).toFixed(2)}${NBSP}d`;
  if (o.unit === "h") return `${v.toFixed(2)}${NBSP}h`;
  return text;
}

function limitOf(o: RequirementOutcome): string {
  return formatLimit(o.limitMin, o.limitMax, o.unit);
}

function failBits(o: RequirementOutcome, ctx: VerdictContext): { lead: string; limit: string } {
  const name = requirementName(o.key, o.label);
  if (o.key === "min_state_of_charge" && ctx.batteryEveryHeading) return { lead: `${name} ${formatQuantity(ctx.batteryWorst ?? o.worstValue ?? o.value ?? 0, o.unit)} at every heading`, limit: formatQuantity(o.limitMin ?? o.limitMax, o.unit) };
  const v = o.headingDependent ? (o.worstValue ?? o.value) : o.value;
  return { lead: `${name}${v !== null ? ` ${against(v, o)}` : ""}`, limit: limitOf(o) };
}

function failPart(o: RequirementOutcome, ctx: VerdictContext): string {
  const b = failBits(o, ctx);
  return `${b.lead}${b.limit ? ` (limit ${b.limit})` : ""}`;
}

const byShare = (a: RequirementOutcome, b: RequirementOutcome): number => share(a, a.margin ?? a.marginWorst) - share(b, b.margin ?? b.marginWorst);

export interface VerdictHeadline {
  word: string;
  lead: string | null;
  note: string | null;
}

export function verdictHeadline(overall: string, outcomes: readonly RequirementOutcome[], ctx: VerdictContext = {}): VerdictHeadline | null {
  const s = verdictSentence(overall, outcomes, ctx);
  if (!s) return null;
  const n = outcomes.length;
  if (overall === "pass") return { word: s.word, lead: n === 1 ? "Requirement met" : `All ${n} requirements met`, note: null };
  if (overall === "fail") {
    const failing = outcomes.filter((o) => o.state === "fail").sort(byShare);
    const first = failing[0];
    if (!first) return { word: s.word, lead: null, note: null };
    const b = failBits(first, ctx);
    const count = `${failing.length} of ${n} requirement${n === 1 ? "" : "s"} failed`;
    return { word: s.word, lead: b.lead, note: b.limit ? `Limit ${b.limit} · ${count}` : count };
  }
  const m = s.detail ? /^(.*) \(limit (.*)\)$/.exec(s.detail) : null;
  return m ? { word: s.word, lead: m[1]!, note: `Limit ${m[2]!}` } : { word: s.word, lead: s.detail, note: null };
}

export function verdictSentence(overall: string, outcomes: readonly RequirementOutcome[], ctx: VerdictContext = {}): { word: string; detail: string | null } | null {
  const n = outcomes.length;
  if (overall === "pass") return { word: "Pass", detail: n === 1 ? "requirement met" : `all ${n} requirements met` };
  if (overall === "fail") {
    const failing = outcomes.filter((o) => o.state === "fail").sort(byShare);
    if (failing.length === 0) return { word: "Fail", detail: null };
    return { word: "Fail", detail: `${failing.length} of ${n}: ${failing.map((o) => failPart(o, ctx)).join("; ")}` };
  }
  if (overall === "marginal") {
    const marginal = outcomes.filter((o) => o.state === "marginal").sort((a, b) => share(a, a.marginWorst ?? a.margin) - share(b, b.marginWorst ?? b.margin));
    const o = marginal[0];
    if (!o) return { word: "Marginal", detail: null };
    const name = requirementName(o.key, o.label);
    const lim = limitOf(o);
    const tail = lim ? ` (limit ${lim})` : "";
    if (o.key === "min_state_of_charge" && ctx.batteryEveryHeading) return { word: "Marginal", detail: failPart(o, ctx) };
    const w = o.worstValue ?? (o.marginWorst !== null ? (o.limitMax !== null ? o.limitMax - o.marginWorst : o.limitMin !== null ? o.limitMin + o.marginWorst : null) : null);
    if (w === null) return { word: "Marginal", detail: `${name}${tail}` };
    const dir = o.limitMax !== null && o.limitMin === null ? "up to" : o.limitMin !== null && o.limitMax === null ? "down to" : "at";
    return { word: "Marginal", detail: `${name} ${dir} ${against(w, o)} in the worst case${tail}` };
  }
  return null;
}

export function verdictText(overall: string, outcomes: readonly RequirementOutcome[], ctx: VerdictContext = {}): string | null {
  const s = verdictSentence(overall, outcomes, ctx);
  if (!s) return null;
  return s.detail ? `${s.word} · ${s.detail}` : s.word;
}
