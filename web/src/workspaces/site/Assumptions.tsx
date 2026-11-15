import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { EvaluateResult } from "../../api/site";
import { Disclosure } from "../../components/ui/Disclosure";
import { Popover } from "../../components/ui/Popover";
import { formatNum, glueQuantities } from "../../lib/format";
import { BASIS_LABEL, type Scenario } from "../../scenario/types";
import { estimatesUsed, seamWarnings, terrainInfo } from "./adapt";

const NAMES: Record<string, string> = {
  "profile.array_height_m": "Solar array height",
  "profile.antenna_height_m": "Antenna height",
  "profile.antenna_height_max_m": "Antenna mast limit",
};

function estimateName(path: string, label: string): string {
  if (NAMES[path]) return NAMES[path]!;
  if (label && !/[._]/.test(label)) return label;
  const key = path.split(".").pop() ?? path;
  const words = key.replace(/_(m|deg|h|w|wh)$/i, "").replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const KEPT_CAVEATS = new Set(["terrain.polar_footprint", "terrain.crest_observer_height", "events.shallow_sun"]);

const UNITS: Array<[RegExp, string]> = [
  [/_wh$/i, "Wh"],
  [/_w$/i, "W"],
  [/_m$/i, "m"],
  [/_deg$/i, "°"],
  [/_h$/i, "h"],
];

function lookup(root: unknown, path: string[]): unknown {
  let v: unknown = root;
  for (const k of path) {
    if (v === null || typeof v !== "object") return undefined;
    v = (v as Record<string, unknown>)[k];
  }
  return v;
}

function estimateValue(scenario: Scenario, path: string): string {
  const parts = path.split(".");
  const key = parts[parts.length - 1] ?? "";
  if (parts[0] === "constraints") {
    const lim = lookup(scenario, parts) as { min?: number | null; max?: number | null; unit?: string } | undefined;
    if (!lim) return "";
    const u = lim.unit === "deg" ? "°" : lim.unit ? ` ${lim.unit}` : "";
    return typeof lim.min === "number" ? `≥ ${formatNum(lim.min, 2)}${u}` : typeof lim.max === "number" ? `≤ ${formatNum(lim.max, 2)}${u}` : "";
  }
  if (parts[0] !== "profile") return "";
  const v = lookup(scenario.profile, parts.slice(1));
  if (typeof v === "number") {
    const unit = UNITS.find(([re]) => re.test(key))?.[1] ?? "";
    if (/(efficiency|dod|soc)$/i.test(key) && v <= 1) return `${formatNum(v * 100, 0)} %`;
    return `${formatNum(v, Math.abs(v) >= 100 ? 0 : 2)}${unit ? (unit === "°" ? "°" : ` ${unit}`) : ""}`;
  }
  if (key === "loads" && v && typeof v === "object") {
    const l = v as { sunlit_w?: number; dark_w?: number };
    if (typeof l.sunlit_w === "number" && typeof l.dark_w === "number") return `${formatNum(l.sunlit_w, 0)} W day, ${formatNum(l.dark_w, 0)} W night`;
  }
  if (v === null || v === undefined) return key === "yaw_deg" ? "every heading tried" : "";
  if (Array.isArray(v)) return `${v.length} ${key.replace(/_/g, " ")}`;
  return "";
}

function caveatText(text: string): string {
  return glueQuantities(
    text
      .replace(/\bscenario's\b/gi, "plan's")
      .replace(/\bscenario\b/gi, "plan")
      .replace(/-(\d+(?:\.\d+)?)\s*deg latitude/g, "$1°S")
      .replace(/(\d+(?:\.\d+)?)\s*deg latitude/g, "$1°N")
      .replace(/(\d)\s*deg\b/g, "$1°"),
  );
}

export function Assumptions({ scenario, result }: { scenario: Scenario | null; result: EvaluateResult }) {
  const estimates = useMemo(() => (scenario ? estimatesUsed(scenario) : []), [scenario]);
  const caveats = useMemo(() => {
    const seen = new Set<string>();
    return (result.limits ?? []).filter((n) => {
      if (n.kind !== "model_limit" || !KEPT_CAVEATS.has(n.id)) return false;
      if (seen.has(n.title)) return false;
      seen.add(n.title);
      return true;
    });
  }, [result.limits]);
  const t = terrainInfo(result.provenance, result.provider, result.terrain_stack);
  const seam = seamWarnings(result.warnings).length > 0;
  const terrain = result.provider === "terrain";

  return (
    <Popover label="Assumptions" icon="info" align="end" width={400}>
      <div className="asm">
        {estimates.length > 0 && (
          <section>
            <h3 className="asm-h">Estimates</h3>
            <ul className="asm-list">
              {estimates.map((e) => (
                <li key={e.path}>
                  <span>{/disc flux/i.test(e.label) ? "Sunlit = half the Sun's disc visible" : estimateName(e.path, e.label)}</span>
                  <span className="num">{/disc flux/i.test(e.label) ? "" : (scenario && estimateValue(scenario, e.path)) || BASIS_LABEL[e.basis].toLowerCase()}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {caveats.length > 0 && (
          <section>
            <h3 className="asm-h">Model limits</h3>
            <div className="asm-caveats">
              {caveats.map((n) => (
                <Disclosure key={n.id} title={n.title}>
                  <p className="asm-text">{caveatText(n.text)}</p>
                </Disclosure>
              ))}
            </div>
          </section>
        )}
        <section>
          <h3 className="asm-h">Data</h3>
          <ul className="asm-list">
            <li>
              <span>Horizon</span>
              <span className="faint">{terrain ? `terrain${t.pixelM !== null ? `, ${formatNum(t.pixelM, 0)} m grid at the site` : ""}` : "smooth sphere, no terrain here"}</span>
            </li>
            {terrain && t.vertical && (
              <li>
                <span>Terrain height error</span>
                <span className="faint">± {formatNum(t.vertical.sigma_m, 1)} m</span>
              </li>
            )}
            {seam && (
              <li>
                <span>Terrain sources meet near the site</span>
                <span className="faint">the horizon may jump there</span>
              </li>
            )}
          </ul>
        </section>
        <Link to="/evidence" className="asm-link">
          How the model was checked
        </Link>
      </div>
    </Popover>
  );
}
