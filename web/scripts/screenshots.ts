// Usage: bun scripts/screenshots.ts [base] [mode]
//   (no mode)   shell + gallery scratch shots in docs/screenshots-scratch/ (git-ignored)
//   pages       the curated page shots, both themes, seeded study, in docs/screenshots/
//   map-curated the two curated south-pole Map shots (real search + regional layer), in docs/screenshots/
import { mkdirSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";
import { buildStudyDoc, runRealPreviews, seedStudy } from "./map-real";

const BASE = process.argv[2] ?? "http://127.0.0.1:5173";
const MODE = process.argv[3] ?? "scratch";
const SCRATCH = new URL("../docs/screenshots-scratch/", import.meta.url).pathname;
const CURATED = new URL("../docs/screenshots/", import.meta.url).pathname;
const THEMES = ["dark", "light"] as const;
type Theme = (typeof THEMES)[number];
interface Size {
  width: number;
  height: number;
}
const SIZE_1440: Size = { width: 1440, height: 900 };
const SIZES: Size[] = [SIZE_1440, { width: 1920, height: 1080 }];
const SECTIONS = [
  "buttons",
  "selectors",
  "inputs",
  "verdicts",
  "popover",
  "progress",
  "overlays",
  "layout",
  "empty-table",
  "icons",
  "tokens",
  "panorama",
  "timeline",
  "countdown",
  "constraints",
  "calendar",
  "stress",
];

interface PageShot {
  name: string;
  path: string;
  keys?: string;
  wait?: number;
}
const PAGE_SHOTS: PageShot[] = [
  { name: "overview", path: "/overview", wait: 6000 },
  { name: "explore-map", path: "/explore", wait: 4000 },
  { name: "explore-find", path: "/explore/find" },
  { name: "explore-regional", path: "/explore/regional" },
  { name: "site", path: "/site", wait: 9000 },
  { name: "site-accuracy", path: "/site/accuracy", wait: 4000 },
  { name: "dates", path: "/dates", wait: 4000 },
  { name: "compare", path: "/compare", wait: 4000 },
  { name: "evidence", path: "/evidence", wait: 3000 },
  { name: "palette", path: "/explore", keys: "Control+k", wait: 1500 },
  { name: "scenario-drawer", path: "/site", keys: "Alt+e", wait: 5000 },
  { name: "ask", path: "/site", keys: "Alt+a", wait: 5000 },
];

// The UI tolerates this one failing (assistant instructions are optional).
const TOLERATED_URL = /\/api\/v1\/agent\/instructions/;

const errors: string[] = [];

/** One isolated browser context at `size` in `theme`, with console/page errors collected under `label`. */
async function withContext(browser: Browser, theme: Theme, size: Size, label: string, seed: unknown | null, fn: (open: () => Promise<Page>) => Promise<void>): Promise<void> {
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1, reducedMotion: "reduce" });
  if (seed) await seedStudy(ctx, theme, seed);
  else await ctx.addInitScript((t) => localStorage.setItem("lunarnav.theme", t), theme);
  const open = async (): Promise<Page> => {
    const page = await ctx.newPage();
    page.on("console", (m) => {
      if (m.type() !== "error" || TOLERATED_URL.test(m.location().url)) return;
      errors.push(`${label}: ${m.text()}`);
    });
    page.on("pageerror", (e) => errors.push(`${label}: ${e.message}`));
    return page;
  };
  try {
    await fn(open);
  } finally {
    await ctx.close();
  }
}

async function fontsReady(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
}

async function scratch(browser: Browser): Promise<void> {
  mkdirSync(SCRATCH, { recursive: true });
  for (const theme of THEMES) {
    for (const size of SIZES) {
      const label = `${theme} ${size.width}`;
      await withContext(browser, theme, size, label, null, async (open) => {
        const page = await open();
        const prefix = `${SCRATCH}${theme}-${size.width}x${size.height}`;

        await page.goto(`${BASE}/explore`);
        await fontsReady(page);
        await page.waitForTimeout(400);
        await page.screenshot({ path: `${prefix}-shell-map.png` });
        await page.keyboard.press("Control+k");
        await page.waitForSelector('[role="dialog"]');
        await page.keyboard.type("dates");
        await page.screenshot({ path: `${prefix}-shell-palette.png` });
        await page.keyboard.press("Enter");
        await page.waitForURL("**/dates");

        await page.goto(`${BASE}/dev/gallery`);
        await fontsReady(page);
        await page.waitForTimeout(1200);
        await page.screenshot({ path: `${prefix}-gallery-top.png` });
        for (const name of SECTIONS) {
          const el = page.locator(`[data-gallery="${name}"]`);
          await el.scrollIntoViewIfNeeded();
          await page.waitForTimeout(200);
          await el.screenshot({ path: `${prefix}-gallery-${name}.png` });
        }
      });
    }
  }
  console.log("screenshots written to", SCRATCH);
}

async function pages(browser: Browser): Promise<void> {
  mkdirSync(CURATED, { recursive: true });
  const doc = await buildStudyDoc(BASE);
  for (const theme of THEMES) {
    await withContext(browser, theme, SIZE_1440, theme, doc, async (open) => {
      for (const shot of PAGE_SHOTS) {
        const page = await open();
        await page.goto(`${BASE}${shot.path}`);
        await fontsReady(page);
        await page.waitForTimeout(shot.wait ?? 2500);
        if (shot.keys) {
          await page.keyboard.press(shot.keys);
          await page.waitForTimeout(1200);
        }
        await page.screenshot({ path: `${CURATED}${shot.name}-${theme}.png` });
        await page.close();
      }
    });
  }
  console.log("page screenshots written to", CURATED);
}

async function mapCurated(browser: Browser): Promise<void> {
  mkdirSync(CURATED, { recursive: true });
  const doc = await buildStudyDoc(BASE);
  for (const theme of THEMES) {
    await withContext(browser, theme, SIZE_1440, theme, doc, async (open) => {
      const page = await open();
      await runRealPreviews(page, BASE);
      await page.getByRole("button", { name: "Fit site" }).click();
      await fontsReady(page);
      await page.waitForFunction(() => document.querySelector<HTMLCanvasElement>("canvas.map-canvas")?.dataset["tilesLoading"] === "0", undefined, { timeout: 30_000 });
      await page.waitForTimeout(900);
      const box = (await page.locator("canvas.map-canvas").boundingBox())!;
      await page.mouse.move(box.x + 24, box.y + box.height - 24);
      await page.waitForTimeout(300);
      const body = await page.locator("body").innerText();
      if (/E2E/.test(body)) errors.push(`${theme}: the page shows an "E2E" name`);
      if ((await page.getByRole("link", { name: /Components/ }).count()) > 0) errors.push(`${theme}: the nav has a dev-only Components entry`);
      if (/not yet validated/i.test(body)) errors.push(`${theme}: the page says "not yet validated"`);
      await page.screenshot({ path: `${CURATED}map-south-preview-overlays-${theme}.png` });

      await page.getByRole("tab", { name: "Sites", exact: true }).click();
      await page.getByRole("list", { name: "Matching sites" }).getByRole("button", { name: /Peak near Shackleton/i }).first().click();
      await page.waitForTimeout(1000);
      await page.mouse.move(box.x + 24, box.y + box.height - 24);
      await page.waitForTimeout(300);
      if (/E2E/.test(await page.locator("body").innerText())) errors.push(`${theme}: the site card page shows an "E2E" name`);
      await page.screenshot({ path: `${CURATED}map-south-site-card-${theme}.png` });
    });
  }
  console.log("curated Map screenshots written to", CURATED);
}

const modes: Record<string, (b: Browser) => Promise<void>> = { scratch, pages, "map-curated": mapCurated };
const run = modes[MODE];
if (!run) {
  console.error(`unknown mode "${MODE}"; expected one of: ${Object.keys(modes).join(", ")}`);
  process.exit(2);
}
const browser = await chromium.launch();
await run(browser);
await browser.close();
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
