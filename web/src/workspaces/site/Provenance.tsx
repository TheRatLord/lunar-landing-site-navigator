import { useMemo, type ReactNode } from "react";
import type { EvaluateResult } from "../../api/site";
import { Pairs } from "../../components/ui/Pairs";
import { Popover } from "../../components/ui/Popover";
import { formatNum, formatValue, withUnit } from "../../lib/format";
import { formatUtc } from "../../lib/time";
import type { Scenario } from "../../scenario/types";
import {
  defaultStackIds,
  estimatesUsed,
  groundLabel,
  parseSec,
  provenanceRows,
  stackLabel,
  stackRows,
  storesReaching,
  terrainInfo,
  terrainState,
} from "./adapt";
import { useTerrainStores } from "./useTerrainStores";

function Row({ k, children, tone }: { k: string; children: ReactNode; tone?: "marginal" }) {
  return (
    <div className={`prov-dl-row${tone ? ` prov-${tone}` : ""}`}>
      <dt>{k}</dt>
      <dd className="num">{children}</dd>
    </div>
  );
}

export function EstimatesChip({ scenario }: { scenario: Scenario | null }) {
  const estimates = useMemo(() => (scenario ? estimatesUsed(scenario) : []), [scenario]);
  if (estimates.length === 0) return null;
  return (
    <Popover label={`${estimates.length} ${estimates.length === 1 ? "estimate" : "estimates"}`} icon="alert" tone="marginal" align="end" width={420}>
      <ul className="prov-list" aria-label="Plan inputs that are estimates">
        {estimates.map((e) => (
          <li key={e.path}>
            <div>
              <span className="chip chip-marginal">{e.basis}</span> <strong>{e.label}</strong>
            </div>
            <div className="faint num">{e.path}</div>
            {e.note && <div className="faint">{e.note}</div>}
            {e.source_url && (
              <a href={e.source_url} target="_blank" rel="noreferrer noopener" className="prov-link">
                {e.source_url}
              </a>
            )}
          </li>
        ))}
      </ul>
    </Popover>
  );
}

export function ProvenancePopover({ scenario, result }: { scenario: Scenario | null; result: EvaluateResult }) {
  const stores = useTerrainStores();
  const defaultIds = useMemo(() => defaultStackIds(stores), [stores]);
  const t = terrainInfo(result.provenance, result.provider, result.terrain_stack);
  const terrain = terrainState(result.provider);
  const label = stackLabel(t, defaultIds);
  const ground = groundLabel(t);
  const reaching = useMemo(() => (scenario ? storesReaching(t.stackIds, stores, scenario.site.lat_deg, scenario.site.lon_deg) : null), [t.stackIds, stores, scenario]);
  const rows = provenanceRows(result.provenance, result.scenario_sha256, result.terrain_stack);
  const landing = parseSec(result.landing.utc);
  const err = t.errorEnabled === false ? "off" : t.errorMode ? `${t.errorMode}${t.kSigma !== null ? `, k = ${formatNum(t.kSigma, 1)} σ` : ""}` : "not reported";
  const sigma = (s: { sigma_m: number; basis: string | null } | null) => (s ? `${formatValue(s.sigma_m, "m", 1)}${s.basis ? ` (${s.basis})` : ""}` : "not reported");
  const restricted = t.stackKind === "restricted";

  return (
    <Popover label="Provenance" icon="list" tone={restricted ? "marginal" : "default"} align="end" width={460}>
      <div className="prov">
        <section>
          <h3 className="prov-h">Evaluated</h3>
          <Pairs
            className="prov-dl"
            rows={[
              ["Landing", landing !== null ? formatUtc(landing) : "—"],
              ["Mission", formatValue(result.landing.mission_h ?? scenario?.mission_duration_h ?? NaN, "h", 1)],
            ]}
          />
        </section>

        <section>
          <h3 className="prov-h">Horizon model</h3>
          <dl className="prov-dl">
            <Row k="Model">
              {terrain.terrain ? "Terrain" : "Smooth sphere"} · {result.provider}
            </Row>
            <Row k="Site DEM">{t.demId ? `${t.demId}${t.pixelM !== null ? ` · ${withUnit(formatNum(t.pixelM, 1), "m/px")}` : ""}` : "none"}</Row>
            {label && (
              <Row k="Terrain stack" tone={restricted ? "marginal" : undefined}>
                {label}
              </Row>
            )}
            {label === null && t.demCount !== null && <Row k="DEMs in the stack">{t.demCount}</Row>}
            {ground && <Row k="Ground DEM">{ground}</Row>}
            {reaching && reaching.length > 1 && <Row k="DEMs reaching the site">{reaching.length}</Row>}
            <Row k="Error model">{err}</Row>
            <Row k="Vertical error σ_z">{sigma(t.vertical)}</Row>
            <Row k="Horizontal error σ_xy">{sigma(t.horizontal)}</Row>
          </dl>
          {reaching && reaching.length > 1 && <p className="faint num prov-reach">{reaching.join(", ")}</p>}
          {t.stackIds && t.stackIds.length > 0 && (
            <ol className="prov-list prov-stack" aria-label={`DEMs in the stack, ${t.stackIds.length}`}>
              {stackRows(t.stackIds, stores).map((r) => (
                <li key={r.demId}>
                  <span className="num">{r.demId}</span>
                  {r.detail && <span className="faint num"> · {r.detail}</span>}
                </li>
              ))}
            </ol>
          )}
        </section>

        {rows.length > 0 && (
          <section>
            <h3 className="prov-h">Hashes</h3>
            <Pairs
              className="prov-dl"
              rows={rows.map((r) => [
                r.label,
                <span key={r.label} title={r.value}>
                  {r.value.length > 20 ? `${r.value.slice(0, 16)}…${r.value.slice(-4)}` : r.value}
                </span>,
              ])}
            />
          </section>
        )}

        {result.warnings && result.warnings.length > 0 && (
          <section>
            <h3 className="prov-h">Engine warnings</h3>
            <ul className="prov-warn" aria-label="Engine warnings">
              {result.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Popover>
  );
}
