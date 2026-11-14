import type { AssumptionItem, SignoffRequest } from "./api";

export interface SignoffDraft {
  decision: SignoffRequest["decision"] | "";
  who: string;
  note: string;
}

export type SignoffErrors = Partial<Record<keyof SignoffDraft, string>>;

export function validateSignoff(d: SignoffDraft): SignoffErrors {
  const errors: SignoffErrors = {};
  if (d.decision !== "accepted" && d.decision !== "rejected") errors.decision = "Choose accept or reject.";
  if (!d.who.trim()) errors.who = "Say who is deciding (a name or role).";
  if (!d.note.trim()) errors.note = "Give the reason for the decision.";
  return errors;
}

export interface AssumptionSummary {
  total: number;
  pending: number;
  accepted: number;
  rejected: number;
  notRequired: number;
}

export function summariseAssumptions(items: readonly AssumptionItem[]): AssumptionSummary {
  const s: AssumptionSummary = { total: items.length, pending: 0, accepted: 0, rejected: 0, notRequired: 0 };
  const key: Record<AssumptionItem["status"], "pending" | "accepted" | "rejected" | "notRequired"> = {
    pending: "pending",
    accepted: "accepted",
    rejected: "rejected",
    not_required: "notRequired",
  };
  for (const a of items) s[key[a.status]] += 1;
  return s;
}

export const STATUS_LABEL: Record<AssumptionItem["status"], string> = {
  pending: "Pending sign-off",
  accepted: "Accepted",
  rejected: "Rejected: blocking",
  not_required: "No sign-off required",
};
