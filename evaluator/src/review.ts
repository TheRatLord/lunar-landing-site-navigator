import { z } from "zod";
import { runClaude } from "./claude";
import { connectLunarnav, type Lunarnav } from "./mcp";
import { loadPrompt, requestText } from "./prompt";
import { CRITERIA, ReviewSchema, type Review } from "./schema";

export type ReviewInput = {
  lat: number;
  lon: number;
  landingUtc: string;
  landerId: string;
  launchVehicleId: string;
  missionHours?: number;
  blindExclude?: string;
  noTools?: boolean;
  url?: string;
  connection?: Lunarnav;
};

export type ReviewResult = { review: Review; ledgerIds: string[]; steps: number };

export class InvalidReview extends Error {}

export const MODEL = process.env.LUNARNAV_EVAL_MODEL || "sonnet";
const MAX_STEPS = Number(process.env.LUNARNAV_EVAL_MAX_STEPS || 30);
export const DEFAULT_URL = "http://127.0.0.1:8765/mcp";

export function mcpUrl(url?: string): string {
  return url || process.env.LUNARNAV_MCP_URL || DEFAULT_URL;
}

export function checkEvidence(review: Review, ledgerIds: string[]): void {
  const known = new Set(ledgerIds);
  const bad: string[] = [];
  for (const c of CRITERIA) {
    const r = review.criteria[c];
    if (r.rating === "unresolved") continue;
    if (r.evidence.length === 0) bad.push(`${c}: no evidence`);
    for (const id of r.evidence) if (!known.has(id)) bad.push(`${c}: unknown ledger id ${id}`);
  }
  if (bad.length) throw new InvalidReview(`review cites missing evidence: ${bad.join("; ")}`);
}

function parseReview(value: unknown): Review {
  const parsed = ReviewSchema.safeParse(value);
  if (!parsed.success) throw new InvalidReview(`review does not match the schema: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

const SCHEMA = z.toJSONSchema(ReviewSchema);

export async function reviewSite(input: ReviewInput): Promise<ReviewResult> {
  const prompt = requestText({ ...input, missionHours: input.missionHours ?? 336 });
  const common = { schema: SCHEMA, model: MODEL, maxTurns: MAX_STEPS, prompt };
  if (input.noTools) {
    const run = await runClaude({ ...common, system: loadPrompt("baseline") });
    return { review: parseReview(run.structured), ledgerIds: [], steps: 0 };
  }
  const url = mcpUrl(input.url);
  const own = !input.connection;
  let lunar: Lunarnav;
  try {
    lunar = input.connection ?? (await connectLunarnav({ url }));
  } catch (err) {
    throw new Error(`cannot reach the lunarnav MCP server at ${url}; start it with: bash ~/wslfast.sh 'uv run lunarnav mcp --http 8765' (${err})`);
  }
  try {
    await lunar.setBlind(input.blindExclude ?? null);
    await lunar.recordRequest(prompt);
    const run = await runClaude({ ...common, system: loadPrompt("review-board"), mcpUrl: url });
    const review = parseReview(run.structured);
    checkEvidence(review, run.ledgerIds);
    return { review, ledgerIds: run.ledgerIds, steps: run.turns };
  } finally {
    if (own) await lunar.close();
  }
}
