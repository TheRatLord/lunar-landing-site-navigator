import { MS_HOUR, parseUtc } from "../../lib/time";
import { MAX_SLIPS, MAX_SLIP_H, normalizeSlips } from "./options";

const trim = (v: number, decimals: number) => String(Number(v.toFixed(decimals)));

function delayLabel(h: number): string {
  if (h === 0) return "Planned";
  const sign = h > 0 ? "+" : "−";
  const a = Math.abs(h);
  const d = a / 24;
  const d1 = Math.round(d * 10) / 10;
  if (a >= 24 && Math.abs(d - d1) * 24 < 1) return `${sign}${trim(d1, 1)} d`;
  return `${sign}${trim(a, 2)} h`;
}

export function delayLabels(hours: readonly number[]): string[] {
  const short = hours.map(delayLabel);
  return short.map((s, i) => (short.indexOf(s) !== short.lastIndexOf(s) ? `${s} (${trim(Math.abs(hours[i]!), 3)} h)` : s));
}

type DelayParse = { ok: true; hours: number[] } | { ok: false; error: string };

const UNIT: Record<string, "w" | "d" | "h"> = { w: "w", wk: "w", wks: "w", week: "w", weeks: "w", d: "d", day: "d", days: "d", h: "h", hr: "h", hrs: "h", hour: "h", hours: "h" };
const HELP = "Type 10 d or 20 Mar 2027";
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAY_DATE = /^(\d{1,2})\s+([a-z]{3})[a-z]*\.?(?:\s+(\d{4}))?(?:\s+(\d{1,2}):(\d{2}))?(?:\s*utc)?$/i;

function dayDate(text: string, plannedMs: number | null): number | null {
  const m = DAY_DATE.exec(text.trim());
  if (!m) return null;
  const month = MONTHS.indexOf(m[2]!.toLowerCase());
  if (month < 0) return null;
  const year = m[3] ? Number(m[3]) : new Date(plannedMs ?? Date.now()).getUTCFullYear();
  const day = Number(m[1]);
  const ms = Date.UTC(year, month, day, m[4] ? Number(m[4]) : 0, m[5] ? Number(m[5]) : 0);
  return new Date(ms).getUTCDate() === day ? ms : null;
}
const AMOUNT = /^([+-]?)(\d+(?:\.\d+)?|\.\d+)\s*([a-z]*)$/i;
const RANGE = /^(.+?)\s*\.\.\s*(.+?)(?:\s+(?:by|step)\s+(.+))?$/i;
const DATE = /^\d{4}-\d{1,2}-\d{1,2}/;

interface Amount {
  value: number;
  unit: "w" | "d" | "h" | null;
}

function amount(text: string): Amount | string {
  const m = AMOUNT.exec(text.trim());
  if (!m) return HELP;
  const unitText = m[3]!.toLowerCase();
  const unit = unitText === "" ? null : UNIT[unitText];
  if (unit === undefined) return HELP;
  return { value: (m[1] === "-" ? -1 : 1) * Number(m[2]), unit };
}

const PER: Record<"w" | "d" | "h", number> = { w: 168, d: 24, h: 1 };
const toHours = (a: Amount, unit: "w" | "d" | "h") => Number((a.value * PER[a.unit ?? unit]).toFixed(6));

function parsePart(part: string, plannedMs: number | null, noDate: string): number[] | string {
  const named = dayDate(part, plannedMs);
  if (named !== null) {
    if (plannedMs === null) return noDate;
    return [Number(((named - plannedMs) / MS_HOUR).toFixed(3))];
  }
  if (DATE.test(part)) {
    const ms = parseUtc(part.replace(/z$/i, ""));
    if (ms === null) return HELP;
    if (plannedMs === null) return noDate;
    return [Number(((ms - plannedMs) / MS_HOUR).toFixed(3))];
  }
  const r = RANGE.exec(part);
  if (r) {
    const a = amount(r[1]!);
    const b = amount(r[2]!);
    const s = r[3] === undefined ? { value: 1, unit: null } : amount(r[3]);
    for (const x of [a, b, s]) if (typeof x === "string") return x;
    const [A, B, S] = [a, b, s] as Amount[];
    const unit = A!.unit ?? B!.unit ?? S!.unit ?? "d";
    const [from, to, step] = [toHours(A!, unit), toHours(B!, unit), toHours(S!, unit)];
    if (step <= 0) return `"${part}": the step must be more than 0`;
    if (from > to) return `"${part}": the range must run from the earlier to the later delay`;
    const n = Math.floor((to - from) / step + 1e-9) + 1;
    if (n > MAX_SLIPS) return `"${part}" gives ${n} dates; at most ${MAX_SLIPS} fit in one run`;
    return Array.from({ length: n }, (_, i) => Number((from + i * step).toFixed(6)));
  }
  const whole = amount(part);
  if (typeof whole !== "string") return [toHours(whole, "d")];
  const words = part.split(/\s+/);
  if (words.length === 1) return whole;
  if (words.length === 2) {
    const joined = amount(words.join(""));
    if (typeof joined !== "string") return [toHours(joined, "d")];
  }
  const out: number[] = [];
  for (const w of words) {
    const x = amount(w);
    if (typeof x === "string") return x;
    out.push(toHours(x, "d"));
  }
  return out;
}

function parseDelays(text: string, plannedMs: number | null, noDate = "Type a delay, like 10 d"): DelayParse {
  const parts = text
    .replace(/\u2212/g, "-")
    .split(/[,;]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return { ok: false, error: HELP };
  const hours: number[] = [];
  for (const p of parts) {
    const got = parsePart(p, plannedMs, noDate);
    if (typeof got === "string") return { ok: false, error: got };
    const far = got.find((h) => Math.abs(h) > MAX_SLIP_H);
    if (far !== undefined) return { ok: false, error: "Keep within a year of the landing" };
    if (plannedMs !== null && plannedMs > Date.now() && got.some((h) => plannedMs + h * MS_HOUR < Date.now() - MS_HOUR)) return { ok: false, error: "That date has passed" };
    hours.push(...got);
  }
  return { ok: true, hours };
}

export function addDelays(existing: readonly number[], text: string, plannedMs: number | null, noDate?: string): DelayParse {
  const p = parseDelays(text, plannedMs, noDate);
  if (!p.ok) return p;
  const unique = new Set([0, ...existing, ...p.hours]);
  if (unique.size > MAX_SLIPS) return { ok: false, error: `At most ${MAX_SLIPS} dates` };
  if (unique.size === new Set([0, ...existing]).size) return { ok: false, error: "Already in the grid" };
  return { ok: true, hours: normalizeSlips([...unique]) };
}
