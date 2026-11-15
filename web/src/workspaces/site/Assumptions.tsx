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

export function Assumptions({ scenario, result }: { scenario: Scenario | null; result: EvaluateResult }) {
  const estimates = useMemo(() => (scenario ? estimatesUsed(scenario) : []), [scenario]);
  const caveats = useMemo(() => {
    const seen = new Set<string>();
    return (result.limits ?? []).filter((n) => {
      if (n.kind !== "model_limit") return false;
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
            <h3 className="asm-h">Estimated inputs</h3>
            <ul className="asm-list">
              {estimates.map((e) => (
                <li key={e.path}>
                  <span>{estimateName(e.path, e.label)}</span>
                  <span className="faint">{BASIS_LABEL[e.basis].toLowerCase()}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {caveats.length > 0 && (
          <section>
            <h3 className="asm-h">Limits of the model for this plan</h3>
            <div className="asm-caveats">
              {caveats.map((n) => (
                <Disclosure key={n.id} title={n.title}>
                  <p className="asm-text">{glueQuantities(n.text)}</p>
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
