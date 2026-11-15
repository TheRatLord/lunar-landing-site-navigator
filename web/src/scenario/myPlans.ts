import { ApiError } from "../api/client";
import { parseUtc } from "../lib/time";
import { scenarioApi } from "./api";
import type { ScenarioRecord } from "./types";

const KEY = "lunarnav.plans";
const CREATED_KEY = "lunarnav.plans.created";
const MAX = 100;

function readIds(key: string): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeIds(key: string, ids: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(ids.slice(0, MAX)));
  } catch {
  }
}

export function myPlanIds(): string[] {
  return readIds(KEY);
}

export function rememberPlan(id: string): void {
  writeIds(KEY, [id, ...myPlanIds().filter((x) => x !== id)]);
}

export function forgetPlan(id: string): void {
  writeIds(KEY, myPlanIds().filter((x) => x !== id));
  writeIds(CREATED_KEY, readIds(CREATED_KEY).filter((x) => x !== id));
}

export function markCreated(id: string): void {
  writeIds(CREATED_KEY, [id, ...readIds(CREATED_KEY).filter((x) => x !== id)]);
}

export function createdHere(id: string): boolean {
  return readIds(CREATED_KEY).includes(id);
}

export async function loadCreatedPlans(): Promise<ScenarioRecord[]> {
  const ids = readIds(CREATED_KEY);
  const settled = await Promise.allSettled(ids.map((id) => scenarioApi.get(id)));
  const out: ScenarioRecord[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") out.push(r.value);
    else if (r.reason instanceof ApiError && r.reason.notFound) forgetPlan(ids[i] ?? "");
  });
  return out.sort((a, b) => (parseUtc(b.updated_utc) ?? 0) - (parseUtc(a.updated_utc) ?? 0));
}
