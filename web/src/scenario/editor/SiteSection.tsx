import { useId, useState } from "react";
import { Segmented } from "../../components/ui/Segmented";
import { polarForward, type Hemisphere } from "../../lib/projection";
import { useScenario } from "../store";
import { DraftInput, NumberField, Row, TextField } from "./controls";
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
  const [coordMode, setCoordMode] = useState<"geo" | "polar">("geo");
  if (!site) return null;
  const hemisphere: Hemisphere = site.lat_deg < 0 ? "south" : "north";

  const unlink = () => {
    const changes = unlinkChanges(site);
    if (changes.length > 0) editMany(changes);
  };

  return (
    <div className="sc-section">
      <div className="sc-group">
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
