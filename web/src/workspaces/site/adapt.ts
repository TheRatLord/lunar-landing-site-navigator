import { wrap360 } from "../../lib/scale";
import type {
  ConstraintVerdict,
  CrossingEvent,
  CountdownKind,
  BandSeries,
  ConstraintCase,
  LimitSide,
  HorizonProfile,
  Interval,
  IntervalRow,
  LineMark,
  LineRow,
  StationMarker,
  SunlightSeries,
  TargetTrack,
  TimelineRow,
  Verdict,
} from "../../contract/types";
import { formatNum, formatSignedValue, formatValue, glue, glueQuantities, withUnit } from "../../lib/format";
import { formatUtc, toIsoUtc, parseUtc } from "../../lib/time";
import { headingFacts } from "../calendar/format";
import { whenLines, type WhenLine } from "../../lib/when";
import { intervalsContain } from "../../lib/intervals";
import { interpTrack } from "../../lib/track";
import type { BlockerMark } from "../../scenario/alternatives";
import { storeCovers } from "../../scenario/terrainStack";
import { UNPUBLISHED_BASES, type Basis, type Origin, type Scenario } from "../../scenario/types";
import type { BlockerPoint, Column, ConstraintBoundJson, ConstraintVerdictJson, EvaluateResult, EvaluateSeries, HeadingJson, HorizonCurve, IntervalJson, LimitNoteJson, MetricJson, NextEventJson, Observer, Provenance, TerrainStackJson, TerrainStoreJson } from "../../api/site";

export function toArray(c: Column | undefined | null): Float64Array {
  const n = c?.length ?? 0;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = c![i] ?? NaN;
  return out;
}

function seriesColumn(s: EvaluateSeries, name: string): Float64Array | null {
  const c = s[name];
  if (!Array.isArray(c) || (c.length > 0 && typeof c[0] === "string")) return null;
  const out = new Float64Array(c.length);
  for (let i = 0; i < c.length; i++) {
    const v: unknown = c[i];
    out[i] = typeof v === "number" ? v : NaN;
  }
  return out;
}

export function adaptHorizon(h: Pick<HorizonCurve, "az_deg" | "elev_deg" | "elev_lo_deg" | "elev_hi_deg" | "blocker_dist_m">): HorizonProfile {
  return {
    az_deg: toArray(h.az_deg),
    elev_deg: toArray(h.elev_deg),
    elev_lo_deg: toArray(h.elev_lo_deg),
    elev_hi_deg: toArray(h.elev_hi_deg),
    blocker_dist_m: toArray(h.blocker_dist_m),
  };
}

export function observerHeightM(scenario: Scenario, observer: Observer): number {
  return observer === "array" ? scenario.profile.array_height_m : scenario.profile.antenna_height_m;
}

export function adaptTrack(s: EvaluateSeries, body: "sun" | "earth"): TargetTrack | null {
  const az = seriesColumn(s, `${body}_az_deg`);
  const el = seriesColumn(s, `${body}_el_deg`);
  const t = seriesColumn(s, "t_ms");
  if (!az || !el || !t) return null;
  const rad = seriesColumn(s, `${body}_ang_radius_deg`);
  if (!rad) return null;
  return { utc_ms: t, az_deg: az, el_deg: el, ang_radius_deg: rad };
}

export function adaptSunlight(s: EvaluateSeries): SunlightSeries | null {
  const t = seriesColumn(s, "t_ms");
  const f = seriesColumn(s, "sunlight_fraction");
  if (!t || !f) return null;
  const lo = seriesColumn(s, "sunlight_fraction_lo");
  const hi = seriesColumn(s, "sunlight_fraction_hi");
  const ecl = seriesColumn(s, "eclipse_fraction");
  return { utc_ms: t, fraction: f, ...(lo && hi ? { lo, hi } : {}), ...(ecl ? { eclipse: ecl } : {}) };
}

export function adaptClearance(s: EvaluateSeries): BandSeries | null {
  const t = seriesColumn(s, "t_ms");
  const v = seriesColumn(s, "contact_clearance_deg");
  if (!t || !v) return null;
  const lo = seriesColumn(s, "contact_clearance_deg_lo");
  const hi = seriesColumn(s, "contact_clearance_deg_hi");
  return { utc_ms: t, value: v, ...(lo && hi ? { lo, hi } : {}) };
}

export function adaptStations(s: EvaluateSeries, intervals: Readonly<Record<string, readonly IntervalJson[]>>, scenario: Scenario | null, timeMs: number): StationMarker[] {
  const t = seriesColumn(s, "t_ms");
  if (!t || t.length === 0 || timeMs < t[0]! || timeMs > t[t.length - 1]!) return [];
  const out: StationMarker[] = [];
  for (const key of Object.keys(s)) {
    if (!key.startsWith("station_az_deg:")) continue;
    const id = key.slice("station_az_deg:".length);
    const az = seriesColumn(s, key);
    const el = seriesColumn(s, `station_dir_el_deg:${id}`);
    if (!az || !el) continue;
    const rows = intervals[`contact:${id}`];
    const contact = rows ? adaptIntervals(rows, [t[0]!, t[t.length - 1]!]).best : [];
    const track: TargetTrack = { utc_ms: t, az_deg: az, el_deg: el, ang_radius_deg: new Float64Array(t.length) };
    const p = interpTrack(track, timeMs);
    if (!p || !Number.isFinite(p.az_deg) || !Number.isFinite(p.el_deg)) continue;
    const meta = scenario?.network.stations.find((x) => x.id === id || x.name === id);
    out.push({
      id,
      label: meta?.name || meta?.id || id,
      az_deg: p.az_deg,
      el_deg: p.el_deg,
      in_contact: intervalsContain(contact, timeMs),
    });
  }
  return out;
}

function interval(start_ms: number, end_ms: number, start_open: boolean, end_open: boolean, duration_h?: number | null): Interval {
  const out: Interval = { start_ms, end_ms };
  if (start_open) out.start_open = true;
  if (end_open) out.end_open = true;
  if (typeof duration_h === "number") out.duration_h = duration_h;
  return out;
}

export function parseSec(text: string | null | undefined): number | null {
  const ms = parseUtc(text ?? null);
  return ms === null ? null : Math.round(ms / 1000) * 1000;
}

function edgeRange(r: readonly (string | null)[], fallback: number): [number, number] {
  const a = parseSec(r[0] ?? null) ?? fallback;
  const b = parseSec(r[1] ?? null) ?? fallback;
  return a <= b ? [a, b] : [b, a];
}

type World = "optimistic" | "pessimistic";

function edgeIn(worlds: readonly string[] | null | undefined, range: readonly (string | null)[], world: World, fallback: number): number | undefined {
  if (worlds === undefined) return undefined;
  const i = worlds === null ? 0 : worlds.indexOf(world);
  return i < 0 ? undefined : (parseSec(range[i] ?? null) ?? fallback);
}

function adaptIntervals(rows: readonly IntervalJson[], span: readonly [number, number]): { best: Interval[]; optimistic?: Interval[]; pessimistic?: Interval[] } {
  const best: Interval[] = [];
  const worlds: Record<World, Interval[] | undefined> = { optimistic: [], pessimistic: [] };
  for (const r of rows) {
    const startOpen = r.start_censored || r.start_range_censored || r.start_range_utc.includes(null);
    const endOpen = r.end_censored || r.end_range_censored || r.end_range_utc.includes(null);
    if (r.nominal) {
      const s = parseSec(r.start_utc) ?? span[0];
      const e = parseSec(r.end_utc) ?? span[1];
      if (Number.isFinite(s) && Number.isFinite(e)) best.push(interval(s, e, r.start_censored || r.start_utc === null, r.end_censored || r.end_utc === null, r.duration_h));
    }
    for (const w of ["optimistic", "pessimistic"] as const) {
      if (worlds[w] === undefined) continue;
      const s = edgeIn(r.start_worlds, r.start_range_utc, w, span[0]);
      const e = edgeIn(r.end_worlds, r.end_range_utc, w, span[1]);
      if (s === undefined || e === undefined) {
        if (r.certain) worlds[w] = undefined;
        continue;
      }
      if (Number.isFinite(s) && Number.isFinite(e)) worlds[w]!.push(interval(s, e, startOpen, endOpen));
    }
  }
  return { best, ...(worlds.optimistic ? { optimistic: worlds.optimistic } : {}), ...(worlds.pessimistic ? { pessimistic: worlds.pessimistic } : {}) };
}

function intervalRow(id: string, label: string, color: string, rows: readonly IntervalJson[] | undefined, span: readonly [number, number]): IntervalRow | null {
  if (!rows) return null;
  const a = adaptIntervals(rows, span);
  return { kind: "intervals", id, label, color, ...a };
}

const EVENT_EDGE: Record<CountdownKind, { set: "sunlit" | "contact"; edge: "end" | "start" }> = {
  sunset: { set: "sunlit", edge: "end" },
  sunrise: { set: "sunlit", edge: "start" },
  earthset: { set: "contact", edge: "end" },
  earthrise: { set: "contact", edge: "start" },
};

function serviceName(best: number, ne: NextEventJson | null | undefined): Pick<CrossingEvent, "title" | "cause"> {
  const utc = ne ? parseSec(ne.utc) : null;
  if (!ne || utc === null || Math.abs(utc - best) >= 1000) return {};
  const out: Pick<CrossingEvent, "title" | "cause"> = {};
  if (ne.name) out.title = ne.name;
  if (ne.cause) out.cause = ne.cause;
  return out;
}

export function crossingEvents(intervals: Record<string, IntervalJson[]>, nextEvents?: Record<string, NextEventJson | null>): CrossingEvent[] {
  const out: CrossingEvent[] = [];
  for (const kind of Object.keys(EVENT_EDGE) as CountdownKind[]) {
    const { set, edge } = EVENT_EDGE[kind];
    for (const r of intervals[set] ?? []) {
      if (!r.nominal) continue;
      if (edge === "end" ? r.end_censored : r.start_censored) continue;
      const best = parseSec(edge === "end" ? r.end_utc : r.start_utc);
      if (best === null) continue;
      const raw = edge === "end" ? r.end_range_utc : r.start_range_utc;
      const [lo, hi] = edgeRange(raw, best);
      const ev: CrossingEvent = { kind, best_ms: best, earliest_ms: Math.min(lo, best), latest_ms: Math.max(hi, best), ...serviceName(best, nextEvents?.[kind]) };
      if (raw[0] === null || (edge === "start" && r.start_range_censored)) ev.earliest_open = true;
      if (raw[1] === null || (edge === "end" && r.end_range_censored)) ev.latest_open = true;
      out.push(ev);
    }
  }
  return out.sort((a, b) => a.best_ms - b.best_ms);
}

function eventTitle(kind: CountdownKind, e: CrossingEvent | null): string {
  return e?.title ? e.title.charAt(0).toUpperCase() + e.title.slice(1) : KIND_LABEL[kind];
}

export function eventName(kind: CountdownKind, e: CrossingEvent | null): string {
  return e?.title && e.cause ? `${eventTitle(kind, e)} (${e.cause})` : eventTitle(kind, e);
}

export function nextCrossing(events: readonly CrossingEvent[], kind: CountdownKind, ms: number): CrossingEvent | null {
  let best: CrossingEvent | null = null;
  for (const e of events) if (e.kind === kind && e.best_ms > ms && (best === null || e.best_ms < best.best_ms)) best = e;
  return best;
}

export interface EventDelta {
  kind: CountdownKind;
  terrain: CrossingEvent | null;
  sphere: CrossingEvent | null;
  delta_min: number | null;
}

export const COUNTDOWN_KINDS: readonly CountdownKind[] = ["sunset", "sunrise", "earthset", "earthrise"];

export function eventDeltas(terrain: readonly CrossingEvent[], sphere: readonly CrossingEvent[], ms: number): EventDelta[] {
  return COUNTDOWN_KINDS.map((kind) => {
    const t = nextCrossing(terrain, kind, ms);
    const s = nextCrossing(sphere, kind, ms);
    return { kind, terrain: t, sphere: s, delta_min: t && s ? (t.best_ms - s.best_ms) / 60_000 : null };
  });
}

const DECIMALS_BY_UNIT: Record<string, number> = { deg: 2, h: 2, fraction: 3, dB: 2, "": 2 };

function decimalsFor(unit: string): number {
  return DECIMALS_BY_UNIT[unit] ?? 2;
}

function casesOf<T>(v: Record<string, T | null> | undefined): Record<ConstraintCase, T | null> | undefined {
  if (!v) return undefined;
  return { nominal: v.nominal ?? null, optimistic: v.optimistic ?? null, pessimistic: v.pessimistic ?? null };
}

function adaptConstraint(c: ConstraintVerdictJson): ConstraintVerdict | null {
  if (c.state !== "pass" && c.state !== "marginal" && c.state !== "fail") return null;
  const hd = c.heading_dependent === true;
  if (!hd && (c.value === null || c.margin === null)) return null;
  const lo = c.limit_min;
  const hi = c.limit_max;
  if (lo === null && hi === null) return null;
  const marginLimits = casesOf<LimitSide>(c.margin_limits);
  const side: LimitSide | undefined = lo !== null && hi === null ? "min" : hi !== null && lo === null ? "max" : (marginLimits?.nominal ?? undefined);
  const out: ConstraintVerdict = {
    id: c.key,
    label: c.label,
    unit: c.unit,
    value: c.value ?? NaN,
    margin: c.margin ?? NaN,
    verdict: c.state,
    decimals: decimalsFor(c.unit),
  };
  if (side) {
    out.sense = side;
    out.limit = (side === "min" ? lo : hi)!;
  }
  const vw = casesOf(c.value_worlds);
  if (vw) out.value_worlds = vw;
  const mw = casesOf(c.margin_worlds);
  if (mw) out.margin_worlds = mw;
  if (marginLimits) out.margin_limits = marginLimits;
  if (c.worst_world) out.worst_world = c.worst_world;
  if (c.worst_limit) out.worst_limit = c.worst_limit;
  if (c.case_basis) out.case_basis = c.case_basis;
  if (lo !== null && hi !== null) out.limit_range = [lo, hi];
  if (c.margin_worst !== null && c.margin_worst !== undefined) out.margin_worst = c.margin_worst;
  if (c.censored) out.censored = true;
  if (hd) {
    out.heading_dependent = true;
    out.heading_note = c.heading_note ?? "";
  }
  const facts = headingFacts(c);
  if (facts) out.heading_facts = facts;
  const cause = text(field(c, "cause"));
  if (cause) out.cause = cause;
  return out;
}

export function adaptConstraints(list: readonly ConstraintVerdictJson[]): { constraints: ConstraintVerdict[]; unevaluated: ConstraintVerdictJson[] } {
  const constraints: ConstraintVerdict[] = [];
  const unevaluated: ConstraintVerdictJson[] = [];
  for (const c of list) {
    const a = adaptConstraint(c);
    if (a) constraints.push(a);
    else unevaluated.push(c);
  }
  return { constraints, unevaluated };
}

export interface VerdictSummary {
  overall: Verdict | "unknown";
  limitingKey: string | null;
  limiting: ConstraintVerdict | null;
  counts: { pass: number; marginal: number; fail: number; unevaluated: number };
}

export function summarize(r: EvaluateResult): VerdictSummary {
  const { constraints, unevaluated } = adaptConstraints(r.verdict.constraints);
  const counts = { pass: 0, marginal: 0, fail: 0, unevaluated: unevaluated.length };
  for (const c of constraints) counts[c.verdict]++;
  const key = r.verdict.limiting;
  return {
    overall: r.verdict.state,
    limitingKey: key,
    limiting: key ? (constraints.find((c) => c.id === key) ?? null) : null,
    counts,
  };
}

const STATION_COLORS = ["c-station-0", "c-station-1", "c-station-2", "c-station-3"] as const;

function envelope(s: EvaluateSeries, name: string): { lo: Float64Array; hi: Float64Array } | null {
  const a = seriesColumn(s, `${name}_lo`);
  const b = seriesColumn(s, `${name}_hi`);
  if (!a || !b) return null;
  const lo = new Float64Array(a.length);
  const hi = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) {
    lo[i] = Math.min(a[i]!, b[i]!);
    hi[i] = Math.max(a[i]!, b[i]!);
  }
  return { lo, hi };
}

function lineRow(s: EvaluateSeries, name: string, id: string, label: string, unit: string, color: string, extra: Partial<LineRow> = {}): LineRow | null {
  const t = seriesColumn(s, "t_ms");
  if (!t) return null;
  const env = envelope(s, name);
  const col = seriesColumn(s, name);
  const served = col !== null && col.some((x) => Number.isFinite(x));
  if (!served && !env) return null;
  const value = served ? col : new Float64Array(t.length).fill(NaN);
  return { kind: "line", id, label, unit, color, utc_ms: t, value, lo: env?.lo, hi: env?.hi, ...extra, noNominal: extra.noNominal ?? false };
}

function noNominalSeries(provenance: unknown): ReadonlySet<string> {
  const n = (provenance as Record<string, unknown> | undefined | null)?.["no_nominal_series"];
  return new Set(Array.isArray(n) ? n.filter((x): x is string => typeof x === "string") : []);
}

function seriesNotes(provenance: unknown): string[] {
  const n = (provenance as Record<string, unknown> | undefined | null)?.["series_notes"];
  return Array.isArray(n) ? n.filter((x): x is string => typeof x === "string" && x !== "") : [];
}

const metricShown = (m: MetricJson) => (v: number) => withUnit(metricNum(v, m.unit), m.unit);

function socMarks(metrics: readonly MetricJson[]): LineMark[] | undefined {
  const m = metrics.find((x) => x.key === "min_state_of_charge");
  const marks = whenLines(m?.when, m ? metricShown(m) : undefined).flatMap((l) => (l.t_ms === null ? [] : [{ t_ms: l.t_ms, world: l.world, label: "minimum state of charge", text: l.text, value: l.value }]));
  return marks.length ? marks : undefined;
}

export function metricWhenLines(metrics: readonly MetricJson[]): Record<string, WhenLine[]> {
  const out: Record<string, WhenLine[]> = {};
  for (const m of metrics) {
    const lines = whenLines(m.when, metricShown(m));
    if (lines.length) out[m.key] = lines;
  }
  return out;
}

export function timelineRows(r: EvaluateResult, scenario: Scenario | null): TimelineRow[] {
  const span = seriesExtent(r.series) ?? [NaN, NaN];
  const rows: Array<TimelineRow | null> = [
    intervalRow("sunlit", "Array sunlit", "c-sun", r.intervals["sunlit"], span),
    intervalRow("dark", "Dark", "c-dark", r.intervals["dark"], span),
    intervalRow("eclipse", "Eclipse (Earth's shadow)", "c-uncertainty", r.intervals["eclipse"], span),
    intervalRow("contact", "Contact", "c-network", r.intervals["contact"], span),
  ];
  let k = 0;
  for (const key of Object.keys(r.intervals)) {
    if (!key.startsWith("contact:")) continue;
    const id = key.slice("contact:".length);
    const meta = scenario?.network.stations.find((x) => x.id === id || x.name === id);
    rows.push(intervalRow(key, meta?.name || id, STATION_COLORS[k % STATION_COLORS.length]!, r.intervals[key], span));
    k++;
  }
  const minSoc = scenario?.constraints.min_state_of_charge?.min;
  const noNominal = noNominalSeries(r.provenance);
  const notes = seriesNotes(r.provenance);
  rows.push(
    lineRow(r.series, "sunlight_fraction", "flux", "Sunlight fraction", "", "c-sun", { domain: [0, 1], decimals: 2 }),
    lineRow(r.series, "soc", "soc", "State of charge", "", "c-power", {
      domain: [0, 1],
      decimals: 2,
      noNominal: noNominal.has("soc"),
      threshold: minSoc !== null && minSoc !== undefined ? { value: minSoc, label: "min SoC" } : undefined,
      notes,
      marks: socMarks(r.metrics),
    }),
    lineRow(r.series, "contact_clearance_deg", "clearance", "Contact clearance", "°", "c-earth", { decimals: 1, threshold: { value: 0, label: "threshold" } }),
  );
  return rows.filter((x): x is TimelineRow => x !== null).map((x) => (x.kind === "line" && !x.noNominal ? { ...x, notes: undefined } : x));
}

export function seriesExtent(s: EvaluateSeries): [number, number] | null {
  const t = seriesColumn(s, "t_ms");
  return t && t.length > 1 ? [t[0]!, t[t.length - 1]!] : null;
}

export interface EstimateFlag {
  path: string;
  label: string;
  basis: Basis;
  note: string;
  source_url: string | null;
}

export function estimatesUsed(scenario: Scenario): EstimateFlag[] {
  const out: EstimateFlag[] = [];
  const add = (path: string, label: string, o: Origin | undefined) => {
    if (o && UNPUBLISHED_BASES.has(o.basis)) out.push({ path, label: o.label || label, basis: o.basis, note: o.note ?? "", source_url: o.source_url ?? null });
  };
  for (const [path, o] of Object.entries(scenario.profile.origins ?? {})) add(`profile.${path}`, path, o);
  for (const [key, v] of Object.entries(scenario.constraints)) {
    if (v && typeof v === "object" && "origin" in v && "label" in v) add(`constraints.${key}`, String(v.label), v.origin);
  }
  for (const st of scenario.network.stations) add(`network.${st.id}`, st.name || st.id, st.origin);
  add("eclipse", "Earth eclipse model", scenario.eclipse?.origin);
  return out;
}

interface TerrainState {
  terrain: boolean;
  label: string;
}

export function terrainState(provider: string): TerrainState {
  const terrain = provider === "terrain";
  return { terrain, label: terrain ? "Terrain" : provider === "smooth_sphere" ? "Smooth sphere (no terrain)" : `Horizon provider: ${provider}` };
}

interface HashRow {
  label: string;
  value: string;
}

function field(o: unknown, key: string): unknown {
  return o !== null && typeof o === "object" ? Reflect.get(o, key) : undefined;
}

function text(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

export function provenanceRows(p: Provenance, scenarioSha: string | null, stack?: TerrainStackJson | null): HashRow[] {
  const rows: HashRow[] = [];
  const sha = scenarioSha ?? text(p["scenario_sha256"]);
  if (sha) rows.push({ label: "Plan", value: sha });
  const code = p["code"];
  const version = text(field(code, "package_version"));
  if (version) rows.push({ label: "Code version", value: version });
  const source = text(field(code, "source_sha256"));
  if (source) rows.push({ label: "Code SHA-256", value: source });
  const listed = (label: string, o: unknown) => {
    if (o === null || typeof o !== "object") return;
    for (const [name, h] of Object.entries(o)) {
      const v = text(h);
      if (v) rows.push({ label: `${label} ${name}`, value: v });
    }
  };
  listed("Kernel", p["kernels"]);
  const terrain = field(p["horizon_provider"], "terrain");
  const stackHash = stack?.stack_hash ?? text(field(terrain, "stack_hash"));
  if (stackHash) rows.push({ label: "Terrain stack", value: stackHash });
  const siteDem = text(field(p["site_terrain"], "meta_hash"));
  if (siteDem) rows.push({ label: "Site DEM metadata", value: siteDem });
  return rows;
}

export function defaultStackIds(stores: readonly TerrainStoreJson[] | null): string[] | null {
  return stores ? stores.filter((s) => !s.error).map((s) => s.dem_id) : null;
}

export function stackLabel(t: Pick<TerrainInfo, "stackKind" | "stackIds" | "chosenBy">, defaultIds?: readonly string[] | null): string | null {
  const ids = t.stackIds ?? [];
  const n = ids.length;
  const by = t.chosenBy === "scenario" ? " · chosen by the plan" : t.chosenBy === "caller" ? " · chosen by the caller" : "";
  if (t.chosenBy === "none") return "no terrain stack";
  if (t.stackKind === "restricted") {
    const missing = defaultIds ? defaultIds.filter((d) => !ids.includes(d)) : [];
    const subset = !!defaultIds && ids.every((d) => defaultIds.includes(d));
    if (subset && missing.length > 0 && missing.length < n) return `Restricted stack: default without ${missing.join(", ")} (${n} of ${defaultIds.length} DEMs)${by}`;
    return `Restricted stack: ${ids.join(", ") || "no DEMs"}${by}`;
  }
  if (t.stackKind === "default") return `default stack (${n} DEMs)`;
  if (t.stackKind === "custom") return `custom stack (${n} DEMs)${by}`;
  return null;
}

export function groundLabel(t: Pick<TerrainInfo, "stackKind" | "demId" | "pixelM">): string | null {
  if (!t.demId) return null;
  const kind = t.stackKind === "default" ? "default stack, " : t.stackKind === "restricted" ? "restricted stack, " : t.stackKind === "custom" ? "custom stack, " : "";
  return `${kind}ground DEM ${t.demId}${t.pixelM !== null ? ` · ${withUnit(formatNum(t.pixelM, 1), "m/px")}` : ""}`;
}

export function storesReaching(stackIds: readonly string[] | null, stores: readonly TerrainStoreJson[] | null, latDeg: number, lonDeg: number): string[] | null {
  if (!stackIds || !stores) return null;
  return stackIds.filter((id) => {
    const s = stores.find((x) => x.dem_id === id);
    return !!s && storeCovers(s, latDeg, lonDeg) === true;
  });
}

interface StackRow {
  demId: string;
  detail: string;
}

export function stackRows(ids: readonly string[], stores: readonly TerrainStoreJson[] | null): StackRow[] {
  return ids.map((demId) => {
    const s = stores?.find((x) => x.dem_id === demId);
    const bits: string[] = [];
    if (s) {
      if (typeof s.pixel_size_m === "number") bits.push(withUnit(formatNum(s.pixel_size_m, 1), "m/px"));
      if (typeof s.sigma_z_m === "number") bits.push(`σ_z ${formatValue(s.sigma_z_m, "m", 1)}${s.error_basis_z ? ` (${s.error_basis_z})` : ""}`);
      if (typeof s.sigma_xy_m === "number") bits.push(`σ_xy ${formatValue(s.sigma_xy_m, "m", 1)}`);
    }
    return { demId, detail: bits.join(" · ") };
  });
}

interface TerrainInfo {
  provider: string;
  demId: string | null;
  pixelM: number | null;
  stackHash: string | null;
  demCount: number | null;
  stackIds: readonly string[] | null;
  stackKind: "default" | "restricted" | "custom" | null;
  chosenBy: "scenario" | "default" | "caller" | "none" | null;
  errorEnabled: boolean | null;
  errorMode: string | null;
  kSigma: number | null;
  vertical: { sigma_m: number; basis: string | null } | null;
  horizontal: { sigma_m: number; basis: string | null } | null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function terrainInfo(p: Provenance, provider: string, stack: TerrainStackJson | null): TerrainInfo {
  const chosenBy = stack?.chosen_by ?? null;
  const demId = text(field(p["site_terrain"], "dem_id"));
  const terrain = field(p["horizon_provider"], "terrain");
  const err = p["terrain_error"];
  const stores = field(err, "stores");
  let store: unknown = Array.isArray(stores) && demId ? stores.find((s: unknown) => field(s, "dem_id") === demId) : undefined;
  if (store === undefined) store = field(field(field(p["horizons"], "array"), "provenance"), "ground_error");
  const basis = (key: string) => text(field(store, `basis_${key}`)) ?? text(field(store, "basis"));
  const sz = num(field(store, "sigma_z_m"));
  const sxy = num(field(store, "sigma_xy_m"));
  const ids = stack ? stack.dem_ids : field(terrain, "dem_ids");
  const enabled = field(err, "enabled");
  return {
    provider,
    demId,
    pixelM: num(field(p["site_terrain"], "pixel_m")),
    stackHash: stack?.stack_hash ?? text(field(terrain, "stack_hash")),
    demCount: Array.isArray(ids) ? ids.length : null,
    stackIds: stack ? stack.dem_ids : null,
    stackKind: stack ? (stack.restricted ? "restricted" : stack.is_default && (chosenBy === null || chosenBy === "default") ? "default" : "custom") : null,
    chosenBy,
    errorEnabled: typeof enabled === "boolean" ? enabled : null,
    errorMode: text(field(err, "mode")),
    kSigma: num(field(err, "k_sigma")),
    vertical: sz === null ? null : { sigma_m: sz, basis: basis("z") },
    horizontal: sxy === null ? null : { sigma_m: sxy, basis: basis("xy") },
  };
}

export function seamWarnings(warnings: readonly string[] | undefined): string[] {
  return (warnings ?? []).filter((w) => /seam|changes source|near-field/i.test(w));
}

interface NearFieldSeam {
  groundStore: string | null;
  otherStore: string;
  distanceM: number | null;
  observers: Observer[];
}

export function nearFieldSeams(p: Provenance): NearFieldSeam[] {
  const out: NearFieldSeam[] = [];
  for (const obs of ["array", "antenna"] as const) {
    const s = field(field(field(p["horizons"], obs), "provenance"), "near_field_seam");
    const other = text(field(s, "other_store"));
    if (field(s, "warning") !== true || !other) continue;
    const known = out.find((x) => x.otherStore === other);
    if (known) known.observers.push(obs);
    else out.push({ groundStore: text(field(s, "ground_store")), otherStore: other, distanceM: num(field(s, "distance_m")), observers: [obs] });
  }
  return out;
}

export function stackWithout(store: string, stack: TerrainStackJson | null, defaultIds: readonly string[] | null): string[] | null {
  const base = stack && stack.restricted ? stack.dem_ids : defaultIds;
  return base ? [...base.filter((d) => d !== store)].sort() : null;
}

export interface Direction {
  az_deg: number;
  el_deg: number;
}

export function directionsAt(s: EvaluateSeries, timeMs: number): { sun: Direction | null; earth: Direction | null } {
  const pick = (body: "sun" | "earth"): Direction | null => {
    const tr = adaptTrack(s, body);
    const p = tr ? interpTrack(tr, timeMs) : null;
    return p && Number.isFinite(p.az_deg) && Number.isFinite(p.el_deg) ? { az_deg: p.az_deg, el_deg: p.el_deg } : null;
  };
  return { sun: pick("sun"), earth: pick("earth") };
}

export function blockerMark(scenario: Scenario, label: string, az_deg: number, dist_m: number | null, blocker: BlockerPoint | null): BlockerMark | null {
  const lat = blocker?.["lat_deg"];
  const lon = blocker?.["lon_deg"];
  if (lat === undefined || lon === undefined || dist_m === null || !Number.isFinite(dist_m)) return null;
  return {
    from: { lat_deg: scenario.site.lat_deg, lon_deg: scenario.site.lon_deg },
    to: { lat_deg: lat, lon_deg: lon },
    azimuth_deg: az_deg,
    distance_m: dist_m,
    label,
  };
}

export const KIND_LABEL: Record<CountdownKind, string> = { sunset: "Sunlight ends", sunrise: "Sunlight begins", earthset: "Contact ends", earthrise: "Contact begins" };

export function attributionLabel(kind: CountdownKind, e: CrossingEvent): string {
  return `${eventName(kind, e)} ${formatUtc(e.best_ms)}`;
}

export function eventRequest(kind: CountdownKind, e: CrossingEvent, timeMs: number): { kind: CountdownKind; from_utc: string } {
  return { kind, from_utc: toIsoUtc(Math.max(timeMs, e.best_ms - 60_000)) };
}

export function fileSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "scenario";
}

export type Arc = [number, number];

export interface HeadingConstraintView {
  key: string;
  unit: string;
  limit_min: number | null;
  passing: Arc[];
  allPass: boolean;
  nonePass: boolean;
  samples: Array<{ yaw: number; value: number }>;
}

export interface HeadingView {
  known: boolean;
  nominalYaw: number | null;
  nominalBasis: string;
  uncertaintyDeg: number;
  depends: boolean;
  best: number | null;
  worst: number | null;
  worstArcs: Arc[];
  yaws: number[];
  socMinTotal: [number, number] | null;
  socMinHeadingOnly: [number, number] | null;
  socMinHorizonOnly: [number, number] | null;
  cause: string;
  constraints: HeadingConstraintView[];
}

function arcs(a: ReadonlyArray<ReadonlyArray<number | null>> | undefined): Arc[] {
  const out: Arc[] = [];
  for (const p of a ?? []) {
    const from = p[0];
    const to = p[p.length - 1];
    if (typeof from === "number" && typeof to === "number" && Number.isFinite(from) && Number.isFinite(to)) out.push([from, to]);
  }
  return out;
}

function pair(a: ReadonlyArray<number | null> | null | undefined): [number, number] | null {
  const x = a?.[0];
  const y = a?.[1];
  return typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

export function headingView(h: HeadingJson | null | undefined): HeadingView | null {
  if (!h) return null;
  const yaws = h.yaws_deg.filter((y) => Number.isFinite(y));
  return {
    known: h.known,
    nominalYaw: num(h.nominal_yaw_deg),
    nominalBasis: h.nominal_basis,
    uncertaintyDeg: h.uncertainty_deg,
    depends: h.depends,
    best: num(h.best_yaw_deg),
    worst: num(h.worst_yaw_deg),
    worstArcs: arcs(h.worst_arc_deg),
    yaws,
    socMinTotal: pair(h.soc_min_total),
    socMinHeadingOnly: pair(h.soc_min_heading_only),
    socMinHorizonOnly: pair(h.soc_min_horizon_only),
    cause: h.cause,
    constraints: h.constraints.map((c) => {
      const samples: Array<{ yaw: number; value: number }> = [];
      c.values_by_heading.forEach((v, i) => {
        const yaw = h.yaws_deg[i];
        if (typeof v === "number" && Number.isFinite(v) && yaw !== undefined) samples.push({ yaw, value: v });
      });
      return { key: c.key, unit: c.unit, limit_min: c.limit_min, passing: arcs(c.passing_deg), allPass: c.all_pass, nonePass: c.none_pass, samples };
    }),
  };
}

export function arcText(a: readonly Arc[]): string {
  return a.map(([from, to]) => (from === to ? `${Math.round(from)}°` : `${Math.round(from)}° to ${Math.round(to)}°`)).join(", ");
}

const CAUSE_TEXT: Record<string, string> = {
  heading: "the unknown or uncertain heading",
  terrain: "the terrain uncertainty",
  both: "both the heading and the terrain uncertainty",
  none: "neither (the range is a single value)",
};

function metricNum(v: number | null, unit: string): string {
  return v === null ? "—" : formatNum(v, Math.max(decimalsFor(unit), Math.abs(v) >= 1000 ? 0 : 2));
}

export function metricValueText(m: MetricJson): string {
  if (m.value === null) return m.censored ? "none in the analysed span" : m.note ? "no value · see note" : "—";
  const v = metricNum(m.value, m.unit);
  if (!m.censored) return v;
  return glue(m.unit === "h" ? `at least ${v}` : `${v} (bound only)`);
}

export function metricRangeText(m: MetricJson): string {
  if (m.low === null && m.high === null) return "—";
  const lo = metricNum(m.low, m.unit);
  const hi = metricNum(m.high, m.unit);
  if (!m.one_sided || m.low === null || m.high === null) return glue(`${lo} … ${hi}`);
  return glue(m.unit === "h" ? `${lo} … at least ${hi}` : `${lo} … ${hi} (one-sided)`);
}

export function metricNoteText(m: MetricJson): string {
  const sided = m.one_sided ? "A world with no such event in the analysed span is left out of the range, so the range is one-sided: the true bound lies beyond the data. " : "";
  return glueQuantities(`${sided}${m.note}`.trim());
}

export function formatDelta(minutes: number): string {
  return Math.abs(minutes) * 60 < 90 ? formatSignedValue(Math.round(minutes * 60), "s", 0) : formatSignedValue(minutes, "min", 1);
}

export function evaluatedScenario(r: Pick<EvaluateResult, "scenario">): Scenario | null {
  const s = r.scenario;
  if (!s || typeof s !== "object") return null;
  const net = field(s, "network");
  return Array.isArray(field(net, "stations")) && field(s, "profile") && field(s, "constraints") && field(s, "site") ? (s as unknown as Scenario) : null;
}

export function boundLines(b: ConstraintBoundJson): string[] {
  const out: string[] = [];
  const cause = CAUSE_TEXT[b.cause];
  if (cause) out.push(`Range set by ${cause}.`);
  if (b.interval_kind) out.push(`The ${b.interval_kind.replace(/_/g, " ")} interval differs by ${formatValue(b.spread_h, "h", 2)} between the pessimistic and optimistic cases${b.same_interval ? " (the same interval, different edges)" : ""}.`);
  if (!b.decomposable && b.decomposition_note) out.push(b.decomposition_note);
  for (const e of b.events) {
    const what = `${e.kind.replace(/_/g, " ")} ${e.role}`;
    if (!b.decomposable || e.contribution_h === null) {
      out.push(what);
      continue;
    }
    const share = e.share === null ? "" : ` (${formatValue(e.share * 100, "%", 0)})`;
    out.push(`${what}: ${formatSignedValue(e.contribution_h, "h", 2)}${share}`);
  }
  if (b.decomposable && b.decomposition_note) out.push(b.decomposition_note);
  const soc = worldSocLine(b);
  if (soc) out.push(soc);
  if (b.world_soc_note) out.push(b.world_soc_note);
  if (b.note) out.push(b.note);
  return out;
}

function worldSocLine(b: ConstraintBoundJson): string | null {
  const w = b.world_soc;
  if (!w) return null;
  const parts: string[] = [];
  for (const c of ["pessimistic", "nominal", "optimistic"]) {
    if (!(c in w)) continue;
    const v = w[c];
    parts.push(`${c} ${typeof v === "number" && Number.isFinite(v) ? formatNum(v, 2) : "no value"}`);
  }
  return parts.length ? `State of charge by case: ${parts.join(", ")}.` : null;
}

export function arcPath(a: Arc, c: number, r: number): string {
  const [from, to] = a;
  const sweep = Math.max(1, wrap360(to - from));
  const at = (deg: number) => `${(c + r * Math.sin((deg * Math.PI) / 180)).toFixed(2)} ${(c - r * Math.cos((deg * Math.PI) / 180)).toFixed(2)}`;
  return `M ${at(from)} A ${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${at(from + sweep)}`;
}

type LimitKind = LimitNoteJson["kind"];

export const LIMIT_KIND_LABEL: Record<LimitKind, string> = {
  known_miss: "Known misses",
  assumed: "Assumptions",
  not_modelled: "Not modelled",
  model_limit: "Model limits for this plan",
};

export interface LimitGroup {
  kind: LimitKind | undefined;
  notes: LimitNoteJson[];
}

export function limitGroups(limits: readonly LimitNoteJson[]): LimitGroup[] {
  const groups: LimitGroup[] = [];
  for (const n of [...limits.filter((l) => l.kind === "known_miss"), ...limits.filter((l) => l.kind !== "known_miss")]) {
    const g = groups.find((x) => x.kind === n.kind);
    if (g) g.notes.push(n);
    else groups.push({ kind: n.kind, notes: [n] });
  }
  return groups;
}

const canonical = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(",")}]`
    : v !== null && typeof v === "object"
      ? `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
          .join(",")}}`
      : JSON.stringify(v);

export function limitKey(note: Pick<LimitNoteJson, "id" | "parameters">): string {
  return `${note.id} ${canonical(note.parameters)}`;
}
