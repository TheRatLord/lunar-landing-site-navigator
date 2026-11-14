import { connectLunarnav, type Lunarnav } from "../src/mcp";
import { mcpUrl, reviewSite } from "../src/review";

let shared: Promise<Lunarnav> | null = null;

function connection(): Promise<Lunarnav> {
  shared ??= connectLunarnav({ url: mcpUrl() });
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
    const tools = this.mode === "tools";
    let lunar: Lunarnav | undefined;
    try {
      lunar = tools ? await connection() : undefined;
      const { review, ledgerIds, steps } = await reviewSite({
        lat: Number(v.lat),
        lon: Number(v.lon),
        landingUtc: String(v.landing_utc),
        landerId: String(v.lander),
        launchVehicleId: String(v.launch_vehicle_id),
        noTools: !tools,
        blindExclude: tools ? String(v.mission_id) : undefined,
        connection: lunar,
      });
      return { output: JSON.stringify(review), metadata: { ledgerIds: ledgerIds.length, steps } };
    } catch (err) {
      if (tools && !lunar) shared = null;
      return { error: String(err) };
    } finally {
      if (lunar) await lunar.setBlind(null).catch(() => {});
    }
  }
}
