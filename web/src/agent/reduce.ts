import type { AgentEvent, AssumptionEvent, ArtifactEvent, SessionInitEvent, TurnAssumption, TurnCitation, TurnDigestRow, TurnIssue, TurnLimit, Usage } from "../api/types";
import type { AssumptionSignoffEvent, GuardCheckEvent, InboxFileEvent, RunStart, StreamEvent } from "./events";

interface Head {
  key: string;
  seq: number;
  turn: number;
  ts: AgentEvent["ts"];
}

export interface UserBlock extends Head {
  kind: "user";
  text: string;
}

export interface TextBlock extends Head {
  kind: "text" | "reasoning";
  messageId: string;
  index: number;
  text: string;
  streaming: boolean;
}

export interface ToolBlock extends Head {
  kind: "tool";
  toolUseId: string;
  name: string;
  toolKind: "builtin" | "engine" | undefined;
  readOnly: boolean | undefined;
  input: Record<string, unknown> | undefined;
  result:
    | {
        seq: number;
        ts: AgentEvent["ts"];
        isError: boolean;
        content: string;
        truncated: boolean;
        sha256: string | undefined;
        ledgerId: string | null;
      }
    | undefined;
  denial: { seq: number; rule: string; reason: string } | undefined;
}

export interface NoteBlock extends Head {
  kind: "assumption" | "artifact";
  event: AssumptionEvent | ArtifactEvent;
}

export interface ErrorBlock extends Head {
  kind: "error";
  errorKind: string;
  message: string;
}

export interface TurnEndBlock extends Head {
  kind: "turn_end";
  status: string;
  usage: Usage;
  numModelTurns: number | undefined;
  denials: number;
  citations: TurnCitation[];
  limits: TurnLimit[];
  assumptions: TurnAssumption[];
  digest: TurnDigestRow[];
  outstanding: TurnIssue[];
}

export interface SystemBlock extends Head {
  kind: "system";
  what: "run_start" | "session_init" | "run_end";
  event: RunStart | SessionInitEvent | Extract<AgentEvent, { type: "run_end" }>;
}

export interface SignoffBlock extends Head {
  kind: "signoff";
  event: AssumptionSignoffEvent;
}

export interface GuardBlock extends Head {
  kind: "guard";
  event: GuardCheckEvent;
}

export interface InboxBlock extends Head {
  kind: "inbox";
  event: InboxFileEvent;
}

export type Block = UserBlock | TextBlock | ToolBlock | NoteBlock | SignoffBlock | GuardBlock | InboxBlock | ErrorBlock | TurnEndBlock | SystemBlock;

export interface RunState {
  runId: string | null;
  lastSeq: number;
  blocks: Block[];
  applied: ReadonlySet<number>;
  runStarts: RunStart[];
  sessionInit: SessionInitEvent | null;
  openTurns: number;
  totals: { costUsd: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; turns: number };
  ended: { status: string; seq: number } | null;
  ledgerRevision: number;
}

export const initialRunState = (runId: string | null = null): RunState => ({
  runId,
  lastSeq: -1,
  blocks: [],
  applied: new Set<number>(),
  runStarts: [],
  sessionInit: null,
  openTurns: 0,
  totals: { costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, turns: 0 },
  ended: null,
  ledgerRevision: 0,
});

function insertionIndex(blocks: readonly Block[], seq: number): number {
  let lo = 0;
  let hi = blocks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (blocks[mid]!.seq < seq) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function upsert(blocks: Block[], key: string, make: (existing: Block | undefined) => Block, seq: number): Block[] {
  const at = blocks.findIndex((b) => b.key === key);
  if (at >= 0) {
    const next = blocks.slice();
    const prev = blocks[at]!;
    next[at] = { ...make(prev), seq: Math.min(prev.seq, seq) } as Block;
    return next;
  }
  const next = blocks.slice();
  next.splice(insertionIndex(next, seq), 0, make(undefined));
  return next;
}

function emptyTool(e: { seq: number; turn: number; ts: AgentEvent["ts"]; tool_use_id: string; name: string }): ToolBlock {
  return {
    kind: "tool",
    key: `tool:${e.tool_use_id}`,
    seq: e.seq,
    turn: e.turn,
    ts: e.ts,
    toolUseId: e.tool_use_id,
    name: e.name,
    toolKind: undefined,
    readOnly: undefined,
    input: undefined,
    result: undefined,
    denial: undefined,
  };
}

function step(state: RunState, e: StreamEvent): RunState {
  if (state.applied.has(e.seq)) return state;
  const base: RunState = { ...state, applied: (state.applied as Set<number>).add(e.seq), lastSeq: Math.max(state.lastSeq, e.seq) };
  const { seq, turn, ts } = e;
  const put = (b: Block) => upsert(base.blocks, b.key, () => b, seq);

  switch (e.type) {
    case "run_start":
      return {
        ...base,
        runStarts: [...state.runStarts, e].sort((a, b) => a.seq - b.seq),
        blocks: put({ kind: "system", key: `system:${seq}`, seq, turn, ts, what: "run_start", event: e }),
      };
    case "session_init":
      return {
        ...base,
        sessionInit: !state.sessionInit || state.sessionInit.seq < seq ? e : state.sessionInit,
        blocks: put({ kind: "system", key: `system:${seq}`, seq, turn, ts, what: "session_init", event: e }),
      };
    case "run_end":
      return {
        ...base,
        ended: { status: e.status, seq },
        blocks: put({ kind: "system", key: `system:${seq}`, seq, turn, ts, what: "run_end", event: e }),
      };
    case "user_prompt":
      return {
        ...base,
        openTurns: state.openTurns + 1,
        ended: state.ended && state.ended.seq > seq ? state.ended : null,
        blocks: put({ kind: "user", key: `user:${seq}`, seq, turn, ts, text: e.text }),
      };
    case "text_delta":
    case "reasoning_delta": {
      const kind = e.type === "text_delta" ? "text" : "reasoning";
      const key = `${kind}:${e.message_id}:${e.index}`;
      const existing = base.blocks.find((b) => b.key === key) as TextBlock | undefined;
      if (existing && !existing.streaming) return base;
      return {
        ...base,
        blocks: upsert(
          base.blocks,
          key,
          (prev) => ({
            kind,
            key,
            seq,
            turn,
            ts,
            messageId: e.message_id,
            index: e.index,
            text: ((prev as TextBlock | undefined)?.text ?? "") + e.text,
            streaming: true,
          }),
          seq,
        ),
      };
    }
    case "text":
    case "reasoning": {
      return { ...base, blocks: put({ kind: e.type, key: `${e.type}:${e.message_id}:${e.index}`, seq, turn, ts, messageId: e.message_id, index: e.index, text: e.text, streaming: false }) };
    }
    case "tool_call": {
      const key = `tool:${e.tool_use_id}`;
      return {
        ...base,
        blocks: upsert(
          base.blocks,
          key,
          (prev) => ({ ...((prev as ToolBlock | undefined) ?? emptyTool(e)), name: e.name, toolKind: e.kind, readOnly: toolReadOnly(base, e.name), input: e.input, ts, turn, seq: Math.min(seq, prev?.seq ?? seq) }),
          seq,
        ),
      };
    }
    case "tool_result": {
      const key = `tool:${e.tool_use_id}`;
      return {
        ...base,
        ledgerRevision: e.ledger_id ? state.ledgerRevision + 1 : state.ledgerRevision,
        blocks: upsert(
          base.blocks,
          key,
          (prev) => ({
            ...((prev as ToolBlock | undefined) ?? emptyTool(e)),
            result: {
              seq,
              ts,
              isError: e.is_error,
              content: e.content,
              truncated: e.truncated ?? false,
              sha256: e.content_sha256,
              ledgerId: e.ledger_id ?? null,
            },
          }),
          seq,
        ),
      };
    }
    case "permission_denied": {
      const key = `tool:${e.tool_use_id}`;
      return {
        ...base,
        blocks: upsert(
          base.blocks,
          key,
          (prev) => {
            const t = (prev as ToolBlock | undefined) ?? emptyTool(e);
            return { ...t, input: t.input ?? e.input, denial: { seq, rule: e.rule, reason: e.reason } };
          },
          seq,
        ),
      };
    }
    case "assumption_recorded":
    case "artifact_produced": {
      return {
        ...base,
        ledgerRevision: state.ledgerRevision + 1,
        blocks: put({ kind: e.type === "assumption_recorded" ? "assumption" : "artifact", key: `${e.type}:${seq}`, seq, turn, ts, event: e }),
      };
    }
    case "assumption_signoff":
    case "guard_check":
    case "inbox_file": {
      const kind = e.type === "assumption_signoff" ? "signoff" : e.type === "guard_check" ? "guard" : "inbox";
      return {
        ...base,
        ledgerRevision: e.type === "guard_check" ? state.ledgerRevision : state.ledgerRevision + 1,
        blocks: put({ kind, key: `${e.type}:${seq}`, seq, turn, ts, event: e } as Block),
      };
    }
    case "error":
      return {
        ...base,
        blocks: put({ kind: "error", key: `error:${seq}`, seq, turn, ts, errorKind: e.kind, message: e.message }),
      };
    case "turn_end": {
      const u = e.usage;
      return {
        ...base,
        openTurns: Math.max(0, state.openTurns - 1),
        totals: {
          costUsd: state.totals.costUsd + (u.cost_usd ?? 0),
          inputTokens: state.totals.inputTokens + u.input_tokens,
          outputTokens: state.totals.outputTokens + u.output_tokens,
          cacheReadTokens: state.totals.cacheReadTokens + u.cache_read_tokens,
          turns: state.totals.turns + 1,
        },
        blocks: put({
          kind: "turn_end",
          key: `turn_end:${seq}`,
          seq,
          turn,
          ts,
          status: e.status,
          usage: u,
          numModelTurns: e.num_model_turns,
          denials: e.permission_denials?.length ?? 0,
          citations: e.citations ?? [],
          limits: e.limits ?? [],
          assumptions: e.assumptions ?? [],
          digest: e.digest ?? [],
          outstanding: e.outstanding_issues ?? [],
        }),
      };
    }
  }
}

export function applyEvents(state: RunState, events: readonly StreamEvent[]): RunState {
  let s: RunState = { ...state, applied: new Set(state.applied) };
  for (const e of events) s = step(s, e);
  return s;
}

export const isRunning = (s: RunState): boolean => s.openTurns > 0 && s.ended === null;

export function currentRunStart(s: RunState): RunStart | undefined {
  return s.runStarts[s.runStarts.length - 1];
}

function toolReadOnly(s: RunState, name: string): boolean | undefined {
  return currentRunStart(s)?.tools.find((t) => t.name === name)?.read_only;
}

export type AnswerMark =
  | { kind: "final"; attempt: number }
  | { kind: "unverified"; attempt: number }
  | { kind: "withheld" };

export function answerMarks(blocks: readonly Block[]): ReadonlyMap<string, AnswerMark> {
  const marks = new Map<string, AnswerMark>();
  let draft: TextBlock | null = null;
  let turn = Number.NaN;
  for (const b of blocks) {
    if (b.turn !== turn || b.kind === "user") {
      turn = b.turn;
      draft = null;
    }
    if (b.kind === "text") {
      draft = b;
      continue;
    }
    if (b.kind !== "guard" || draft === null) continue;
    const e = b.event;
    if (e.status === "passed") marks.set(draft.key, { kind: "final", attempt: e.attempt });
    else if (e.status === "flagged") marks.set(draft.key, { kind: "unverified", attempt: e.attempt });
    else marks.set(draft.key, { kind: "withheld" });
    draft = null;
  }
  return marks;
}

export const citationToken = (c: Pick<TurnCitation, "id" | "row">): string => (c.row === null || c.row === undefined ? c.id : `${c.id}#${c.row}`);

function perAnswer<T>(blocks: readonly Block[], marks: ReadonlyMap<string, AnswerMark>, pick: (end: TurnEndBlock) => T | null): ReadonlyMap<string, T> {
  const ends = new Map<number, TurnEndBlock>();
  for (const b of blocks) if (b.kind === "turn_end") ends.set(b.turn, b);
  const out = new Map<string, T>();
  for (const b of blocks) {
    const m = marks.get(b.key);
    if (b.kind !== "text" || (m?.kind !== "final" && m?.kind !== "unverified")) continue;
    const end = ends.get(b.turn);
    const v = end ? pick(end) : null;
    if (v !== null) out.set(b.key, v);
  }
  return out;
}

export const answerSources = (blocks: readonly Block[], marks: ReadonlyMap<string, AnswerMark>): ReadonlyMap<string, ReadonlyMap<string, TurnCitation>> =>
  perAnswer(blocks, marks, (end) => (end.citations.length > 0 ? new Map(end.citations.map((c) => [citationToken(c), c])) : null));

export const answerOutstanding = (blocks: readonly Block[], marks: ReadonlyMap<string, AnswerMark>): ReadonlyMap<string, readonly TurnIssue[]> =>
  perAnswer(blocks, marks, (end) => (end.outstanding.length > 0 ? end.outstanding : null));

const WORK_KINDS: ReadonlySet<Block["kind"]> = new Set(["reasoning", "tool", "assumption", "artifact", "signoff", "guard", "inbox", "system"]);

export const isWorkBlock = (b: Block): boolean => WORK_KINDS.has(b.kind);
