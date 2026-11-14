import { connectLunarnav, type Lunarnav } from "../src/mcp";
import { reviewSite } from "../src/review";

let shared: Promise<Lunarnav> | null = null;

function connection(): Promise<Lunarnav> {
  const url = process.env.LUNARNAV_MCP_URL;
  if (!url) throw new Error("set LUNARNAV_MCP_URL to a running `lunarnav mcp --http PORT` (for example http://127.0.0.1:8765/mcp)");
  shared ??= connectLunarnav({ url });
  return shared;
}

export default class LunarnavBacktestProvider {
  private mode: "tools" | "baseline";

  constructor(options: { id?: string; config?: { mode?: "tools" | "baseline" } }) {
    this.mode = options.config?.mode ?? "tools";
  }

  id(): string {
    return `lunarnav-${this.mode}`;
  }

  async callApi(_prompt: string, context: { vars: Record<string, any> }) {
    const v = context.vars;
    try {
      const { review, ledgerIds, steps } = await reviewSite({
        lat: Number(v.lat),
        lon: Number(v.lon),
        landingUtc: String(v.landing_utc),
        landerId: String(v.lander),
        launchVehicleId: String(v.launch_vehicle_id),
        noTools: this.mode === "baseline",
        blindExclude: this.mode === "tools" ? String(v.mission_id) : undefined,
        connection: this.mode === "tools" ? await connection() : undefined,
      });
      return { output: JSON.stringify(review), metadata: { ledgerIds: ledgerIds.length, steps } };
    } catch (err) {
      return { error: String(err) };
    }
  }
}
