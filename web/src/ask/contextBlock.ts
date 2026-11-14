import { formatLat, formatLon } from "../lib/coords";
import type { SavedRef } from "../scenario/draft";
import type { Scenario } from "../scenario/types";
import type { ScreenContext } from "./screenContext";

const MAX_PROMPT_CHARS = 50_000;
const MAX_BLOCK_CHARS = 4_000;
const MAX_LINE_CHARS = 300;

const CONTEXT_OPEN = "--- Screen context (added by the interface: inputs only, no results) ---";
const CONTEXT_CLOSE = "--- End of screen context ---";

interface ScenarioInWork {
  doc: Scenario;
  saved: SavedRef | null;
  dirty: boolean;
}

export type ScenarioReach = "stored" | "edited" | "unsaved";

export function scenarioReach(s: Pick<ScenarioInWork, "saved" | "dirty">): ScenarioReach {
  if (!s.saved) return "unsaved";
  return s.dirty ? "edited" : "stored";
}

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

function scenarioLines(s: ScenarioInWork): string[] {
  const { doc, saved } = s;
  const site = doc.site;
  const siteName = oneLine(site.name || site.catalog_id || "unnamed site");
  const out = [
    `Plan in work: "${oneLine(doc.name)}"`,
    `Site: ${siteName}${site.catalog_id ? ` (catalogue id ${site.catalog_id})` : ""}, ${formatLat(site.lat_deg, 4)} ${formatLon(site.lon_deg, 4)}`,
    `Landing time: ${doc.landing_utc}`,
  ];
  switch (scenarioReach(s)) {
    case "stored":
      out.push(`Stored: yes, as saved plan id ${saved!.id}, version ${saved!.version}, with no unsaved edits. To use it, call load_saved_scenario with scenario_id "${saved!.id}".`);
      break;
    case "edited":
      out.push(
        `Stored: as saved plan id ${saved!.id}, version ${saved!.version}, but the planner has UNSAVED EDITS. You cannot see them: load_saved_scenario would give the stored version, which differs from what the planner sees. The site and landing time above are the edited values. Say so before relying on the stored copy.`,
      );
      break;
    case "unsaved":
      out.push("Stored: no, this plan was never saved, so you cannot load it. The site and landing time above are all you know of it; ask for anything else you need.");
      break;
  }
  return out;
}

export function buildContextBlock(screen: ScreenContext | null, scenario: ScenarioInWork | null): string | null {
  if (!screen && !scenario) return null;
  const lines: string[] = [];
  if (screen) {
    lines.push(`The planner is looking at: ${oneLine(screen.where)}${screen.summary ? ` · ${oneLine(screen.summary)}` : ""}`);
    for (const l of screen.lines) {
      const t = oneLine(l);
      if (t) lines.push(`- ${clip(t, MAX_LINE_CHARS)}`);
    }
  }
  const tail = scenario ? scenarioLines(scenario) : ["No plan is in work."];
  const wrap = (body: string[]) => [CONTEXT_OPEN, ...body, ...tail, CONTEXT_CLOSE].join("\n");
  let keep = lines.length;
  let text = wrap(lines);
  while (text.length > MAX_BLOCK_CHARS && keep > 1) {
    keep -= 1;
    text = wrap([...lines.slice(0, keep), "- (further lines of the view left out to keep this short)"]);
  }
  return clip(text, MAX_BLOCK_CHARS);
}

export function withContext(question: string, block: string | null): string {
  return block ? `${question.trimEnd()}\n\n${block}` : question;
}

export function questionRoom(blockChars: number): number {
  return MAX_PROMPT_CHARS - (blockChars > 0 ? blockChars + 2 : 0);
}

export function splitContext(prompt: string): { question: string; context: string | null } {
  const at = prompt.lastIndexOf(CONTEXT_OPEN);
  if (at < 0 || !prompt.trimEnd().endsWith(CONTEXT_CLOSE)) return { question: prompt, context: null };
  return { question: prompt.slice(0, at).trimEnd(), context: prompt.slice(at).trimEnd() };
}
