import type { CompareResult, CompareScenario, ScenarioItem, ServiceConstraintVerdict, SlipResult, SlipRow, VerdictState } from "../../api/planning";
import { compareBody } from "../../api/planning";
import type { Candidate } from "../../scenario/alternatives";
import type { Scenario, ScenarioSummary } from "../../scenario/types";
import { delayLabel } from "./delays";
import { findCell, limitingLabel } from "./gridModel";
import { BASELINE_SITE, MAX_DETAIL, pinKey, type Pin } from "./options";
import { uniqueNames } from "./sources";

const COMPARE_MAX_ITEMS = 12;

export interface ShortlistContext {
  doc: Scenario;
  alternatives: readonly Candidate[];
  stored: readonly ScenarioSummary[];
  slip: SlipResult | null;
  keys: ReadonlyArray<string | null>;
}

export function pinName(pin: Pin, ctx: Pick<ShortlistContext, "doc" | "alternatives" | "stored">): string {
  if (pin.kind === "saved") return ctx.stored.find((s) => s.id === pin.scenario_id)?.name ?? pin.scenario_id;
  const site = pin.site === BASELINE_SITE ? (ctx.doc.site.name || "Baseline") : (ctx.alternatives.find((a) => a.id === pin.site)?.name ?? pin.site);
  return `${site} · ${delayLabel(pin.slip_h)}`;
}

export interface ShortRow {
  pin: Pin;
  key: string;
  number: number;
  name: string;
  source: { kind: "slip"; row: SlipRow } | { kind: "compare"; scenario: CompareScenario } | { kind: "note"; text: string };
  state: VerdictState | "no_opportunity" | null;
  limiting: string | null;
  constraints: ServiceConstraintVerdict[];
}

interface CompareRunState {
  entries: readonly CompareEntry[];
  result: CompareResult | null;
  problem: string | null;
}

function fromSlip(row: SlipRow): Pick<ShortRow, "state" | "limiting" | "constraints"> {
  return { state: row.state, limiting: limitingLabel(row), constraints: row.verdict?.constraints ?? [] };
}

export function shortlistRows(pins: readonly Pin[], ctx: ShortlistContext, compare: CompareRunState): ShortRow[] {
  return pins.map((pin, i) => {
    const base = { pin, key: pinKey(pin), number: i + 1, name: pinName(pin, ctx) };
    const empty = { state: null, limiting: null, constraints: [] };
    if (pin.kind === "cell") {
      if (pin.site !== BASELINE_SITE && !ctx.alternatives.some((a) => a.id === pin.site))
        return { ...base, ...empty, source: { kind: "note", text: "Site removed" } };
      const cell = findCell(ctx.slip, ctx.keys, pin.site, pin.slip_h);
      if (!cell) return { ...base, ...empty, source: { kind: "note", text: "Not computed" } };
      return { ...base, ...fromSlip(cell.row), source: { kind: "slip", row: cell.row } };
    }
    const at = compare.entries.findIndex((e) => e.pin !== null && pinKey(e.pin) === base.key);
    const scenario = at < 0 ? undefined : compare.result?.scenarios[at];
    if (!scenario) return { ...base, ...empty, source: { kind: "note", text: compare.problem ?? "Loading…" } };
    const limiting = scenario.verdict.constraints.find((c) => c.key === scenario.limiting)?.label ?? scenario.limiting;
    return { ...base, source: { kind: "compare", scenario }, state: scenario.state, limiting, constraints: scenario.verdict.constraints };
  });
}

export function nominalOf(row: ShortRow, key: string): number | null {
  const c = row.constraints.find((x) => x.key === key);
  return c && !c.heading_dependent && c.state !== "unknown" && typeof c.margin === "number" && Number.isFinite(c.margin) ? c.margin : null;
}

interface CompareEntry {
  pin: Pin | null;
  name: string;
  item: ScenarioItem;
}

function pinItem(pin: Pin, ctx: ShortlistContext): ScenarioItem | null {
  if (pin.kind === "saved") return { scenario_id: pin.scenario_id };
  const landing = findCell(ctx.slip, ctx.keys, pin.site, pin.slip_h)?.row.landing_utc;
  if (!landing) return null;
  if (pin.site === BASELINE_SITE) return { scenario: ctx.doc, overrides: { landing_utc: landing } };
  const a = ctx.alternatives.find((x) => x.id === pin.site);
  if (!a) return null;
  return {
    scenario: ctx.doc,
    overrides: { landing_utc: landing, site: { lat_deg: a.lat_deg, lon_deg: a.lon_deg, name: a.name, catalog_id: a.catalog_id } },
  };
}

export const canTick = (pin: Pin, ctx: ShortlistContext): boolean => pin.kind === "saved" || pinItem(pin, ctx) !== null;

export function tickedPins(pins: readonly Pin[], ticked: ReadonlySet<string>, ctx: ShortlistContext): Pin[] {
  return pins.filter((p) => ticked.has(pinKey(p)) && canTick(p, ctx)).slice(0, MAX_DETAIL);
}

export function compareEntries(pins: readonly Pin[], ticked: ReadonlySet<string>, ctx: ShortlistContext): CompareEntry[] {
  const wanted = pins.filter((p) => p.kind === "saved" || (ticked.has(pinKey(p)) && canTick(p, ctx)));
  const names = uniqueNames([...wanted.map((p) => pinName(p, ctx)), ctx.doc.name]);
  const entries: CompareEntry[] = [];
  wanted.forEach((pin, i) => {
    const item = pinItem(pin, ctx);
    if (item) entries.push({ pin, name: names[i]!, item });
  });
  if (entries.length === 1) entries.push({ pin: null, name: names[wanted.length]!, item: { scenario: ctx.doc } });
  return entries.slice(0, COMPARE_MAX_ITEMS);
}

export function compareRequest(entries: readonly CompareEntry[]) {
  return entries.length >= 2 ? compareBody(entries.map((e) => e.item), entries.map((e) => e.name), "auto") : null;
}

export function selectScenarios(result: CompareResult, at: readonly number[]): CompareResult {
  const pick = <T,>(xs: readonly T[]) => at.map((i) => xs[i] as T);
  return {
    ...result,
    names: pick(result.names),
    scenarios: pick(result.scenarios),
    metrics: result.metrics.map((m) => ({ ...m, values: pick(m.values), low: pick(m.low), high: pick(m.high), when: pick(m.when) })),
  };
}
