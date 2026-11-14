import { readFileSync } from "node:fs";
import path from "node:path";

type Case = {
  mission_id: string;
  lat: number;
  lon: number;
  landing_utc: string;
  lander: string;
  launch_vehicle_id: string;
  outcome: string;
  expected: Record<string, "flag" | "clear">;
  terrain_resolution_m: number | null;
  group: "fine" | "coarse";
};

const ASSERT = `
const review = JSON.parse(output);
const expected = context.vars.expected;
const misses = [];
for (const [criterion, want] of Object.entries(expected)) {
  const got = review.criteria[criterion]?.rating;
  if (want === "flag" && got !== "caution" && got !== "no-go") misses.push(criterion + ": wanted flag, got " + got);
  if (want === "clear" && got === "no-go") misses.push(criterion + ": wanted clear, got no-go");
}
return { pass: misses.length === 0, score: misses.length === 0 ? 1 : 0, reason: misses.join("; ") || "all expectations met" };
`;

export default function tests() {
  const cases: Case[] = JSON.parse(readFileSync(path.join(import.meta.dir, "cases.json"), "utf8"));
  return cases.map((c) => ({
    description: `${c.mission_id} (${c.outcome}, ${c.group})`,
    vars: { ...c, expected: c.expected },
    metadata: { mission_id: c.mission_id, group: c.group, outcome: c.outcome },
    assert: [{ type: "javascript", value: ASSERT }],
  }));
}
