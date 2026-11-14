import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import path from "node:path";

export const CONTROL_TOOLS = ["record_planner_request", "set_blind_mission"] as const;

export type Lunarnav = {
  client: MCPClient;
  tools: Record<string, any>;
  recordRequest(text: string): Promise<void>;
  setBlind(missionId: string | null): Promise<void>;
  close(): Promise<void>;
};

function repoRoot(): string {
  return path.resolve(import.meta.dir, "..", "..");
}

function toWslPath(p: string): string {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(p);
  return m ? `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, "/")}` : p;
}

function stdioCommand(flags: string[]): { command: string; args: string[] } {
  const custom = process.env.LUNARNAV_MCP_CMD;
  if (custom) {
    const [command, ...args] = custom.split(" ").filter(Boolean);
    return { command, args: [...args, ...flags] };
  }
  if (process.platform === "win32") {
    const distro = process.env.LUNARNAV_WSL_DISTRO ?? "Ubuntu-24.04";
    const env = process.env.LUNARNAV_UV_ENV ?? "$HOME/.venvs/lunarnav";
    const script = `cd '${toWslPath(repoRoot())}' && UV_PROJECT_ENVIRONMENT="${env}" uv run lunarnav mcp ${flags.join(" ")}`;
    return { command: "wsl.exe", args: ["-d", distro, "--", "bash", "-lc", script] };
  }
  return { command: "uv", args: ["run", "--project", repoRoot(), "lunarnav", "mcp", ...flags] };
}

async function control(client: MCPClient, name: string, args: Record<string, unknown>): Promise<void> {
  const r = await client.callTool({ name, arguments: args });
  if (r.isError) throw new Error(`${name} failed: ${JSON.stringify(r.content)}`);
}

export async function connectLunarnav(opts: { blindExclude?: string; url?: string } = {}): Promise<Lunarnav> {
  const transport = opts.url
    ? { type: "http" as const, url: opts.url }
    : new StdioMCPTransport({ ...stdioCommand(opts.blindExclude ? ["--blind-exclude", opts.blindExclude] : []), stderr: "inherit" });
  const client = await createMCPClient({ transport });
  if (opts.url && opts.blindExclude) await control(client, "set_blind_mission", { mission_id: opts.blindExclude });
  const all = await client.tools();
  const tools = Object.fromEntries(Object.entries(all).filter(([n]) => !(CONTROL_TOOLS as readonly string[]).includes(n)));
  return {
    client,
    tools,
    recordRequest: (text) => control(client, "record_planner_request", { text }),
    setBlind: (missionId) => control(client, "set_blind_mission", { mission_id: missionId }),
    close: () => client.close(),
  };
}
