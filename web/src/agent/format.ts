import { ApiError } from "../api/client";
import { isBudgetSpent } from "./budget";

export function shortHash(h: string | undefined | null): string {
  if (!h) return "—";
  const bare = h.startsWith("sha256:") ? h.slice(7) : h;
  return bare.length > 14 ? `${bare.slice(0, 8)}…${bare.slice(-4)}` : bare;
}

export function formatCost(usd: number | null | undefined): string {
  if (usd === null || usd === undefined || !Number.isFinite(usd)) return "—";
  if (usd === 0) return "$0";
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(usd < 1 ? 3 : 2)}`;
}

export function formatTokens(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n >= 10_000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : String(n);
}

export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  return `${Math.floor(s / 60)} m ${Math.round(s % 60)} s`;
}

export function formatBytes(n: number | undefined): string {
  if (n === undefined) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function shortToolName(name: string): string {
  return name.startsWith("mcp__") ? name.split("__").slice(2).join("__") : name;
}

const EXT_LANG: Record<string, string> = {
  py: "python",
  json: "json",
  jsonl: "json",
  md: "markdown",
  sh: "bash",
  yml: "yaml",
  yaml: "yaml",
  js: "javascript",
  ts: "typescript",
  csv: "csv",
  txt: "plaintext",
  diff: "diff",
};

export function languageFor(pathOrMime: string | undefined): string {
  if (!pathOrMime) return "plaintext";
  if (pathOrMime.includes("/") && !pathOrMime.includes(".")) {
    if (pathOrMime.includes("python")) return "python";
    if (pathOrMime.includes("json")) return "json";
    if (pathOrMime.includes("markdown")) return "markdown";
    if (pathOrMime.includes("csv")) return "csv";
    return "plaintext";
  }
  const ext = pathOrMime.split(".").pop()?.toLowerCase() ?? "";
  return EXT_LANG[ext] ?? "plaintext";
}

interface InputPart {
  label: string;
  language: string;
  code: string;
}

export interface FormattedInput {
  headline: string;
  parts: InputPart[];
}

const str = (v: unknown): string => (typeof v === "string" ? v : JSON.stringify(v, null, 2));

export function formatToolInput(name: string, input: Record<string, unknown> | undefined): FormattedInput {
  if (!input) return { headline: "", parts: [] };
  const tool = shortToolName(name);
  const rest = (omit: string[]) => Object.fromEntries(Object.entries(input).filter(([k]) => !omit.includes(k)));
  const json = (obj: Record<string, unknown>): InputPart[] => (Object.keys(obj).length ? [{ label: "input", language: "json", code: JSON.stringify(obj, null, 2) }] : []);

  if (tool === "Bash" && typeof input["command"] === "string") {
    const desc = typeof input["description"] === "string" ? input["description"] : "";
    return { headline: desc || firstLine(input["command"]), parts: [{ label: "command", language: "bash", code: input["command"] }, ...json(rest(["command", "description"]))] };
  }
  if ((tool === "Write" || tool === "Edit") && typeof input["file_path"] === "string") {
    const path = input["file_path"];
    const lang = languageFor(path);
    const parts: InputPart[] = [];
    if (tool === "Write") parts.push({ label: "content", language: lang, code: str(input["content"] ?? "") });
    else {
      parts.push({ label: "old_string", language: lang, code: str(input["old_string"] ?? "") });
      parts.push({ label: "new_string", language: lang, code: str(input["new_string"] ?? "") });
    }
    return { headline: path, parts: [...parts, ...json(rest(["file_path", "content", "old_string", "new_string"]))] };
  }
  if ((tool === "Read" || tool === "Glob" || tool === "Grep") && (input["file_path"] || input["pattern"] || input["path"])) {
    return { headline: String(input["file_path"] ?? input["pattern"] ?? input["path"]), parts: json(input) };
  }
  if (tool === "fetch_data" && typeof input["url"] === "string") {
    return { headline: `${input["url"]} → ${String(input["dest"] ?? "")}`, parts: json(input) };
  }
  if (tool === "record_assumption" && typeof input["statement"] === "string") {
    return { headline: input["statement"], parts: json(input) };
  }
  if (tool === "register_artifact" && typeof input["path"] === "string") {
    return { headline: `${String(input["kind"] ?? "artifact")} ${input["path"]}`, parts: json(input) };
  }
  return { headline: "", parts: json(input) };
}

function firstLine(s: string): string {
  const line = s.split("\n", 1)[0] ?? "";
  return line.length > 140 ? `${line.slice(0, 137)}…` : line;
}

export interface FormattedResult {
  language: string;
  text: string;
  json: boolean;
}

function indentJson(text: string): string | null {
  try {
    JSON.parse(text);
  } catch {
    return null;
  }
  let out = "";
  let depth = 0;
  let i = 0;
  const nl = () => `\n${"  ".repeat(depth)}`;
  while (i < text.length) {
    const c = text[i]!;
    if (c === '"') {
      let j = i + 1;
      while (text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === "{" || c === "[") {
      let j = i + 1;
      while (/\s/.test(text[j] ?? "")) j += 1;
      if (text[j] === (c === "{" ? "}" : "]")) {
        out += c + text[j];
        i = j + 1;
      } else {
        depth += 1;
        out += c + nl();
        i += 1;
      }
    } else if (c === "}" || c === "]") {
      depth -= 1;
      out += nl() + c;
      i += 1;
    } else if (c === ",") {
      out += "," + nl();
      i += 1;
    } else if (c === ":") {
      out += ": ";
      i += 1;
    } else {
      if (!/\s/.test(c)) out += c;
      i += 1;
    }
  }
  return out;
}

export function formatToolResult(content: string): FormattedResult {
  const t = content.trim();
  if ((t.startsWith("{") || t.startsWith("[")) && t.length < 2_000_000) {
    const text = indentJson(t);
    if (text !== null) return { language: "json", text, json: true };
  }
  return { language: "plaintext", text: content, json: false };
}

interface ModelLimit {
  id: string;
  title: string;
  text: string;
}

interface RefusalReason {
  code: string;
  message: string;
}

export interface ToolResultMeta {
  limits: ModelLimit[];
  invariantViolations: string[];
  dependsOn: string[];
  resultFiles: string[];
  warnings: string[];
  refusals: RefusalReason[];
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === "string" ? v : "");
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const records = (v: unknown, key: string): Rec[] => (Array.isArray(v) ? v.filter((r): r is Rec => isRec(r) && typeof r[key] === "string") : []);
const refusalList = (v: unknown): RefusalReason[] => records(v, "code").map((r) => ({ code: r["code"] as string, message: text(r["message"]) }));

export function parseToolResultMeta(content: string): ToolResultMeta | null {
  const t = content.trim();
  if (!t.startsWith("{")) return null;
  let d: unknown;
  try {
    d = JSON.parse(t);
  } catch {
    return null;
  }
  if (!isRec(d)) return null;
  const refusals = refusalList(d["refusals"]);
  const meta: ToolResultMeta = {
    limits: records(d["limits"], "id").map((l) => ({ id: l["id"] as string, title: text(l["title"]), text: text(l["text"]) })),
    invariantViolations: strings(d["invariant_violations"]),
    dependsOn: strings(d["depends_on"]),
    resultFiles: strings(d["result_files"]),
    warnings: strings(d["warnings"]),
    refusals: refusals.length ? refusals : refusalList(isRec(d["report"]) ? d["report"]["refusals"] : undefined),
  };
  return Object.values(meta).some((list) => list.length > 0) ? meta : null;
}

export const failureText = (e: unknown, fallback: string): string => (e instanceof ApiError ? `${e.message} (HTTP ${e.status})` : e instanceof Error ? e.message : fallback);

export function compareTemplateHash(run: string, service: string | undefined): "match" | "differs" | "unknown" {
  if (!service) return "unknown";
  return run === service ? "match" : "differs";
}

export function isActiveState(state: string | undefined): boolean {
  return state === "running" || state === "starting" || state === "active";
}

export type RunStatusTone = "warn" | "error" | "cancelled" | "other";

export function runStatusTone(status: string | undefined | null): RunStatusTone | null {
  if (!status || status === "completed") return null;
  if (status === "interrupted") return "warn";
  if (status === "failed" || status === "error") return "error";
  if (status === "cancelled" || status === "canceled") return "cancelled";
  return "other";
}

export const turnStatusLabel = (status: string | undefined | null, outstandingIssues: number): string =>
  status === "completed" && outstandingIssues > 0 ? "answer not verified" : (status ?? "");

export const basisLabel = (basis: string): string => (basis === "model-typed" ? "typed by the assistant, not confirmed" : basis);

export interface SpendSummary {
  text: string;
  detail: string;
  capReached: boolean;
}

export function spendSummary({ costUsd, budgetUsd, turnsEnded, running }: { costUsd: number | null | undefined; budgetUsd?: number | null | undefined; turnsEnded: number; running: boolean }): SpendSummary {
  const turns = `${turnsEnded} turn${turnsEnded === 1 ? "" : "s"}`;
  const cap = typeof budgetUsd === "number" ? formatCost(budgetUsd) : null;
  const capReached = isBudgetSpent(costUsd, budgetUsd);
  const capNote = cap ? ` This thread's cap is ${cap}${capReached ? ", and it has been reached" : ""}.` : budgetUsd === null ? " The engine reports no cap for this thread." : "";
  const spent = formatCost(costUsd);
  if (turnsEnded === 0) {
    return running
      ? { text: cap ? `turn 1 running · cap ${cap}` : "turn 1 running", detail: `No turn has ended yet. The cost of a turn is reported when it ends, so no spend is on record yet.${capNote}`, capReached }
      : { text: cap ? `${spent} of ${cap}` : spent, detail: `No turn has ended, so no cost is on record yet.${capNote}`, capReached };
  }
  const cost = cap ? `${spent} of ${cap}` : spent;
  if (running) {
    return {
      text: `${cost} · ${turns} ended · turn ${turnsEnded + 1} running`,
      detail: `${spent} API-equivalent cost as of the end of turn ${turnsEnded}. Turn ${turnsEnded + 1} is still running. Its cost is added when it ends.${capNote}`,
      capReached,
    };
  }
  return { text: `${cost} · ${turns}`, detail: `${spent} API-equivalent cost as of the end of turn ${turnsEnded}, as reported when the turn ended.${capNote}`, capReached };
}
