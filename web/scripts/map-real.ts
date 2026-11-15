import type { BrowserContext, Locator, Page } from "playwright";
import { buildScenario } from "../src/scenario/editor/newScenario";

export const STUDY_NAME = "Shackleton rim study";
export const ALTERNATIVES = [
  { id: "artemis-region-haworth", name: "Haworth rim", lat_deg: -86.77, lon_deg: -22.62, catalog_id: "artemis-region-haworth" },
  { id: "custom-1", name: "Map point", lat_deg: -88.9, lon_deg: 140.0, catalog_id: null },
];

export async function getJson<T>(base: string, p: string): Promise<T> {
  const res = await fetch(new URL("/api/v1", base).href + p);
  if (!res.ok) throw new Error(`${p}: ${res.status}`);
  return (await res.json()) as T;
}

export async function buildStudyDoc(base: string) {
  const sites = await getJson<{ items: Array<{ id: string; name: string; lat_deg: number; lon_deg: number }> }>(base, "/sites?limit=500");
  const site = sites.items.find((s) => s.id === "artemis-region-peak-near-shackleton");
  if (!site) throw new Error("catalogue has no artemis-region-peak-near-shackleton");
  const profiles = await getJson<{ profiles: Array<{ id: string; profile: never }> }>(base, "/profiles");
  const prof = profiles.profiles.find((p) => p.id === "peregrine-polar") ?? profiles.profiles[0]!;
  const constraints = (await getJson<{ presets: Array<{ name: string; constraints: never }> }>(base, "/constraints/presets")).presets.find((c) => c.name === "viper-polar")?.constraints;
  const network = (await getJson<{ presets: Array<{ id: string; network: never }> }>(base, "/networks/presets")).presets.find((n) => n.id === "dsn-all")?.network;
  const doc = buildScenario({ name: STUDY_NAME, site, landing_utc: "2027-03-14T12:00:00Z", mission_duration_h: 336, profile: prof.profile, constraints, network });
  return { ...doc, ellipse: { semi_major_m: 1500, semi_minor_m: 600, azimuth_deg: 40, dispersion: "gaussian", sigma_level: 3 } };
}

export async function seedStudy(ctx: BrowserContext, theme: string, doc: unknown): Promise<void> {
  await ctx.addInitScript(
    ([t, d, alts]) => {
      localStorage.setItem("lunarnav.theme", t as string);
      localStorage.setItem("lunarnav.scenario.draft", JSON.stringify({ doc: d, saved: null, baseline: null }));
      localStorage.setItem("lunarnav.alternatives", JSON.stringify(alts));
    },
    [theme, doc, ALTERNATIVES] as const,
  );
}

async function settle(what: string, ok: Locator, failed: Locator): Promise<void> {
  await ok.or(failed).first().waitFor({ timeout: 900_000 });
  if ((await ok.count()) === 0) throw new Error(`${what} failed: ${await failed.first().innerText()}`);
}

export async function runRealSearch(page: Page, base: string): Promise<void> {
  await page.goto(`${base}/map?radius=0.3`);
  await page.locator("canvas.map-canvas").waitFor();
  const find = page.getByRole("button", { name: /^Find sites.* km/ });
  await find.waitFor({ timeout: 60_000 });
  await find.click();
  const results = page.getByRole("complementary", { name: "Results" });
  await settle("search", results.getByRole("list", { name: "Sites found" }).or(results.locator(".se-none")), results.locator(".se-error"));
  await page.waitForTimeout(400);
}
