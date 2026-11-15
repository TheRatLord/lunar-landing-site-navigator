import { useCallback, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useLoad } from "../../api/useLoad";
import { Button } from "../../components/ui/Button";
import { Disclosure } from "../../components/ui/Disclosure";
import { Icon } from "../../components/ui/Icon";
import { formatLat, formatLon, parseLatLon } from "../../lib/coords";
import { fuzzyScore } from "../../lib/fuzzy";
import { useAlternatives, useOverlays } from "../../scenario/alternatives";
import { catalogApi } from "../../scenario/api";
import { useEditorUi } from "../../scenario/editor/editorUi";
import { SiteSection } from "../../scenario/editor/SiteSection";
import { FEATURED_SITES } from "../../scenario/starter";
import { movePlanSite, useScenario } from "../../scenario/store";
import { HomeMap, type MapFocus } from "../../workspaces/home/HomeMap";
import { AreaControl } from "./Widen";

interface PlanSite {
  lat_deg: number;
  lon_deg: number;
  name: string;
  catalog_id: string | null;
}

interface Option {
  key: string;
  title: string;
  note: string;
  site: PlanSite;
}

const MAX_RESULTS = 40;
const loadSites = (signal: AbortSignal) => catalogApi.sites({ limit: 1000 }, { signal });
const coords = (lat: number, lon: number) => `${formatLat(lat, 2)} ${formatLon(lon, 2)}`;
const round5 = (v: number): number => Math.round(v * 1e5) / 1e5;
const noop = () => undefined;

export function SitePicker() {
  const site = useScenario((s) => s.doc?.site);
  const pins = useAlternatives((s) => s.items);
  const openField = useEditorUi((s) => s.openField);
  const setPicking = useOverlays((s) => s.setPicking);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const sitesLoad = useLoad(loadSites);
  const sites = useMemo(() => (sitesLoad.state.status === "ready" ? sitesLoad.state.data.items : []), [sitesLoad.state]);
  const [query, setQuery] = useState("");
  const [focus] = useState<MapFocus>(() => ({ lat_deg: site?.lat_deg ?? -89.5, lon_deg: site?.lon_deg ?? 0, nonce: 0 }));

  const featured = useMemo<Option[]>(() => {
    const byId = new Map(sites.map((s) => [s.id, s]));
    return FEATURED_SITES.flatMap((f) => {
      const s = byId.get(f.id);
      return s ? [{ key: s.id, title: f.name, note: f.note, site: { lat_deg: s.lat_deg, lon_deg: s.lon_deg, name: f.name, catalog_id: s.id } }] : [];
    });
  }, [sites]);

  const matches = useMemo<Option[]>(() => {
    const q = query.trim();
    if (q === "") return [];
    const out: Option[] = [];
    const point = parseLatLon(q);
    if (point.ok) out.push({ key: "point", title: `Use ${coords(point.lat, point.lon)}`, note: "Typed coordinates", site: { lat_deg: point.lat, lon_deg: point.lon, name: "Custom point", catalog_id: null } });
    const scored = sites
      .map((s) => ({ s, score: Math.max(fuzzyScore(q, s.name), fuzzyScore(q, s.mission ?? "")) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RESULTS);
    for (const { s } of scored) out.push({ key: s.id, title: s.name, note: coords(s.lat_deg, s.lon_deg), site: { lat_deg: s.lat_deg, lon_deg: s.lon_deg, name: s.name, catalog_id: s.id } });
    return out;
  }, [sites, query]);

  const pinned = useMemo<Option[]>(
    () => pins.map((p) => ({ key: `pin:${p.id}`, title: p.name, note: coords(p.lat_deg, p.lon_deg), site: { lat_deg: p.lat_deg, lon_deg: p.lon_deg, name: p.name, catalog_id: p.catalog_id } })),
    [pins],
  );

  const choose = useCallback(
    (next: PlanSite) => {
      movePlanSite(next);
      openField(null);
    },
    [openField],
  );
  const pickCatalogSite = useCallback(
    (id: string) => {
      const s = sites.find((x) => x.id === id);
      if (s) movePlanSite({ lat_deg: s.lat_deg, lon_deg: s.lon_deg, name: s.name, catalog_id: s.id });
    },
    [sites],
  );
  const setPoint = useCallback((la: number, lo: number) => movePlanSite({ lat_deg: round5(la), lon_deg: round5(lo), name: "Map point", catalog_id: null }), []);
  const pinMarks = useMemo(() => pins.map((p) => ({ id: p.id, name: p.name, lat_deg: p.lat_deg, lon_deg: p.lon_deg })), [pins]);

  if (!site) return null;
  const current = site.catalog_id ?? null;
  const searching = query.trim() !== "";
  const openFullMap = () => {
    openField(null);
    if (!pathname.startsWith("/explore")) {
      setPicking(true);
      navigate("/explore");
    }
  };

  const pinnedKeys = new Set(pins.map((p) => p.catalog_id ?? `${p.lat_deg},${p.lon_deg}`));
  const list = (options: Option[]) => (
    <ul className="plan-list">
      {options.map((o) => {
        const on = o.site.catalog_id !== null ? o.site.catalog_id === current : current === null && o.site.lat_deg === site.lat_deg && o.site.lon_deg === site.lon_deg;
        const isPinned = pinnedKeys.has(o.site.catalog_id ?? `${o.site.lat_deg},${o.site.lon_deg}`);
        return (
          <li key={o.key}>
            <button type="button" className="plan-option" aria-current={on ? "true" : undefined} onClick={() => choose(o.site)}>
              <span className="plan-option-mark">{on ? <Icon name="check" size={14} /> : isPinned ? <Icon name="pin" size={14} /> : null}</span>
              <span className="plan-option-text plan-option-stack">
                <strong>{o.title}</strong>
                <span>{isPinned ? `Pinned to compare · ${o.note}` : o.note}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
  const pinnedIds = new Set(pinned.map((o) => o.site.catalog_id).filter(Boolean));
  const suggestions = [...pinned, ...featured.filter((o) => !pinnedIds.has(o.site.catalog_id))];

  return (
    <div className="plan-site">
      <div className="plan-site-list">
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            const first = matches[0];
            if (first) choose(first.site);
          }}
        >
          <div className="plan-search">
            <Icon name="search" size={14} />
            <input
              autoFocus
              value={query}
              placeholder="Search sites and missions, or type lat, lon"
              aria-label="Search sites and missions, or type latitude, longitude"
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </form>
        <div className="plan-site-scroll">
          {searching ? (
            matches.length > 0 ? (
              list(matches)
            ) : (
              <p className="plan-empty">No site matches “{query.trim()}”. Click the map to place a point instead.</p>
            )
          ) : (
            <>
              {list(suggestions)}
              {sitesLoad.state.status === "loading" && <p className="plan-empty">Loading sites</p>}
            </>
          )}
        </div>
        <AreaControl />
        <Disclosure title="Exact coordinates and name">
          <SiteSection />
        </Disclosure>
      </div>
      <div className="plan-site-map">
        <HomeMap site={{ lat_deg: site.lat_deg, lon_deg: site.lon_deg, name: site.name ?? "" }} focus={focus} sites={sites} pinned={pinMarks} onPickSite={pickCatalogSite} onSetPoint={setPoint} onStand={noop} hint="Click the map to move the site" />
        <Button size="sm" icon="expand" className="plan-site-full" onClick={openFullMap}>
          Full map
        </Button>
      </div>
    </div>
  );
}
