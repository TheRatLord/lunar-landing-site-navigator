import { useMemo, useRef, useState } from "react";
import { useLoad } from "../../api/useLoad";
import { Button } from "../../components/ui/Button";
import { Icon } from "../../components/ui/Icon";
import { PopoverPanel } from "../../components/ui/Popover";
import { formatLat, formatLon, parseLatLon } from "../../lib/coords";
import { fuzzyScore } from "../../lib/fuzzy";
import { useAlternatives, type Candidate } from "../../scenario/alternatives";
import { catalogApi } from "../../scenario/api";
import { FEATURED_SITES } from "../../scenario/starter";
import { useSearchResults } from "../search/results";
import { sameSite, siteName, type SiteRef } from "./gridModel";

const MAX_RESULTS = 8;
const TOP_RESULTS = 3;
const loadSites = (signal: AbortSignal) => catalogApi.sites({ limit: 1000 }, { signal });
const coords = (lat: number, lon: number) => `${formatLat(lat, 2)} ${formatLon(lon, 2)}`;
const pointId = (lat: number, lon: number) => `pt-${lat.toFixed(5)}_${lon.toFixed(5)}`;

interface Option {
  key: string;
  title: string;
  note: string;
  site: Candidate;
}

function useTopResults(): Candidate[] {
  const candidates = useSearchResults((s) => s.candidates);
  const stale = useSearchResults((s) => s.stale);
  return useMemo(() => {
    if (stale || !Array.isArray(candidates)) return [];
    return [...candidates]
      .filter((r) => Number.isFinite(r?.lat_deg) && Number.isFinite(r?.lon_deg))
      .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
      .slice(0, TOP_RESULTS)
      .map((r) => ({ id: `search-${r.lat_deg.toFixed(5)}_${r.lon_deg.toFixed(5)}`, name: coords(r.lat_deg, r.lon_deg), lat_deg: r.lat_deg, lon_deg: r.lon_deg, catalog_id: null }));
  }, [candidates, stale]);
}

export function AddSite({ present }: { present: readonly SiteRef[] }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button ref={trigger} size="sm" icon="plus" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
        Add site
      </Button>
      <PopoverPanel open={open} anchor={trigger} onClose={() => setOpen(false)} label="Add site" width={320} className="cmp-add-pop">
        <SiteSearch present={present} />
      </PopoverPanel>
    </>
  );
}

function SiteSearch({ present }: { present: readonly SiteRef[] }) {
  const add = useAlternatives((s) => s.add);
  const sitesLoad = useLoad(loadSites);
  const sites = useMemo(() => (sitesLoad.state.status === "ready" ? sitesLoad.state.data.items : []), [sitesLoad.state]);
  const [query, setQuery] = useState("");
  const top = useTopResults();
  const isPresent = (c: Candidate) => present.some((p) => sameSite(p, c));
  const freshTop = top.filter((c) => !isPresent(c));

  const options = useMemo<Option[]>(() => {
    const q = query.trim();
    const fromCatalog = (s: (typeof sites)[number], title = siteName(s.name)): Option => ({
      key: s.id,
      title,
      note: coords(s.lat_deg, s.lon_deg),
      site: { id: s.id, name: title, lat_deg: s.lat_deg, lon_deg: s.lon_deg, catalog_id: s.id },
    });
    if (q === "") {
      const byId = new Map(sites.map((s) => [s.id, s]));
      return FEATURED_SITES.flatMap((f) => {
        const s = byId.get(f.id);
        return s ? [fromCatalog(s, f.name)] : [];
      });
    }
    const out: Option[] = [];
    const point = parseLatLon(q);
    if (point.ok) {
      const name = coords(point.lat, point.lon);
      out.push({ key: "point", title: name, note: "Typed coordinates", site: { id: pointId(point.lat, point.lon), name, lat_deg: point.lat, lon_deg: point.lon, catalog_id: null } });
    }
    const scored = sites
      .map((s) => ({ s, score: Math.max(fuzzyScore(q, s.name), fuzzyScore(q, s.mission ?? "")) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RESULTS);
    for (const { s } of scored) out.push(fromCatalog(s));
    return out;
  }, [sites, query]);

  return (
    <div className="cmp-add">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          const first = options.find((o) => !isPresent(o.site));
          if (query.trim() !== "" && first) add(first.site);
        }}
      >
        <div className="cmp-add-search">
          <Icon name="search" size={14} />
          <input
            autoFocus
            className="cmp-add-input"
            value={query}
            placeholder="Site or lat, lon"
            aria-label="Site, or latitude and longitude"
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </form>
      {freshTop.length > 0 && query.trim() === "" && (
        <button type="button" className="cmp-add-opt cmp-add-top" onClick={() => freshTop.forEach(add)}>
          <Icon name="plus" size={14} />
          <span className="cmp-add-text">
            <strong>{freshTop.length === 1 ? "Add the top site from Find sites" : `Add top ${freshTop.length} from Find sites`}</strong>
          </span>
        </button>
      )}
      <ul className="cmp-add-list">
        {options.map((o) => {
          const there = isPresent(o.site);
          return (
            <li key={o.key}>
              <button type="button" className="cmp-add-opt" disabled={there} onClick={() => add(o.site)}>
                <Icon name={there ? "check" : "plus"} size={14} />
                <span className="cmp-add-text">
                  <strong>{o.title}</strong>
                  <span className="num">{o.note}</span>
                </span>
              </button>
            </li>
          );
        })}
        {query.trim() !== "" && options.length === 0 && <li className="cmp-add-none">No site matches</li>}
        {sitesLoad.state.status === "loading" && <li className="cmp-add-none">Loading sites</li>}
      </ul>
    </div>
  );
}
