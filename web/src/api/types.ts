import type { components } from "./generated/schema";

export type Timestamp = number | string;

export function toMs(ts: Timestamp | undefined | null): number | undefined {
  if (ts === undefined || ts === null) return undefined;
  if (typeof ts === "number") return ts;
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? undefined : ms;
}

interface EventBase {
  run_id: string;
  seq: number;
  ts: Timestamp;
  turn: number;
}

interface ToolSpec {
  name: string;
  kind: "builtin" | "engine";
  description: string;
  input_schema?: Record<string, unknown> | null;
  read_only: boolean;
}

interface SandboxInfo {
  mode?: string;
  available?: boolean;
  enabled?: boolean;
  detail?: string;
  network_allowed_domains?: string[] | null;
  filesystem?: Record<string, unknown>;
}

export interface RunStartEvent extends EventBase {
  type: "run_start";
  model: string;
  instructions: string;
  prompt_version: string;
  prompt_sha256: string;
  prompt_template_sha256: string;
  tools: ToolSpec[];
  workspace?: string;
  permission_policy?: Record<string, unknown>;
  sandbox?: SandboxInfo;
  versions?: Record<string, string>;
  resumed_from?: string | null;
}

export interface SessionInitEvent extends EventBase {
  type: "session_init";
  session_id: string;
  resolved_model?: string;
  tools?: string[];
  mcp_servers?: Array<{ name: string; status: string; source?: string }>;
  cli_version?: string;
  permission_mode?: string;
}

interface UserPromptEvent extends EventBase {
  type: "user_prompt";
  text: string;
}

interface DeltaEvent extends EventBase {
  type: "text_delta" | "reasoning_delta";
  message_id: string;
  index: number;
  text: string;
}

interface BlockEvent extends EventBase {
  type: "text" | "reasoning";
  message_id: string;
  index: number;
  text: string;
}

interface ToolCallEvent extends EventBase {
  type: "tool_call";
  tool_use_id: string;
  name: string;
  kind: "builtin" | "engine";
  input: Record<string, unknown>;
}

interface ToolResultEvent extends EventBase {
  type: "tool_result";
  tool_use_id: string;
  name: string;
  is_error: boolean;
  content: string;
  truncated?: boolean;
  content_sha256?: string;
  ledger_id?: string | null;
}

interface PermissionDeniedEvent extends EventBase {
  type: "permission_denied";
  tool_use_id: string;
  name: string;
  input: Record<string, unknown>;
  rule: string;
  reason: string;
}

export interface AssumptionEvent extends EventBase {
  type: "assumption_recorded";
  assumption_id: string;
  statement: string;
  basis: string;
  impact: string;
  needs_signoff: boolean;
}

export interface ArtifactEvent extends EventBase {
  type: "artifact_produced";
  artifact_id: string;
  path: string;
  kind: string;
  description: string;
  sha256: string;
  size_bytes?: number;
  version: number;
}

interface ErrorEvent extends EventBase {
  type: "error";
  kind: string;
  message: string;
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  cost_usd: number | null;
  duration_ms?: number | null;
  api_duration_ms?: number | null;
  model_usage?: Record<string, unknown>;
}

interface TurnEndEvent extends EventBase {
  type: "turn_end";
  status: "completed" | "interrupted" | "error";
  stop_reason?: string;
  usage: Usage;
  final_text?: string;
  num_model_turns?: number;
  permission_denials?: unknown[];
  citations?: TurnCitation[];
  limits?: TurnLimit[];
  assumptions?: TurnAssumption[];
  digest?: TurnDigestRow[];
  outstanding_issues?: TurnIssue[];
}

export interface TurnIssue {
  kind: string;
  text: string;
  line: number;
  detail: string;
}

export interface TurnDigestScenario {
  id: string;
  name?: string | null;
  site?: string | null;
  lat_deg?: number | null;
  lon_deg?: number | null;
  landing_utc?: string | null;
}

interface TurnDigestVerdict {
  state: string;
  limiting?: string | null;
}

export interface TurnDigestRow {
  id: string;
  tool: string;
  scenarios: TurnDigestScenario[];
  verdict?: TurnDigestVerdict;
  verdicts?: Array<TurnDigestVerdict & { row?: string | null }>;
  states?: Record<string, number>;
  limits: string[];
  assumptions: Array<{ id: string; status: string }>;
  cited: boolean;
}

export type SourceKind = "engine_result" | "input" | "script_value" | "assumption" | "document" | "user_request";

export interface TurnCitation {
  id: string;
  row: string | null;
  kinds?: SourceKind[];
  tool: string;
  derived_from: string[];
}

export interface TurnLimit {
  id: string;
  text: string;
  cited_by: string[];
}

export interface TurnAssumption {
  id: string;
  statement: string;
  status: "pending" | "accepted" | "rejected";
  cited_by: string[];
}

interface RunEndEvent extends EventBase {
  type: "run_end";
  status: string;
  turns?: number;
  usage?: Usage;
}

export type AgentEvent =
  | RunStartEvent
  | SessionInitEvent
  | UserPromptEvent
  | DeltaEvent
  | BlockEvent
  | ToolCallEvent
  | ToolResultEvent
  | PermissionDeniedEvent
  | AssumptionEvent
  | ArtifactEvent
  | ErrorEvent
  | TurnEndEvent
  | RunEndEvent;

export interface RunSummary {
  run_id: string;
  state: string;
  status?: string;
  live?: boolean;
  busy?: boolean;
  shared?: boolean;
  sandbox?: SandboxInfo | null;
  model: string;
  created_at?: Timestamp;
  updated_at?: Timestamp;
  turns?: number;
  cost_usd?: number | null;
  budget_usd?: number | null;
  first_prompt?: string;
  prompt_version?: string;
  prompt_sha256?: string;
  session_id?: string;
}

interface LedgerFile {
  path: string;
  sha256: string;
}

interface ScriptValue {
  value: unknown;
  unit?: string;
  inputs?: string[];
}

interface ScriptCall {
  fn?: string | null;
  args_digest?: string | null;
  seconds?: number | null;
}

export interface LedgerEntry {
  ledger_id: string;
  tool: string;
  source?: string;
  status?: string;
  input: unknown;
  input_sha256?: string | null;
  output_sha256?: string | null;
  output?: unknown;
  data_versions?: Record<string, string>;
  depends_on?: string[];
  limits?: string[];
  files?: LedgerFile[];
  result_file?: string | null;
  scenario_id?: string | null;
  provenance?: unknown;
  rows?: Record<string, string>;
  output_kind?: string;
  values?: Record<string, ScriptValue | string>;
  invalid?: string[];
  calls?: ScriptCall[];
  error?: string | null;
  duration_ms?: number;
  prev?: string;
  ts?: Timestamp;
}

export interface ArtifactRecord {
  artifact_id: string;
  kind: string;
  description: string;
  path: string;
  mime?: string;
  sha256: string;
  size_bytes?: number;
  version: number;
  ts?: Timestamp;
}

export interface ChainStatus {
  ok: boolean;
  problems: string[];
}

export interface LedgerList<T> {
  entries: T[];
  chain: ChainStatus;
}

export type Instructions = Pick<
  RunStartEvent,
  "model" | "instructions" | "prompt_version" | "prompt_sha256" | "prompt_template_sha256" | "tools" | "permission_policy" | "sandbox" | "versions" | "workspace"
>;

export type EvidenceDoc = components["schemas"]["EvidenceDoc"];

export type LedgerResult = components["schemas"]["LedgerResult"];
