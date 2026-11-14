import type { BrowserContext, Page } from "playwright";
import type { RegionalResult } from "../src/api/regional";
import type { SearchResult } from "../src/api/search";
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
  const doc = buildScenario({ name: STUDY_NAME, site, landing_utc: "2027-03-14T12:00:00Z", mission_duration_h: 336, profile: prof.profile });
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

export interface RealResults {
  search: SearchResult | null;
  regional: RegionalResult | null;
}

export function captureResults(page: Page): RealResults {
  const got: RealResults = { search: null, regional: null };
  page.on("response", async (r) => {
    if (!/\/jobs\/[^/]+\/result$|\/analyses\/(search|regional)$/.test(r.url())) return;
    const j: unknown = await r.json().catch(() => null);
    if (typeof j !== "object" || j === null || !("kind" in j)) return;
    if (j.kind === "search") got.search = j as SearchResult;
    if (j.kind === "regional") got.regional = j as RegionalResult;
  });
  return got;
}

export function expectedCells(result: RegionalResult, layer: string): { cells: number; unreliable: number } {
  const values = result.inline[layer];
  const flags = result.inline["censoring_flags"];
  let cells = 0;
  let unreliable = 0;
  values?.forEach((row, r) =>
    row.forEach((v, c) => {
      if (v === null || !Number.isFinite(v)) return;
      cells++;
      if (((flags?.[r]?.[c] ?? 0) & 8) !== 0) unreliable++;
    }),
  );
  return { cells, unreliable };
}

async function done(page: Page, what: string): Promise<void> {
  await page.waitForTimeout(700);
  const ok = page.locator(".an-status:has(.an-dot-ok)");
  await ok.or(page.getByRole("alert")).first().waitFor({ timeout: 290_000 });
  if ((await ok.count()) === 0) throw new Error(`${what} failed: ${await page.getByRole("alert").first().innerText()}`);
}

async function openAdvanced(page: Page): Promise<void> {
  const toggle = page.getByRole("button", { name: "Advanced", exact: true });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
}

export async function runRealPreviews(page: Page, base: string): Promise<void> {
  await page.goto(`${base}/explore/find`);
  await page.getByRole("button", { name: /^Search( region)?$/ }).waitFor();
  await page.getByLabel("Radius (m)").fill("300");
  await openAdvanced(page);
  await page.getByLabel("Final spacing (m)").fill("50");
  await page.getByLabel("Sites to rank").fill("8");
  await page.getByRole("button", { name: /^Search( region)?$/ }).click();
  await done(page, "search");

  await page.getByRole("tab", { name: "Regional", exact: true }).click();
  await page.getByRole("button", { name: "Compute", exact: true }).waitFor();
  await page.getByLabel("Period end (UTC)").fill("2027-04-13 12:00");
  await page.getByLabel("Period end (UTC)").press("Enter");
  await page.getByLabel("Side", { exact: true }).fill("2000");
  await page.getByLabel("Cell spacing", { exact: true }).fill("50");
  await page.getByLabel("Metric", { exact: true }).selectOption("longest_shadow_h");
  await openAdvanced(page);
  await page.getByLabel("Time step").selectOption({ label: "6 h" });
  await page.getByLabel("Pass limit", { exact: true }).fill("0.3");
  await page.getByRole("button", { name: "Compute", exact: true }).click();
  await done(page, "regional layer");
  await page.waitForTimeout(400);

  await page.getByRole("tab", { name: "Map", exact: true }).click();
  await page.waitForURL(/\/explore(\?|$)/);
  await page.locator("canvas.map-canvas").waitFor();
}
