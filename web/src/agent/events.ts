import type { AgentEvent, Instructions, RunStartEvent } from "../api/types";

type Base = Pick<AgentEvent, "run_id" | "seq" | "ts" | "turn">;

interface TemplateHash {
  max_budget_usd?: number | null;
}

export type RunStart = RunStartEvent & TemplateHash;
export type InstructionsInfo = Instructions & TemplateHash;

export interface AssumptionSignoffEvent extends Base {
  type: "assumption_signoff";
  assumption_id: string;
  decision: "accepted" | "rejected";
  who: string;
  note: string;
}

interface GuardIssue {
  kind: string;
  text: string;
  line: number;
  detail: string;
}

export interface GuardCheckEvent extends Base {
  type: "guard_check";
  status: "passed" | "flagged" | "error";
  attempt: number;
  issues: GuardIssue[];
  notes?: string[];
  detail?: string | null;
}

export interface InboxFileEvent extends Base {
  type: "inbox_file";
  name: string;
  path: string;
  size_bytes: number;
  sha256: string;
}

export type StreamEvent = Exclude<AgentEvent, RunStartEvent> | RunStart | AssumptionSignoffEvent | GuardCheckEvent | InboxFileEvent;
