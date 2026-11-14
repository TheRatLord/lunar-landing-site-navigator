import { useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { IconButton } from "../../components/ui/Button";
import { Icon } from "../../components/ui/Icon";
import { Segmented } from "../../components/ui/Segmented";
import { formatLat, formatLon } from "../../lib/coords";
import { polarForward, type Hemisphere } from "../../lib/projection";
import { catalogApi, type SiteEntry } from "../api";
import { useOverlays } from "../alternatives";
import { useScenario } from "../store";
import { DraftInput, NumberField, Row, TextField } from "./controls";
import { errorText, useField, useSearch } from "./fieldState";
import { useEditorUi } from "./editorUi";
import { polarInverse } from "./polar";

const MOVED = " (moved)";

type Changes = Array<[ReadonlyArray<string | number>, unknown]>;
type SiteLink = { name?: string | null; catalog_id?: string | null };

function unlinkChanges(site: SiteLink): Changes {
  if (!site.catalog_id) return [];
  const name = site.name ?? "";
  return [
    [["site", "catalog_id"], undefined],
    [["site", "name"], name === "" || name.endsWith(MOVED) ? name : name + MOVED],
  ];
}

export function SiteSection() {
  const site = useScenario((s) => s.doc?.site);
  const editMany = useScenario((s) => s.editMany);
  const navigate = useNavigate();
  const openField = useEditorUi((s) => s.openField);
  const setPicking = useOverlays((s) => s.setPicking);
  const [coordMode, setCoordMode] = useState<"geo" | "polar">("geo");
  if (!site) return null;
  const hemisphere: Hemisphere = site.lat_deg < 0 ? "south" : "north";

  const pick = () => {
    setPicking(true);
    openField(null);
    navigate("/explore");
  };
  const unlink = () => {
    const changes = unlinkChanges(site);
    if (changes.length > 0) editMany(changes);
  };

  return (
    <div className="sc-section">
      <div className="sc-group">
        <CatalogueSearch moved={!site.catalog_id && (site.name ?? "").endsWith(MOVED)} />
        <TextField path={["site", "name"]} label="Name" placeholder="Site name" />
      </div>
      <div className="sc-group">
        <div className="sc-toolrow">
          <Segmented
            label="Coordinate system"
            size="sm"
            value={coordMode}
            onChange={(v) => setCoordMode(v === "polar" ? "polar" : "geo")}
            options={[
              { value: "geo", label: "Lat / lon" },
              { value: "polar", label: `Polar ${hemisphere === "south" ? "S" : "N"}` },
            ]}
          />
          <IconButton icon="map" label="Pick on map" size="sm" onClick={pick} />
        </div>
        {coordMode === "geo" ? (
          <>
            <NumberField path={["site", "lat_deg"]} label="Latitude" unit="° N" min={-90} max={90} step={0.01} onCommit={unlink} />
            <NumberField path={["site", "lon_deg"]} label="Longitude" unit="° E" min={-180} max={360} step={0.01} onCommit={unlink} />
          </>
        ) : (
          <PolarFields hemisphere={hemisphere} lat={site.lat_deg} lon={site.lon_deg} onMove={(lat, lon) => editMany([[["site", "lat_deg"], lat], [["site", "lon_deg"], lon], ...unlinkChanges(site)])} />
        )}
      </div>
    </div>
  );
}

function PolarFields({ hemisphere, lat, lon, onMove }: { hemisphere: Hemisphere; lat: number; lon: number; onMove: (lat: number, lon: number) => void }) {
  const xy = polarForward(hemisphere, lat, lon);
  return (
    <>
      <PlainNumber label="x (east)" unit="m" value={xy.x_m} onCommit={(x) => onMove(...latLon(polarInverse(hemisphere, x, xy.y_m)))} />
      <PlainNumber label="y" unit="m" value={xy.y_m} onCommit={(y) => onMove(...latLon(polarInverse(hemisphere, xy.x_m, y)))} />
    </>
  );
}

const latLon = (p: { lat_deg: number; lon_deg: number }): [number, number] => [Number(p.lat_deg.toFixed(6)), Number(p.lon_deg.toFixed(6))];

function PlainNumber({ label, unit, value, onCommit }: { label: string; unit: string; value: number; onCommit: (v: number) => void }) {
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const commit = (text: string) => {
    const n = Number(text.trim().replace(/,/g, "."));
    if (!Number.isFinite(n)) return setError(`“${text}” is not a number.`);
    setError(null);
    if (n !== value) onCommit(n);
  };
  return (
    <Row label={label} htmlFor={id} error={error}>
      <DraftInput id={id} unit={unit} external={String(Number(value.toFixed(2)))} error={error} commit={commit} inputMode="decimal" />
    </Row>
  );
}

const searchSites = (q: string, signal: AbortSignal) => (q ? catalogApi.sites({ q, limit: 12 }, { signal }) : null);

function CatalogueSearch({ moved }: { moved: boolean }) {
  const id = useId();
  const listId = `${id}-list`;
  const edit = useScenario((s) => s.edit);
  const current = useField<string | null>(["site", "catalog_id"]).value;
  const [query, setQuery] = useState("");
  const state = useSearch(query, searchSites);
  const [seen, setSeen] = useState(state);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  if (seen !== state) {
    setSeen(state);
    setActive(0);
  }

  const results = state?.q === query.trim() ? state : null;
  const items = results?.value?.items ?? [];

  const choose = (s: SiteEntry) => {
    edit(["site"], { lat_deg: s.lat_deg, lon_deg: s.lon_deg, name: s.name, catalog_id: s.id });
    setOpen(false);
    setQuery("");
  };

  const key = (e: React.KeyboardEvent) => {
    if (!items.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      const s = items[active];
      if (s) {
        e.preventDefault();
        choose(s);
      }
    } else if (e.key === "Escape") setOpen(false);
  };

  return (
    <div className="sc-catalogue" ref={boxRef}>
      <Row label="Catalogue" htmlFor={id}>
        <div className="sc-tagfield">
          {current ? (
            <span className="chip sc-linked">
              <span className="num">{current}</span>
              <button type="button" className="sc-chip-x" aria-label={`Unlink ${current}`} onClick={() => edit(["site", "catalog_id"], undefined)}>
                <Icon name="close" size={10} />
              </button>
            </span>
          ) : (
            moved && (
              <span className="chip chip-marginal">
                <Icon name="pin" size={12} /> Moved
              </span>
            )
          )}
          <input
            id={id}
            className="sc-tagfield-input"
            role="combobox"
            aria-expanded={open && Boolean(results)}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-label="Search the landing-site catalogue"
            placeholder="Search sites"
            value={query}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={(e) => !boxRef.current?.contains(e.relatedTarget) && setOpen(false)}
            onKeyDown={key}
          />
          <Icon name="search" size={14} />
        </div>
      </Row>
      {open && query.trim() && (
        <ul id={listId} className="sc-results" role="listbox" aria-label="Catalogue sites">
          {!results && <li className="sc-result-empty">…</li>}
          {results && results.error !== null && <li className="sc-result-empty sc-bad">{errorText(results.error)}</li>}
          {results && results.error === null && items.length === 0 && <li className="sc-result-empty">No matching site</li>}
          {items.map((s, i) => (
            <li key={s.id} role="option" aria-selected={i === active} className={i === active ? "active" : ""} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(s)}>
              <span className="sc-result-name">{s.name}</span>
              <span className="chip">{s.kind}</span>
              {s.extent_kind && <span className="chip">{s.extent_kind}</span>}
              <span className="sc-result-pos num">
                {formatLat(s.lat_deg, 2)} {formatLon(s.lon_deg, 2)}
              </span>
              <span className="sc-conf">{s.confidence}</span>
            </li>
          ))}
          {results?.value && results.value.total > items.length && <li className="sc-result-empty num">+{results.value.total - items.length}</li>}
        </ul>
      )}
    </div>
  );
}
