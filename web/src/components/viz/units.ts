import { NBSP } from "../../lib/format";
import { formatQuantity } from "../../lib/requirements";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");
const MINUS = "−";

export function whenText(ms: number, opts: { year?: boolean } = {}): string {
  if (!Number.isFinite(ms)) return "—";
  const d = new Date(Math.round(ms / 60_000) * 60_000);
  const date = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${opts.year === false ? "" : ` ${d.getUTCFullYear()}`}`;
  return `${date} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}${NBSP}UTC`;
}

function signed(text: string, v: number, sign: boolean): string {
  if (v < 0) return MINUS + text;
  return sign ? `+${text}` : text;
}

export function hoursText(h: number, opts: { sign?: boolean } = {}): string {
  return formatQuantity(h, "h", opts);
}

export function spanText(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  const h = Math.max(0, ms) / 3_600_000;
  if (h < 1) return `${Math.round(h * 60)}${NBSP}min`;
  return formatQuantity(h, "h");
}

const trim = (n: string, exact: boolean | undefined) => (exact ? String(Number(n)) : n);

export function quantityText(v: number | null | undefined, unit: string | null | undefined, opts: { sign?: boolean; decimals?: number; bare?: boolean; exact?: boolean } = {}): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  if (!opts.bare && opts.decimals === undefined) return formatQuantity(v, unit, { sign: opts.sign });
  const sign = opts.sign ?? false;
  const u = unit ?? "";
  if (u === "h") {
    if (opts.exact) return signed(Math.abs(v) < 48 ? `${Number(Math.abs(v).toFixed(1))}${NBSP}h` : spanText(Math.abs(v) * 3_600_000), v, sign);
    return hoursText(v, { sign });
  }
  if (u === "fraction" || u === "") {
    const pct = trim(Math.abs(v * 100).toFixed(opts.decimals ?? 0), opts.exact);
    return signed(opts.bare ? pct : `${pct}${NBSP}%`, v, sign);
  }
  const n = trim(Math.abs(v).toFixed(opts.decimals ?? 1), opts.exact);
  if (u === "deg" || u === "°") return signed(opts.bare ? n : `${n}°`, v, sign);
  return signed(opts.bare ? n : `${n}${NBSP}${u}`, v, sign);
}

export function unitText(unit: string | null | undefined): string {
  return unit === "deg" ? "°" : unit === "fraction" || unit === "" || unit == null ? "%" : unit;
}
