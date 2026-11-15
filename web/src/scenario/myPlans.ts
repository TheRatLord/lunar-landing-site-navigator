const KEY = "lunarnav.plans";
const MAX = 100;

export function myPlanIds(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function write(ids: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids.slice(0, MAX)));
  } catch {
  }
}

export function rememberPlan(id: string): void {
  write([id, ...myPlanIds().filter((x) => x !== id)]);
}

export function forgetPlan(id: string): void {
  write(myPlanIds().filter((x) => x !== id));
}
