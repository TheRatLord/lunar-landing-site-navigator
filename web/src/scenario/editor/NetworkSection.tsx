import { useState } from "react";
import { IconButton } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { Icon } from "../../components/ui/Icon";
import { catalogApi, type StationEntry } from "../api";
import { useScenario } from "../store";
import type { NetworkStation } from "../types";
import { ChoiceField, GroupHead, NumberField, OriginMark, TextField } from "./controls";
import { USER_ORIGIN, errorText, useSearch } from "./fieldState";
import { STATION_FIELDS } from "./fieldSpecs";
import { PresetBar } from "./PresetBar";

function fromCatalogue(s: StationEntry): NetworkStation {
  return {
    id: s.id,
    name: s.name,
    network: s.network,
    lat_deg: s.lat_deg,
    lon_deg: s.lon_deg,
    alt_m: s.alt_m,
    alt_basis: s.alt_basis,
    rx_mask_deg: s.min_elevation_deg,
    tx_mask_deg: s.min_elevation_deg,
    g_over_t_dbk: null,
    origin: {
      basis: "published",
      label: s.min_elevation_source || "Catalogue elevation mask",
      source_url: s.sources[0]?.url ?? null,
      note: `The catalogue lists one mask; it is used for both receive and transmit. Edit it if your stations distinguish them. Station altitude: ${s.alt_basis}.`,
    },
  };
}

function NetworkHead() {
  const edit = useScenario((s) => s.edit);
  return (
    <div className="sc-group">
      <TextField path={["network", "label"]} label="Label" placeholder="e.g. DSN 34 m" />
      <ChoiceField
        path={["network", "direction"]}
        label="Direction"
        options={[
          { value: "downlink", label: "Downlink" },
          { value: "uplink", label: "Uplink" },
          { value: "two_way", label: "Two-way" },
        ]}
      />
      <PresetBar
        label="Station set"
        what="Station sets"
        options={(data) =>
          data.networks.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} ({p.station_ids.length})
            </option>
          ))
        }
        onApply={(choice, data) => {
          const p = data.networks.find((x) => x.id === choice);
          if (p) edit(["network"], p.network);
        }}
      />
    </div>
  );
}

const searchStations = (q: string, signal: AbortSignal) => catalogApi.stations({ q: q || undefined, limit: 8 }, { signal });

function AddStation({ have }: { have: Set<string> }) {
  const edit = useScenario((s) => s.edit);
  const stations = useScenario((s) => s.doc?.network.stations ?? []);
  const [query, setQuery] = useState("");
  const state = useSearch(query, searchStations);
  const shown = state?.q === query.trim() ? state : null;
  const items = shown?.value?.items ?? [];
  return (
    <div className="sc-group">
      <GroupHead title="Add ground station" />
      <div className="sc-searchbox">
        <Icon name="search" size={14} />
        <input className="input" aria-label="Search ground stations" placeholder="Goldstone, Weilheim, DSS-43" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {shown && shown.error !== null && <p className="sc-msg" role="alert">{errorText(shown.error)}</p>}
      <ul className="sc-results static" aria-label="Station results">
        {items.map((s) => (
          <li key={s.id}>
            <span className="sc-result-name">{s.name}</span>
            <span className="chip">{s.network}</span>
            <span className="sc-result-pos num">{s.min_elevation_deg}°</span>
            {s.alt_basis !== "published" && (
              <span className="chip chip-marginal">
                <Icon name="warn" size={12} /> Altitude {s.alt_basis}
              </span>
            )}
            {have.has(s.id) ? (
              <span className="sc-added" role="img" aria-label="Added">
                <Icon name="check" size={14} />
              </span>
            ) : (
              <IconButton icon="plus" label={`Add ${s.name}`} size="sm" onClick={() => edit(["network", "stations"], [...stations, fromCatalogue(s)])} />
            )}
          </li>
        ))}
        {shown && items.length === 0 && shown.error === null && <li className="sc-result-empty">No matching station</li>}
      </ul>
    </div>
  );
}

export function NetworkSection() {
  const stations = useScenario((s) => s.doc?.network.stations ?? []);
  const edit = useScenario((s) => s.edit);
  const have = new Set(stations.map((s) => s.id));
  return (
    <div className="sc-section">
      <NetworkHead />
      <div className="sc-group">
        <GroupHead title="Ground stations">
          <span className="dim num">{stations.length}</span>
        </GroupHead>
        {stations.length === 0 ? (
          <EmptyState icon="antenna" title="No ground stations" />
        ) : (
          stations.map((s, i) => (
            <div key={`${s.id}-${i}`} className="sc-block">
              <div className="row">
                <span className="sc-station">
                  <b>{s.name || s.id}</b>
                  <span className="dim">{[s.network, s.id].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="grow" />
                <OriginMark origin={s.origin ?? USER_ORIGIN} />
                <IconButton icon="trash" label={`Remove ${s.name || s.id}`} size="sm" onClick={() => edit(["network", "stations"], stations.filter((_, k) => k !== i))} />
              </div>
              <div className="sc-fields3">
                {STATION_FIELDS.map((f) => (
                  <NumberField key={f.field} {...f} layout="stacked" path={["network", "stations", i, f.field]} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
      <AddStation have={have} />
    </div>
  );
}
