import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CONTROL_TOOLS } from "./mcp";

export const SERVER = "lunarnav";

export type ClaudeOptions = { system: string; schema: object; mcpConfigPath?: string; model: string; maxTurns: number };
export type ClaudeRun = { structured: unknown; ledgerIds: string[]; turns: number };

export class ClaudeError extends Error {}

export function claudeBin(): string {
  return process.env.LUNARNAV_CLAUDE_BIN || "claude";
}

export function claudeArgs(opts: ClaudeOptions): string[] {
  const args = [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--model", opts.model,
    "--max-turns", String(opts.maxTurns),
    "--system-prompt", opts.system,
    "--json-schema", JSON.stringify(opts.schema),
    "--tools", "",
    "--setting-sources", "project",
    "--no-session-persistence",
  ];
  if (opts.mcpConfigPath) {
    args.push(
      "--mcp-config", opts.mcpConfigPath,
      "--strict-mcp-config",
      "--allowedTools", `mcp__${SERVER}`,
      "--disallowedTools", ...CONTROL_TOOLS.map((t) => `mcp__${SERVER}__${t}`),
    );
  }
  return args;
}

export function ledgerIdsIn(value: unknown): string[] {
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? "";
  return [...new Set([...text.matchAll(/\\*"ledger_id\\*":\s*\\*"(L\d{4,})/g)].map((m) => m[1]))];
}

function exec(bin: string, args: string[], cwd: string, input: string): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (d) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d) => (stderr += d));
    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        reject(new ClaudeError(`cannot start Claude Code ("${bin}"): install it and log in, or set LUNARNAV_CLAUDE_BIN to its path`));
      } else reject(err);
    });
    child.on("close", (code) => resolve({ stdout, stderr, code }));
    child.stdin.end(input);
  });
}

export async function runClaude(opts: Omit<ClaudeOptions, "mcpConfigPath"> & { prompt: string; mcpUrl?: string }): Promise<ClaudeRun> {
  const dir = await mkdtemp(path.join(tmpdir(), "lunarnav-review-"));
  try {
    let mcpConfigPath: string | undefined;
    if (opts.mcpUrl) {
      mcpConfigPath = path.join(dir, "mcp.json");
      await writeFile(mcpConfigPath, JSON.stringify({ mcpServers: { [SERVER]: { type: "http", url: opts.mcpUrl } } }));
    }
    const { stdout, stderr, code } = await exec(claudeBin(), claudeArgs({ ...opts, mcpConfigPath }), dir, opts.prompt);
    const events: any[] = [];
    for (const line of stdout.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line));
      } catch {}
    }
    const result = events.filter((e) => e?.type === "result").pop();
    if (!result) {
      throw new ClaudeError(`Claude Code exited (code ${code}) without a result: ${(stderr || stdout).trim().slice(-1500) || "no output"}`);
    }
    if (result.is_error || result.subtype !== "success") {
      throw new ClaudeError(`Claude Code run failed (${result.subtype ?? "error"}): ${String(result.result ?? result.errors ?? stderr).slice(0, 1500)}`);
    }
    if (result.structured_output === undefined || result.structured_output === null) {
      throw new ClaudeError(
        `Claude Code returned no structured_output for --json-schema (it may be blocked by --tools ""); last text: ${String(result.result ?? "").slice(0, 500)}`,
      );
    }
    const ledgerIds = ledgerIdsIn(events.filter((e) => e?.type === "user").map((e) => JSON.stringify(e)).join("\n"));
    const turns = events.filter((e) => e?.type === "assistant" && e.message?.content?.some?.((b: any) => b?.type === "tool_use")).length;
    return { structured: result.structured_output, ledgerIds, turns };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
