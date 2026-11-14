import { ApiError } from "../api/client";

export function parseBudgetInput(text: string): { value: number | undefined; error: string | null } {
  const t = text.trim();
  if (t === "") return { value: undefined, error: null };
  if (!/^\d+(\.\d+)?$/.test(t)) return { value: undefined, error: "Enter the cap in US dollars as a positive number, for example 2.50." };
  const value = Number(t);
  if (!(value > 0)) return { value: undefined, error: "The cap must be greater than 0 USD." };
  return { value, error: null };
}

const usd = (v: number): string => `$${v.toFixed(2)}`;

export function budgetFieldError(e: unknown): string | null {
  if (!(e instanceof ApiError) || e.status !== 422) return null;
  const errors = Array.isArray(e.problem?.["errors"]) ? (e.problem["errors"] as Array<Record<string, unknown>>) : [];
  const hit = errors.find((x) => Array.isArray(x["loc"]) && (x["loc"] as unknown[]).includes("budget_usd"));
  if (!hit) return null;
  const ceiling = e.problem?.["ceiling_usd"];
  if (hit["type"] === "budget_ceiling" && typeof ceiling === "number") return `Above this engine's ceiling of ${usd(ceiling)} per run. Enter ${usd(ceiling)} or less.`;
  return typeof hit["msg"] === "string" ? hit["msg"] : e.detail ?? "The engine rejected this cap.";
}

export interface BudgetSpent {
  budgetUsd: number | undefined;
  costUsd: number | undefined;
  detail: string | undefined;
}

export function budgetSpentProblem(e: unknown): BudgetSpent | null {
  if (!(e instanceof ApiError) || e.status !== 409 || !/\/budget-spent$/.test(e.type ?? "")) return null;
  const b = e.problem?.["budget_usd"];
  const c = e.problem?.["cost_usd"];
  return { budgetUsd: typeof b === "number" ? b : undefined, costUsd: typeof c === "number" ? c : undefined, detail: e.detail };
}

export function isBudgetSpent(costUsd: number | null | undefined, budgetUsd: number | null | undefined): boolean {
  return typeof costUsd === "number" && typeof budgetUsd === "number" && costUsd >= budgetUsd;
}
