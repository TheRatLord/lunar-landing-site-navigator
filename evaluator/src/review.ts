import { anthropic } from "@ai-sdk/anthropic";
import { generateText, isStepCount, Output, type ModelMessage } from "ai";
import { connectLunarnav, type Lunarnav } from "./mcp";
import { BASELINE, REVIEW_BOARD, requestText, STRUCTURE } from "./prompt";
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

export const MODEL = process.env.LUNARNAV_EVAL_MODEL ?? "claude-sonnet-5-5";
const MAX_STEPS = Number(process.env.LUNARNAV_EVAL_MAX_STEPS ?? 30);

function ledgerIdsIn(value: unknown): string[] {
  const text = JSON.stringify(value) ?? "";
  return [...new Set([...text.matchAll(/\\?"ledger_id\\?":\s*\\?"(L\d{4,})/g)].map((m) => m[1]))];
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

export async function reviewSite(input: ReviewInput): Promise<ReviewResult> {
  const model = anthropic(MODEL);
  const request = requestText({ ...input, missionHours: input.missionHours ?? 336 });
  if (input.noTools) {
    const res = await generateText({ model, system: BASELINE, prompt: request, output: Output.object({ schema: ReviewSchema }) });
    return { review: res.output, ledgerIds: [], steps: 0 };
  }
  const own = !input.connection;
  const lunar = input.connection ?? (await connectLunarnav({ blindExclude: input.blindExclude, url: input.url }));
  try {
    if (input.connection && input.blindExclude !== undefined) await lunar.setBlind(input.blindExclude ?? null);
    await lunar.recordRequest(request);
    const first: ModelMessage[] = [{ role: "user", content: request }];
    const loop = await generateText({ model, system: REVIEW_BOARD, messages: first, tools: lunar.tools, stopWhen: isStepCount(MAX_STEPS) });
    const ledgerIds = ledgerIdsIn(loop.steps.map((s) => s.toolResults));
    const final = await generateText({
      model,
      system: REVIEW_BOARD,
      messages: [...first, ...loop.response.messages, { role: "user", content: STRUCTURE }],
      output: Output.object({ schema: ReviewSchema }),
    });
    checkEvidence(final.output, ledgerIds);
    return { review: final.output, ledgerIds, steps: loop.steps.length };
  } finally {
    if (own) await lunar.close();
  }
}
