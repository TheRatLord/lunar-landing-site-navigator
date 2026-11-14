import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";

export const CONTROL_TOOLS = ["record_planner_request", "set_blind_mission"] as const;

export type Lunarnav = {
  client: MCPClient;
  toolNames(): Promise<string[]>;
  recordRequest(text: string): Promise<void>;
  setBlind(missionId: string | null): Promise<void>;
  close(): Promise<void>;
};

async function control(client: MCPClient, name: string, args: Record<string, unknown>): Promise<void> {
  const r = await client.callTool({ name, arguments: args });
  if (r.isError) throw new Error(`${name} failed: ${JSON.stringify(r.content)}`);
}

export async function connectLunarnav(opts: { url: string }): Promise<Lunarnav> {
  const client = await createMCPClient({ transport: { type: "http", url: opts.url } });
  return {
    client,
    toolNames: async () => Object.keys(await client.tools()).filter((n) => !(CONTROL_TOOLS as readonly string[]).includes(n)),
    recordRequest: (text) => control(client, "record_planner_request", { text }),
    setBlind: (missionId) => control(client, "set_blind_mission", { mission_id: missionId }),
    close: () => client.close(),
  };
}
