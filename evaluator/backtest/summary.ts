import { readFileSync } from "node:fs";

type Row = {
  provider?: { label?: string; id?: string };
  success: boolean;
  error?: string | null;
  response?: { output?: string };
  testCase?: { vars?: Record<string, any>; metadata?: Record<string, any> };
  vars?: Record<string, any>;
};

const file = process.argv[2] ?? "backtest/out.json";
const doc = JSON.parse(readFileSync(file, "utf8"));
const rows: Row[] = doc.results?.results ?? doc.results ?? [];

type Tally = { flagHit: number; flagTotal: number; falseAlarm: number; clearTotal: number; errors: number };
const tallies = new Map<string, Tally>();

for (const r of rows) {
  const label = r.provider?.label ?? r.provider?.id ?? "?";
  const vars = r.testCase?.vars ?? r.vars ?? {};
  const group = vars.group ?? "?";
  const key = `${label} / ${group}`;
  const t = tallies.get(key) ?? { flagHit: 0, flagTotal: 0, falseAlarm: 0, clearTotal: 0, errors: 0 };
  tallies.set(key, t);
  let review: any;
  try {
    review = JSON.parse(r.response?.output ?? "");
  } catch {
    t.errors++;
    continue;
  }
  for (const [criterion, want] of Object.entries(vars.expected ?? {})) {
    const got = review.criteria?.[criterion]?.rating;
    if (want === "flag") {
      t.flagTotal++;
      if (got === "caution" || got === "no-go") t.flagHit++;
    } else {
      t.clearTotal++;
      if (got === "no-go") t.falseAlarm++;
    }
  }
}

console.log("| Provider / terrain group | Site-related risks flagged | False no-go on clear criteria | Errors |");
console.log("|---|---|---|---|");
for (const [key, t] of [...tallies].sort()) {
  console.log(`| ${key} | ${t.flagHit}/${t.flagTotal} | ${t.falseAlarm}/${t.clearTotal} | ${t.errors} |`);
}
