import { siteLabel } from "../../lib/siteName";
import { useId, useMemo, useState, type Ref } from "react";
import { Icon } from "../../components/ui/Icon";
import { parseLatLon } from "../../lib/coords";
import { fuzzyScore } from "../../lib/fuzzy";
import type { SiteEntry } from "../../scenario/api";
import { KindGlyph } from "./KindGlyph";
import { pointName } from "./siteMove";

type Option = { key: string; title: string; site: SiteEntry | null; lat: number; lon: number };

const MAX = 8;
const norm = (t: string): string => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

interface MapSearchProps {
  sites: readonly SiteEntry[];
  inputRef: Ref<HTMLInputElement>;
  onSite(site: SiteEntry): void;
  onPoint(lat: number, lon: number): void;
}

export function MapSearch({ sites, inputRef, onSite, onPoint }: MapSearchProps) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const options = useMemo<Option[]>(() => {
    const q = query.trim();
    if (!q) return [];
    const out: Option[] = [];
    const point = parseLatLon(q);
    if (point.ok) out.push({ key: "point", title: pointName(point.lat, point.lon), site: null, lat: point.lat, lon: point.lon });
    const nq = norm(q);
    const exact = sites
      .map((s) => ({ s, score: norm(s.name).startsWith(nq) ? 3 : norm(s.name).includes(nq) ? 2 : norm(s.mission ?? "").includes(nq) ? 1 : 0 }))
      .filter((x) => x.score > 0);
    const scored = (exact.length > 0 ? exact : sites.map((s) => ({ s, score: fuzzyScore(q, s.name) })).filter((x) => x.score > 0))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX);
    for (const { s } of scored) out.push({ key: s.id, title: siteLabel(s.name), site: s, lat: s.lat_deg, lon: s.lon_deg });
    return out;
  }, [query, sites]);

  const choose = (o: Option | undefined) => {
    if (!o) return;
    if (o.site) onSite(o.site);
    else onPoint(o.lat, o.lon);
    setOpen(false);
  };

  const showList = open && query.trim() !== "";
  return (
    <div className="map-goto" role="search">
      <Icon name="search" size={14} />
      <input
        ref={inputRef}
        className="map-goto-input"
        value={query}
        placeholder="Search sites or lat, lon"
        aria-label="Search sites, or type latitude, longitude"
        role="combobox"
        aria-expanded={showList}
        aria-controls={`${id}-list`}
        aria-activedescendant={showList && options[active] ? `${id}-${active}` : undefined}
        spellCheck={false}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setActive((a) => Math.min(options.length - 1, a + 1));
          else if (e.key === "ArrowUp") setActive((a) => Math.max(0, a - 1));
          else if (e.key === "Enter") choose(options[active]);
          else if (e.key === "Escape") {
            if (query) setQuery("");
            else (e.target as HTMLInputElement).blur();
          } else return;
          e.preventDefault();
          e.stopPropagation();
        }}
      />
      {showList && (
        <ul id={`${id}-list`} className="map-goto-list" role="listbox" aria-label="Matches">
          {options.length === 0 && <li className="map-goto-none">No site or coordinate matches</li>}
          {options.map((o, i) => (
            <li
              key={o.key}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === active}
              className="map-goto-option"
              onMouseDown={(e) => {
                e.preventDefault();
                choose(o);
              }}
              onMouseEnter={() => setActive(i)}
            >
              {o.site ? <KindGlyph kind={o.site.kind} hollow={o.site.confidence !== "high"} /> : <Icon name="pin" size={14} />}
              <span className="map-goto-name">{o.title}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
