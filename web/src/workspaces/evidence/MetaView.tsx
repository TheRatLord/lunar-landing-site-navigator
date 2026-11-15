import { metaApi } from "../../api/endpoints";
import { useLoad, type Loaded } from "../../api/useLoad";
import { ServiceNotice } from "../../components/ServiceNotice";
import { Disclosure } from "../../components/ui/Disclosure";
import { Spinner } from "../../components/ui/Progress";

type Obj = Record<string, unknown>;

interface Store {
  id: string;
  pixel: number;
  sigma: number | null;
  basis: string | null;
  lat: number | null;
  lon: number | null;
}

interface Kernel {
  name: string;
  role: string;
  url: string | null;
}

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const numOr = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const dateText = (iso: string) => DATE.format(new Date(iso));

const px = (m: number) => `${m >= 100 ? Math.round(m) : Number(m.toFixed(m < 10 ? 1 : 0))} m`;

function stores(meta: Obj): Store[] {
  const list = Array.isArray(meta["terrain_stores"]) ? meta["terrain_stores"] : [];
  return list.filter(isObj).flatMap((s) => {
    const id = str(s["dem_id"]);
    const pixel = numOr(s["pixel_size_m"]);
    if (!id || pixel === null) return [];
    const cov = isObj(s["coverage"]) ? s["coverage"] : {};
    return [{ id, pixel, sigma: numOr(s["sigma_z_m"]), basis: str(s["error_basis_z"]), lat: numOr(cov["centre_lat_deg"]), lon: numOr(cov["centre_lon_deg"]) }];
  });
}

function kernels(meta: Obj): { files: Kernel[]; valid: [string, string] | null } {
  const k = isObj(meta["kernels"]) ? meta["kernels"] : {};
  const files = (Array.isArray(k["files"]) ? k["files"] : []).filter(isObj).flatMap((f) => {
    const name = str(f["name"]);
    return name ? [{ name, role: str(f["role"]) ?? "", url: str(f["url"]) }] : [];
  });
  const v = k["valid_utc"];
  const valid = Array.isArray(v) && typeof v[0] === "string" && typeof v[1] === "string" ? ([v[0], v[1]] as [string, string]) : null;
  return { files, valid };
}

const TILE = /^pgda78_(.+)_5m$/;
const POLAR = /^lola_(\d\d)(\d)?([ns])_\d+m$/;
const WINDOW = /^(sldem2015|ldem)_512_/;

function tileName(t: string): string {
  const site = /^site(\d+)(.*)$/.exec(t);
  if (site) return `Site ${site[1]}${site[2]}`;
  return t.length <= 3 ? t.toUpperCase() : t.charAt(0).toUpperCase() + t.slice(1);
}

const coord = (lat: number, lon: number) => {
  const e = ((lon + 540) % 360) - 180;
  return `${Math.abs(lat).toFixed(2)}°${lat < 0 ? "S" : "N"} ${Math.abs(e).toFixed(2)}°${e < 0 ? "W" : "E"}`;
};

function modelName(s: Store): string {
  const tile = TILE.exec(s.id);
  if (tile) return `PGDA ${tileName(tile[1]!)}`;
  const polar = POLAR.exec(s.id);
  if (polar) return `LOLA ${polar[1]}${polar[2] ? "." + polar[2] : ""}°${polar[3]!.toUpperCase()}`;
  const win = WINDOW.exec(s.id);
  if (win) return `${win[1] === "sldem2015" ? "SLDEM2015" : "LOLA"} window${s.lat !== null && s.lon !== null ? " at " + coord(s.lat, s.lon) : ""}`;
  if (s.id.startsWith("lola_global")) return "LOLA global";
  return s.id;
}

function family(s: Store): string {
  if (TILE.test(s.id)) return "NASA PGDA site models, south pole";
  if (POLAR.test(s.id)) return "LOLA polar grids, both poles";
  if (WINDOW.test(s.id)) return "Regional windows (SLDEM2015, LOLA)";
  return "LOLA global";
}

function span(values: number[], fmt: (v: number) => string): string {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return fmt(lo) === fmt(hi) ? fmt(lo) : `${fmt(lo).replace(/ m$/, "")} to ${fmt(hi)}`;
}

const sigmaText = (v: number) => `${v.toFixed(2)} m`;

function Versions({ meta }: { meta: Obj }) {
  const version = str(meta["code_version"]);
  const terrain = stores(meta);
  const { files, valid } = kernels(meta);
  const ephem = files.find((f) => /^de\d+\.bsp$/i.test(f.name))?.name.replace(/\.bsp$/i, "").toUpperCase();
  const families = [...Map.groupBy(terrain, family)];
  return (
    <div className="evi-versions">
      <dl className="evi-versions-rows">
        {version && (
          <div>
            <dt>Version</dt>
            <dd className="num">{version}</dd>
          </div>
        )}
        {files.length > 0 && (
          <div>
            <dt>Ephemeris</dt>
            <dd>
              <p>
                NASA JPL {ephem ?? "SPICE"}
                {valid && `, valid ${dateText(valid[0])} to ${dateText(valid[1])}`}
              </p>
              <Disclosure title="SPICE kernels" count={files.length}>
                <ul className="evi-versions-list">
                  {files.map((f) => (
                    <li key={f.name}>
                      {f.url ? (
                        <a href={f.url} target="_blank" rel="noopener noreferrer" className="mono">
                          {f.name}
                        </a>
                      ) : (
                        <span className="mono">{f.name}</span>
                      )}
                      <span className="faint">{f.role}</span>
                    </li>
                  ))}
                </ul>
              </Disclosure>
            </dd>
          </div>
        )}
        {terrain.length > 0 && (
          <div>
            <dt>Terrain</dt>
            <dd>
              <table className="evi-versions-table">
                <thead>
                  <tr>
                    <th scope="col">Height maps</th>
                    <th scope="col" className="num">
                      Count
                    </th>
                    <th scope="col" className="num">
                      Pixel
                    </th>
                    <th scope="col" className="num">
                      Height error (1σ)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {families.map(([name, group]) => {
                    const sig = group.flatMap((s) => (s.sigma === null ? [] : [s.sigma]));
                    return (
                      <tr key={name}>
                        <th scope="row">{name}</th>
                        <td className="num">{group.length}</td>
                        <td className="num">{span(group.map((s) => s.pixel), px)}</td>
                        <td className="num">{sig.length ? span(sig, sigmaText) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <Disclosure title="All height maps" count={terrain.length}>
                <table className="evi-versions-table">
                  <thead>
                    <tr>
                      <th scope="col">Height map</th>
                      <th scope="col" className="num">
                        Pixel
                      </th>
                      <th scope="col" className="num">
                        Height error
                      </th>
                      <th scope="col">Basis</th>
                    </tr>
                  </thead>
                  <tbody>
                    {terrain.map((s) => (
                      <tr key={s.id}>
                        <th scope="row">{modelName(s)}</th>
                        <td className="num">{px(s.pixel)}</td>
                        <td className="num">{s.sigma === null ? "—" : sigmaText(s.sigma)}</td>
                        <td>{s.basis?.replace(/-/g, " ") ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Disclosure>
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}

const loadMeta = (signal: AbortSignal) => metaApi.get({ signal });

export function LoadState({ state, loading, what, onRetry }: { state: Loaded<unknown>; loading: string; what: string; onRetry: () => void }) {
  if (state.status === "loading") {
    return (
      <div className="evi-loading">
        <Spinner size={14} label={loading} />
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="evi-notice">
        <ServiceNotice error={state.error} what={what} onRetry={onRetry} />
      </div>
    );
  }
  return null;
}

export function MetaView() {
  const { state, reload } = useLoad(loadMeta);
  if (state.status !== "ready") return <LoadState state={state} loading="Loading data versions" what="the data versions" onRetry={reload} />;
  return isObj(state.data) ? <Versions meta={state.data} /> : null;
}
