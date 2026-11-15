export type JobKind = "search";

const KEY = "lunarnav.job-pace";

function readAll(): Record<string, unknown> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function pace(kind: JobKind): number {
  const v = readAll()[kind];
  return typeof v === "number" && v >= 0.05 && v <= 20 ? v : 1;
}

export function learnPace(kind: JobKind, guessS: number, actualS: number): void {
  if (!(guessS > 0) || !(actualS > 5)) return;
  const all = readAll();
  all[kind] = Math.min(20, Math.max(0.05, (actualS / guessS) * pace(kind)));
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
  }
}

export function aboutText(seconds: number): string {
  if (seconds < 75) return "1 min";
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1).replace(/\.0$/, "")} h`;
}

const runs = new Map<number, { min: number; sofar: boolean }>();

export function leftText(startedMs: number, progress: number | null, guessS: number, now = Date.now()): string {
  const elapsed = (now - startedMs) / 1000;
  if (progress !== null && progress >= 0.99) return "almost done";
  const run = runs.get(startedMs) ?? { min: Infinity, sofar: false };
  runs.set(startedMs, run);
  const p = progress !== null && progress > 0.05 ? progress : 0;
  if (run.sofar || (p === 0 && elapsed > guessS)) return `${aboutText(elapsed)} so far`;
  const w = Math.min(1, p / 0.3);
  const total = p > 0 ? (1 - w) * Math.max(guessS, elapsed) + w * (elapsed / p) : guessS;
  const left = Math.round((total - elapsed) / 60);
  if (left > run.min + 1) {
    run.sofar = true;
    return `${aboutText(elapsed)} so far`;
  }
  run.min = Math.min(run.min, left);
  return run.min < 1 ? "almost done" : `${aboutText(run.min * 60)} left`;
}
