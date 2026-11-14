export const MS_MIN = 60_000;
export const MS_HOUR = 3_600_000;
export const MS_DAY = 86_400_000;
export const MS_LUNATION = 29.530588861 * MS_DAY;

const pad = (n: number, w = 2) => String(Math.trunc(Math.abs(n))).padStart(w, "0");

export function formatUtc(ms: number, opts: { seconds?: boolean; date?: boolean } = {}): string {
  if (!Number.isFinite(ms)) return "—";
  const { seconds = true, date = true } = opts;
  const d = new Date(ms);
  const ymd = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const hm = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  const time = seconds ? `${hm}:${pad(d.getUTCSeconds())}` : hm;
  return date ? `${ymd} ${time}Z` : `${time}Z`;
}

export const roundToSecond = (ms: number): number => Math.round(ms / 1000) * 1000;

export function utcText(t: string | number | null | undefined, opts: { seconds?: boolean } = {}): string {
  const ms = typeof t === "number" ? t : t ? parseUtc(t) : null;
  if (ms === null || !Number.isFinite(ms)) return "—";
  const r = roundToSecond(ms);
  return formatUtc(r, { seconds: !!opts.seconds || r % MS_MIN !== 0 });
}

export function toIsoUtc(ms: number): string {
  return new Date(ms).toISOString().replace(".000Z", "Z");
}

const UTC_RE =
  /^\s*(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?\s*Z?\s*$/i;

export function parseUtc(text: string | null): number | null {
  if (text === null) return null;
  const m = UTC_RE.exec(text);
  if (!m) return null;
  const [y, mo, d, h = "0", mi = "0", s = "0", frac = "0"] = m.slice(1) as string[];
  const [Y, M, D, H, MI, S] = [y, mo, d, h, mi, s].map(Number) as [number, number, number, number, number, number];
  if (M < 1 || M > 12 || D < 1 || D > 31 || H > 23 || MI > 59 || S > 59) return null;
  const date = new Date(0);
  date.setUTCFullYear(Y, M - 1, D);
  date.setUTCHours(H, MI, S, Number(frac.padEnd(3, "0")));
  const ms = date.getTime();
  const check = new Date(ms);
  if (check.getUTCMonth() !== M - 1 || check.getUTCDate() !== D) return null;
  return ms;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  const sign = ms < 0 ? "−" : "";
  const secs = Math.round(Math.abs(ms) / 1000);
  if (secs < 60) return `${sign}${secs} s`;
  let t = Math.round(Math.abs(ms) / MS_MIN);
  const d = Math.floor(t / 1440);
  t -= d * 1440;
  const h = Math.floor(t / 60);
  const m = t - h * 60;
  if (d > 0) return `${sign}${d} d ${pad(h)} h ${pad(m)} m`;
  if (h > 0) return `${sign}${h} h ${pad(m)} m`;
  return `${sign}${m} m`;
}

export function formatMet(ms: number, t0: number): string {
  const dt = ms - t0;
  const sign = dt < 0 ? "−" : "+";
  let s = Math.floor(Math.abs(dt) / 1000);
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  return `T${sign}${pad(d, 2)}d ${pad(h)}:${pad(m)}:${pad(s)}`;
}

export type StepUnit = "hour" | "day" | "lunation";

export const STEP_MS: Record<StepUnit, number> = {
  hour: MS_HOUR,
  day: MS_DAY,
  lunation: MS_LUNATION,
};

export interface TimeTick {
  ms: number;
  label: string;
  major: boolean;
}

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const FIXED_STEPS_MS = [
  MS_MIN,
  5 * MS_MIN,
  15 * MS_MIN,
  30 * MS_MIN,
  MS_HOUR,
  3 * MS_HOUR,
  6 * MS_HOUR,
  12 * MS_HOUR,
  MS_DAY,
  2 * MS_DAY,
  7 * MS_DAY,
  14 * MS_DAY,
];

export function timeTicks(t0: number, t1: number, target = 8): TimeTick[] {
  const span = t1 - t0;
  if (!(span > 0)) return [];
  const want = span / Math.max(1, target);
  const out: TimeTick[] = [];

  const fixed = FIXED_STEPS_MS.find((s) => s >= want);
  if (fixed !== undefined) {
    const start = Math.ceil(t0 / fixed) * fixed;
    for (let t = start; t <= t1; t += fixed) {
      const d = new Date(t);
      const midnight = t % MS_DAY === 0;
      let label: string;
      if (fixed >= MS_DAY) label = `${pad(d.getUTCDate())} ${MONTH[d.getUTCMonth()]}`;
      else if (midnight) label = `${pad(d.getUTCDate())} ${MONTH[d.getUTCMonth()]}`;
      else label = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
      out.push({ ms: t, label, major: fixed >= MS_DAY || midnight });
    }
    return out;
  }

  const monthsWanted = want / (30.4375 * MS_DAY);
  const stepMonths = [1, 2, 3, 6, 12, 24, 60, 120].find((m) => m >= monthsWanted) ?? 240;
  const d0 = new Date(t0);
  let y = d0.getUTCFullYear();
  let mo = d0.getUTCMonth();
  mo = Math.ceil(mo / stepMonths) * stepMonths;
  if (stepMonths >= 12) {
    const yStep = stepMonths / 12;
    y = Math.ceil(y / yStep) * yStep;
    mo = 0;
  }
  for (let guard = 0; guard < 1000; guard++) {
    const t = Date.UTC(y, mo, 1);
    if (t > t1) break;
    if (t >= t0) {
      const jan = new Date(t).getUTCMonth() === 0;
      out.push({
        ms: t,
        label: stepMonths >= 12 || jan ? String(new Date(t).getUTCFullYear()) : MONTH[new Date(t).getUTCMonth()]!,
        major: jan,
      });
    }
    mo += stepMonths;
    y += Math.floor(mo / 12);
    mo %= 12;
  }
  return out;
}

export function lunationCell(utc_ms: number, epochMs: number, slotMs: number): { col: number; row: number } {
  const dt = utc_ms - epochMs;
  const col = Math.floor(dt / MS_LUNATION);
  const row = Math.floor((dt - col * MS_LUNATION) / slotMs);
  return { col, row };
}
