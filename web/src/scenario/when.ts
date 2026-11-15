import { formatQuantity } from "../lib/requirements";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

export function dayText(ms: number, year = true): string {
  const d = new Date(ms);
  const day = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return year ? `${day} ${d.getUTCFullYear()}` : day;
}

export function whenText(ms: number): string {
  if (!Number.isFinite(ms)) return "–";
  const d = new Date(ms);
  return `${dayText(ms)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

export function spanText(first: number, last: number): string {
  const sameYear = new Date(first).getUTCFullYear() === new Date(last).getUTCFullYear();
  return `${dayText(first, !sameYear)} – ${dayText(last)}`;
}

export function hoursOrDays(hours: number): string {
  return formatQuantity(hours, "h");
}
