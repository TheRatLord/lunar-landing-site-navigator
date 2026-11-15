// Usage: bun scripts/screenshots.ts [base] [mode] [curated output directory]
//   (no mode)   shell + gallery scratch shots in docs/screenshots-scratch/ (git-ignored)
//   pages       the curated page shots, both themes, seeded study, in docs/screenshots/
//   map-curated the two curated south-pole Map shots (real site search, then a result pin), in docs/screenshots/
import { mkdirSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";
import { buildStudyDoc, runRealSearch, seedStudy } from "./map-real";

const BASE = process.argv[2] ?? "http://127.0.0.1:5173";
const MODE = process.argv[3] ?? "scratch";
const SCRATCH = new URL("../docs/screenshots-scratch/", import.meta.url).pathname;
const CURATED = process.argv[4] ? process.argv[4].replace(/\/?$/, "/") : new URL("../docs/screenshots/", import.meta.url).pathname;
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
  click?: string;
  shows?: string;
  wait?: number;
}
const PAGE_SHOTS: PageShot[] = [
  { name: "overview", path: "/overview", wait: 6000 },
  { name: "map", path: "/map", wait: 4000 },
  { name: "site", path: "/site", wait: 9000 },
  { name: "site-ellipse", path: "/site/ellipse", wait: 4000 },
  { name: "compare", path: "/compare", wait: 9000 },
  { name: "evidence", path: "/evidence", wait: 3000 },
  { name: "palette", path: "/map", keys: "Control+k", wait: 1500 },
  { name: "mission", path: "/mission", wait: 3000 },
  { name: "plan-site", path: "/overview", click: "#plan-site", wait: 4000 },
  { name: "plan-landing", path: "/overview", click: "#plan-time", wait: 4000 },
  { name: "plan-lander", path: "/overview", click: "#plan-lander", wait: 4000 },
  { name: "plan-requirements", path: "/overview", click: "#plan-constraints", wait: 4000 },
  { name: "ask", path: "/site", keys: "Alt+a", shows: "#ask-dock", wait: 5000 },
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

        await page.goto(`${BASE}/map`);
        await fontsReady(page);
        await page.waitForTimeout(400);
        await page.screenshot({ path: `${prefix}-shell-map.png` });
        await page.keyboard.press("Control+k");
        await page.waitForSelector('[role="dialog"]');
        await page.keyboard.type("compare");
        await page.screenshot({ path: `${prefix}-shell-palette.png` });
        await page.keyboard.press("Enter");
        await page.waitForURL("**/compare");

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
        if (shot.click) {
          await page.click(shot.click);
          await page.waitForTimeout(2500);
        }
        if (shot.shows && !(await page.locator(shot.shows).isVisible())) console.log(`${shot.name}-${theme}: ${shot.shows} not shown here, kept the old shot`);
        else await page.screenshot({ path: `${CURATED}${shot.name}-${theme}.png` });
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
      await runRealSearch(page, BASE);
      await page.getByRole("button", { name: "Zoom to plan site" }).click();
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
      await page.screenshot({ path: `${CURATED}map-south-results-${theme}.png` });

      const first = page.getByRole("list", { name: "Sites found" }).getByRole("button").first();
      if ((await first.count()) > 0) {
        await first.click();
        await page.waitForTimeout(1000);
        await page.mouse.move(box.x + 24, box.y + box.height - 24);
        await page.waitForTimeout(300);
        if (/E2E/.test(await page.locator("body").innerText())) errors.push(`${theme}: the result pin page shows an "E2E" name`);
        await page.screenshot({ path: `${CURATED}map-south-pin-${theme}.png` });
      }
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
