import { parseArgs } from "node:util";
import { reviewSite } from "./review";
import { CRITERIA } from "./schema";

const argv = process.argv.slice(2);
const args = argv.flatMap((a, i) => (i > 0 && /^--(lat|lon)$/.test(argv[i - 1]) ? [] : /^--(lat|lon)$/.test(a) && i + 1 < argv.length ? [`${a}=${argv[i + 1]}`] : [a]));

const { values } = parseArgs({
  args,
  options: {
    lat: { type: "string" },
    lon: { type: "string" },
    date: { type: "string" },
    lander: { type: "string" },
    vehicle: { type: "string" },
    hours: { type: "string", default: "336" },
    url: { type: "string" },
    "no-tools": { type: "boolean", default: false },
  },
});

for (const k of ["lat", "lon", "date", "lander", "vehicle"] as const) {
  if (!values[k]) {
    console.error(`missing --${k}\nusage: bun run review --lat -85.29 --lon 36.3 --date 2027-01-15T12:00Z --lander griffin --vehicle falcon-heavy [--hours 336] [--url http://127.0.0.1:8765/mcp] [--no-tools]\nNeeds Claude Code logged in, and (without --no-tools) a running server: bash ~/wslfast.sh 'uv run lunarnav mcp --http 8765'`);
    process.exit(2);
  }
}

const { review, ledgerIds, steps } = await reviewSite({
  lat: Number(values.lat),
  lon: Number(values.lon),
  landingUtc: values.date!,
  landerId: values.lander!,
  launchVehicleId: values.vehicle!,
  missionHours: Number(values.hours),
  url: values.url,
  noTools: values["no-tools"],
});

const lines = [
  `# Site review: ${values.lat}, ${values.lon} at ${values.date}`,
  ``,
  `**Overall: ${review.overall}** (${steps} tool steps, ${ledgerIds.length} ledger results)`,
  ``,
  `| Criterion | Rating | Finding | Evidence |`,
  `|---|---|---|---|`,
  ...CRITERIA.map((c) => {
    const r = review.criteria[c];
    return `| ${c} | ${r.rating} | ${r.finding.replace(/\|/g, "/")} | ${r.evidence.join(", ")} |`;
  }),
  ``,
  `## Top risks`,
  ...review.topRisks.map((t) => `- ${t.risk}${t.echoes.length ? ` (echoes: ${t.echoes.join(", ")})` : ""}`),
];
console.log(lines.join("\n"));
