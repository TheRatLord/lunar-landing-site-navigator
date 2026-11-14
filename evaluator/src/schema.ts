import { z } from "zod";

export const CRITERIA = [
  "slope_tipover",
  "illumination_power",
  "earth_link",
  "ellipse_hazards",
  "terrain_navigation",
  "thermal",
  "launch_slip",
  "past_failures",
] as const;
export type Criterion = (typeof CRITERIA)[number];

export const RATINGS = ["go", "caution", "no-go", "unresolved"] as const;
export type Rating = (typeof RATINGS)[number];

const CriterionReview = z.object({
  rating: z.enum(RATINGS),
  finding: z.string().describe("One or two sentences; every number must come from a tool result."),
  evidence: z.array(z.string()).describe("Ledger ids (L0001 style) of the tool results the finding uses."),
});

export const ReviewSchema = z.object({
  criteria: z.object(Object.fromEntries(CRITERIA.map((c) => [c, CriterionReview])) as Record<Criterion, typeof CriterionReview>),
  overall: z.enum(RATINGS),
  topRisks: z.array(z.object({ risk: z.string(), echoes: z.array(z.string()).describe("Past mission ids this risk resembles.") })),
});
export type Review = z.infer<typeof ReviewSchema>;
