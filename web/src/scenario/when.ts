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
  if (hours < 48) return `${Number(hours.toFixed(1))} h`;
  const days = hours / 24;
  return `${Number(days.toFixed(days % 1 === 0 ? 0 : 1))} days`;
}
