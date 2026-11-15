import { clamp, wrap360 } from "../lib/scale";
import type {
  ConstraintVerdict,
  CrossingEvent,
  HorizonProfile,
  Interval,
  IntervalRow,
  LineRow,
  StationMarker,
  TargetTrack,
} from "../contract/types";
import { discFractionAboveHorizon } from "../lib/disc";
import { classify, marginOf } from "../lib/verdict";
import { MS_DAY, MS_HOUR, MS_LUNATION } from "../lib/time";

const rad = (d: number) => (d * Math.PI) / 180;

export const FIXTURE_T0 = Date.UTC(2027, 0, 6, 0, 0, 0);
export const FIXTURE_SPAN = 3 * MS_LUNATION;

export function makeHorizon(n = 720): HorizonProfile {
  const az = new Float64Array(n);
  const elev = new Float64Array(n);
  const lo = new Float64Array(n);
  const hi = new Float64Array(n);
  const dist = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i * 360) / n;
    az[i] = a;
    const ridge = 0.55 + 0.85 * Math.sin(rad(3 * a)) + 0.3 * Math.sin(rad(7 * a + 40));
    const d130 = ((a - 130 + 540) % 360) - 180;
    const peak = 2.4 * Math.exp(-(d130 * d130) / (2 * 6 * 6));
    elev[i] = ridge + peak;
    const spread = 0.1 + 0.07 * (0.5 + 0.5 * Math.sin(rad(5 * a)));
    lo[i] = elev[i]! - spread * 0.6;
    hi[i] = elev[i]! + spread;
    dist[i] = 900 + 5200 * (0.5 + 0.5 * Math.sin(rad(a + 30))) + (peak > 0.5 ? 3500 : 0);
  }
  return { az_deg: az, elev_deg: elev, elev_lo_deg: lo, elev_hi_deg: hi, blocker_dist_m: dist };
}

function sunAt(t: number): { az: number; el: number } {
  const days = (t - FIXTURE_T0) / MS_DAY;
  return {
    az: wrap360((360 * days) / 29.530589 + 20),
    el: 1.15 + 0.6 * Math.sin((2 * Math.PI * days) / (3 * 29.530589)) + 0.12 * Math.sin((2 * Math.PI * days) / 14.2),
  };
}

function earthAt(t: number): { az: number; el: number } {
  const days = (t - FIXTURE_T0) / MS_DAY;
  return {
    az: 205 + 14 * Math.sin((2 * Math.PI * days) / 27.55 + 0.6),
    el: 2.6 + 4.2 * Math.sin((2 * Math.PI * days) / 27.32 + 1.1),
  };
}

export function makeTracks(t0 = FIXTURE_T0, span = FIXTURE_SPAN, stepMs = MS_HOUR): { sun: TargetTrack; earth: TargetTrack } {
  const n = Math.floor(span / stepMs) + 1;
  const utc = new Float64Array(n);
  const sa = new Float64Array(n);
  const se = new Float64Array(n);
  const ea = new Float64Array(n);
  const ee = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = t0 + i * stepMs;
    utc[i] = t;
    const s = sunAt(t);
    const e = earthAt(t);
    sa[i] = s.az;
    se[i] = s.el;
    ea[i] = e.az;
    ee[i] = e.el;
  }
  const sunR = new Float64Array(n).fill(0.2666);
  const earthR = new Float64Array(n).fill(0.95);
  return {
    sun: { utc_ms: utc, az_deg: sa, el_deg: se, ang_radius_deg: sunR },
    earth: { utc_ms: utc, az_deg: ea, el_deg: ee, ang_radius_deg: earthR },
  };
}

export function makeStations(timeMs: number): StationMarker[] {
  const e = earthAt(timeMs);
  const defs = [
    { id: "dss14", label: "DSS-14", dAz: -0.55, dEl: 0.3 },
    { id: "dss43", label: "DSS-43", dAz: 0.5, dEl: -0.35 },
    { id: "dss63", label: "DSS-63", dAz: 0.1, dEl: 0.62 },
  ];
  return defs.map((d, i) => ({
    id: d.id,
    label: d.label,
    az_deg: e.az + d.dAz,
    el_deg: e.el + d.dEl,
    in_contact: i !== 1 ? e.el + d.dEl > 0.4 : false,
  }));
}

interface SeriesSet {
  utc: Float64Array;
  best: Float64Array;
  pess: Float64Array;
  opt: Float64Array;
}

function fractions(track: TargetTrack, h: HorizonProfile): SeriesSet {
  const n = track.utc_ms.length;
  const mk = () => new Float64Array(n);
  const out = { utc: Float64Array.from(track.utc_ms), best: mk(), pess: mk(), opt: mk() };
  for (let i = 0; i < n; i++) {
    const a = track.az_deg[i]!;
    const e = track.el_deg[i]!;
    const r = track.ang_radius_deg[i]!;
    out.best[i] = discFractionAboveHorizon(h.elev_deg, a, e, r, 24, 16);
    out.pess[i] = discFractionAboveHorizon(h.elev_hi_deg, a, e, r, 24, 16);
    out.opt[i] = discFractionAboveHorizon(h.elev_lo_deg, a, e, r, 24, 16);
  }
  return out;
}

function toIntervals(utc: ArrayLike<number>, on: (i: number) => boolean): Interval[] {
  const out: Interval[] = [];
  let start = -1;
  for (let i = 0; i < utc.length; i++) {
    if (on(i) && start < 0) start = utc[i]!;
    if (!on(i) && start >= 0) {
      out.push({ start_ms: start, end_ms: utc[i]! });
      start = -1;
    }
  }
  if (start >= 0) out.push({ start_ms: start, end_ms: utc[utc.length - 1]! });
  return out;
}

function complement(list: Interval[], t0: number, t1: number): Interval[] {
  const out: Interval[] = [];
  let cur = t0;
  for (const iv of list) {
    if (iv.start_ms > cur) out.push({ start_ms: cur, end_ms: iv.start_ms });
    cur = iv.end_ms;
  }
  if (cur < t1) out.push({ start_ms: cur, end_ms: t1 });
  return out;
}

interface Crossing {
  t: number;
  rising: boolean;
}

function crossings(utc: ArrayLike<number>, v: ArrayLike<number>, level: number): Crossing[] {
  const out: Crossing[] = [];
  for (let i = 1; i < utc.length; i++) {
    const a = v[i - 1]! - level;
    const b = v[i]! - level;
    if ((a < 0) !== (b < 0)) out.push({ t: utc[i - 1]! + ((utc[i]! - utc[i - 1]!) * (0 - a)) / (b - a), rising: b >= 0 });
  }
  return out;
}

function eventsFor(kindSet: "sun" | "earth", S: SeriesSet): CrossingEvent[] {
  const best = crossings(S.utc, S.best, 0.5);
  const pess = crossings(S.utc, S.pess, 0.5);
  const opt = crossings(S.utc, S.opt, 0.5);
  const nearest = (list: Crossing[], c: Crossing) =>
    list.filter((x) => x.rising === c.rising).reduce<number | null>((m, x) => (m === null || Math.abs(x.t - c.t) < Math.abs(m - c.t) ? x.t : m), null);
  return best.map((c) => {
    const p = nearest(pess, c) ?? c.t;
    const o = nearest(opt, c) ?? c.t;
    const kind = kindSet === "sun" ? (c.rising ? "sunrise" : "sunset") : c.rising ? "earthrise" : "earthset";
    return { kind, best_ms: c.t, earliest_ms: Math.min(p, o, c.t), latest_ms: Math.max(p, o, c.t) } as CrossingEvent;
  });
}

interface TimelineFixture {
  rows: Array<IntervalRow | LineRow>;
  events: CrossingEvent[];
  extent: [number, number];
}

export function makeTimeline(): TimelineFixture {
  const h = makeHorizon();
  const { sun, earth } = makeTracks();
  const sunF = fractions(sun, h);
  const earthF = fractions(earth, h);
  const t0 = FIXTURE_T0;
  const t1 = FIXTURE_T0 + FIXTURE_SPAN;
  const utc = sunF.utc;

  const sunlitBest = toIntervals(utc, (i) => sunF.best[i]! >= 0.5);
  const sunlitPess = toIntervals(utc, (i) => sunF.pess[i]! >= 0.5);
  const sunlitOpt = toIntervals(utc, (i) => sunF.opt[i]! >= 0.5);
  const darkBest = complement(sunlitBest, t0, t1);
  const darkOpt = complement(sunlitPess, t0, t1);
  const darkPess = complement(sunlitOpt, t0, t1);

  const stationOffsets = [0.0, 0.18, -0.12];
  const stationRows: IntervalRow[] = ["DSS-14", "DSS-43", "DSS-63"].map((name, k) => {
    const mask = (series: Float64Array) => (i: number) => series[i]! >= 0.5 + stationOffsets[k]!;
    return {
      kind: "intervals",
      id: `contact-${k}`,
      label: `Contact ${name}`,
      color: `c-station-${k}`,
      best: toIntervals(utc, mask(earthF.best)),
      pessimistic: toIntervals(utc, mask(earthF.pess)),
      optimistic: toIntervals(utc, mask(earthF.opt)),
    };
  });
  const net = (pick: (r: IntervalRow) => Interval[]): Interval[] => {
    const flags = (i: number) => stationRows.some((r) => pick(r).some((iv) => utc[i]! >= iv.start_ms && utc[i]! < iv.end_ms));
    return toIntervals(utc, flags);
  };

  const soc = new Float64Array(utc.length);
  let s = 0.8;
  for (let i = 0; i < utc.length; i++) {
    s = clamp(s + (sunF.best[i]! * 0.012 - 0.006), 0, 1);
    soc[i] = s * 100;
  }
  const lo = (a: Float64Array) => Float64Array.from(a, (v) => v);

  const rows: Array<IntervalRow | LineRow> = [
    { kind: "intervals", id: "sunlit", label: "Sunlit", color: "c-sun", best: sunlitBest, pessimistic: sunlitPess, optimistic: sunlitOpt },
    { kind: "intervals", id: "dark", label: "Dark", color: "c-dark", best: darkBest, pessimistic: darkPess, optimistic: darkOpt },
    ...stationRows,
    {
      kind: "intervals",
      id: "network",
      label: "Contact",
      color: "c-network",
      best: net((r) => r.best),
      pessimistic: net((r) => r.pessimistic ?? []),
      optimistic: net((r) => r.optimistic ?? []),
    },
    { kind: "line", id: "flux", label: "Solar flux fraction", unit: "fraction", color: "c-sun", utc_ms: utc, value: sunF.best, lo: sunF.pess, hi: sunF.opt, domain: [0, 1], decimals: 2 },
    { kind: "line", id: "sun-el", label: "Sun elevation", unit: "deg", color: "c-sun", utc_ms: utc, value: sun.el_deg as Float64Array, threshold: { value: 0, label: "0°" }, decimals: 2 },
    { kind: "line", id: "earth-el", label: "Earth elevation", unit: "deg", color: "c-earth", utc_ms: utc, value: earth.el_deg as Float64Array, threshold: { value: 0, label: "0°" }, decimals: 1 },
    {
      kind: "line",
      id: "soc",
      label: "Battery state of charge",
      unit: "%",
      color: "c-power",
      utc_ms: utc,
      value: soc,
      lo: lo(soc.map((v) => v - 3)),
      hi: lo(soc.map((v) => Math.min(100, v + 3))),
      domain: [0, 100],
      threshold: { value: 20, label: "≥ 20 %" },
      decimals: 0,
    },
  ];
  return { rows, events: [...eventsFor("sun", sunF), ...eventsFor("earth", earthF)], extent: [t0, t1] };
}

export function makeStress(): { rows: Array<IntervalRow | LineRow>; extent: [number, number]; count: number } {
  const n = 200_000;
  const t0 = FIXTURE_T0;
  const step = 5 * 60_000;
  const utc = new Float64Array(n);
  const v = new Float64Array(n);
  const lo = new Float64Array(n);
  const hi = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    utc[i] = t0 + i * step;
    const d = (i * step) / MS_DAY;
    const base = 50 + 28 * Math.sin((2 * Math.PI * d) / 29.53) + 9 * Math.sin((2 * Math.PI * d) / 1.0) + 4 * Math.sin((2 * Math.PI * d) / 0.07);
    v[i] = base + (i === 123_457 ? 22 : 0);
    lo[i] = v[i]! - 5;
    hi[i] = v[i]! + 5;
  }
  const t1 = utc[n - 1]!;
  const lit: Interval[] = [];
  for (let t = t0; t < t1; t += MS_LUNATION) lit.push({ start_ms: t + 3 * MS_DAY, end_ms: t + 17 * MS_DAY });
  return {
    count: n,
    extent: [t0, t1],
    rows: [
      { kind: "intervals", id: "s-lit", label: "Sunlit (synthetic)", color: "c-sun", best: lit },
      { kind: "line", id: "s-line", label: "Synthetic signal", unit: "arb.", color: "c-earth", utc_ms: utc, value: v, lo, hi, decimals: 1 },
    ],
  };
}

export function makeConstraints(): ConstraintVerdict[] {
  const mk = (
    id: string,
    label: string,
    unit: string,
    sense: "min" | "max",
    limit: number,
    best: number,
    pess: number,
    opt: number,
    decimals = 1,
  ): ConstraintVerdict => ({
    id,
    label,
    unit,
    sense,
    limit,
    decimals,
    value: best,
    value_worlds: { nominal: best, pessimistic: pess, optimistic: opt },
    case_basis: "horizon",
    margin: marginOf(best, limit, sense),
    verdict: classify(marginOf(best, limit, sense) >= 0, marginOf(pess, limit, sense) >= 0),
  });
  return [
    mk("sun-el", "Sun elevation at landing", "deg", "min", 1.0, 1.9, 1.6, 2.1, 2),
    mk("dte", "Direct-to-Earth contact at landing", "h", "min", 6, 9.4, 5.1, 11.2),
    mk("lit", "Continuous sunlit time after landing", "h", "min", 96, 131.5, 118, 149),
    mk("dark", "Longest dark span", "h", "max", 72, 64.2, 78.9, 60.3),
    mk("soc", "Minimum state of charge", "%", "min", 20, 11.8, 6.0, 17.0, 0),
    mk("gap", "Longest contact gap", "h", "max", 48, 41.0, 46.5, 38.0),
  ];
}

