import { useMemo, useRef, useState } from "react";
import { Icon } from "../../components/ui/Icon";
import { PopoverPanel } from "../../components/ui/Popover";
import { formatLat, formatLon, parseLatLon } from "../../lib/coords";
import { fuzzyScore } from "../../lib/fuzzy";
import type { SiteEntry } from "../../scenario/api";
import { FEATURED_SITES } from "../../scenario/starter";
import type { SurveySite } from "./survey";

interface SitePickerProps {
  site: SurveySite;
  sites: SiteEntry[];
  onPick(site: SurveySite): void;
}

interface Option {
  key: string;
  title: string;
  note: string;
  site: SurveySite;
}

const MAX_RESULTS = 30;

const coords = (lat: number, lon: number) => `${formatLat(lat, 2)} ${formatLon(lon, 2)}`;

export function SitePicker({ site, sites, onPick }: SitePickerProps) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const options = useMemo<Option[]>(() => {
    const byId = new Map(sites.map((s) => [s.id, s]));
    const q = query.trim();
    if (q === "") {
      return FEATURED_SITES.flatMap((f) => {
        const s = byId.get(f.id);
        return s ? [{ key: s.id, title: f.name, note: f.note, site: { lat_deg: s.lat_deg, lon_deg: s.lon_deg, name: f.name, catalog_id: s.id } }] : [];
      });
    }
    const out: Option[] = [];
    const point = parseLatLon(q);
    if (point.ok) {
      out.push({ key: "point", title: `Use ${coords(point.lat, point.lon)}`, note: "Custom coordinates", site: { lat_deg: point.lat, lon_deg: point.lon, name: "Custom point", catalog_id: null } });
    }
    const scored = sites
      .map((s) => ({ s, score: Math.max(fuzzyScore(q, s.name), fuzzyScore(q, s.mission ?? "")) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RESULTS);
    for (const { s } of scored) {
      out.push({ key: s.id, title: s.name, note: coords(s.lat_deg, s.lon_deg), site: { lat_deg: s.lat_deg, lon_deg: s.lon_deg, name: s.name, catalog_id: s.id } });
    }
    return out;
  }, [sites, query]);

  const close = () => {
    setOpen(false);
    setQuery("");
  };
  const choose = (o: Option) => {
    close();
    onPick(o.site);
  };

  return (
    <>
      <button ref={anchor} type="button" className="home-site" aria-haspopup="dialog" aria-expanded={open} onClick={() => (open ? close() : setOpen(true))}>
        <Icon name="pin" size={16} />
        <span className="home-site-text">
          <strong>{site.name || "Unnamed site"}</strong>
          <span className="num">{coords(site.lat_deg, site.lon_deg)}</span>
        </span>
        <Icon name="chevronDown" size={12} />
      </button>
      <PopoverPanel open={open} anchor={anchor} onClose={close} label="Choose a landing site" width={380} className="home-site-pop">
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            const first = options[0];
            if (first) choose(first);
          }}
        >
          <input
            className="home-site-input"
            autoFocus
            value={query}
            placeholder="Search missions and sites, or type lat, lon"
            aria-label="Search missions and sites, or type latitude, longitude"
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
          />
        </form>
        <p className="home-site-group">{query.trim() === "" ? "Suggested sites" : `${options.length} match${options.length === 1 ? "" : "es"}`}</p>
        <ul className="home-site-list">
          {options.map((o) => (
            <li key={o.key}>
              <button type="button" onClick={() => choose(o)}>
                <strong>{o.title}</strong>
                <span>{o.note}</span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverPanel>
    </>
  );
}
