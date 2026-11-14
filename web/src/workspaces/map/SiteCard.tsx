import { Button, IconButton } from "../../components/ui/Button";
import { Disclosure } from "../../components/ui/Disclosure";
import { formatLat, formatLon } from "../../lib/coords";
import type { SiteEntry } from "../../scenario/api";
import { KindGlyph } from "./KindGlyph";
import { KIND_STYLE } from "./sites";

interface SiteCardProps {
  site: SiteEntry;
  canUse: boolean;
  isUsed: boolean;
  isAlternative: boolean;
  onUse(): void;
  onAddAlternative(): void;
  onFly(): void;
  onClose(): void;
}

function safeHref(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

export function SiteCard({ site, canUse, isUsed, isAlternative, onUse, onAddAlternative, onFly, onClose }: SiteCardProps) {
  const rows: Array<[string, string]> = [
    ["Kind", KIND_STYLE[site.kind].label],
    ["Confidence", site.confidence],
    ["Status", site.status],
    ["Mission", site.mission],
    ["Operator", [site.operator, site.country].filter(Boolean).join(", ")],
    ["Landing", site.landing_utc ?? site.landing_date ?? ""],
    ["Planned", site.planned_date],
    ["Extent", site.extent_km ? `${site.extent_km} km` : ""],
  ];
  const extra = (site.frame_note ? 1 : 0) + (site.notes ? 1 : 0) + site.sources.length;
  return (
    <section className="map-card" aria-labelledby="map-card-title">
      <header className="map-card-head">
        <KindGlyph kind={site.kind} hollow={site.confidence !== "high"} size={16} />
        <h2 id="map-card-title" className="map-card-title">
          {site.name}
        </h2>
        <IconButton icon="close" label="Close" shortcut="Esc" size="sm" onClick={onClose} />
      </header>
      <dl className="map-kv">
        <div>
          <dt>Position</dt>
          <dd className="num">
            {formatLat(site.lat_deg, 5)} {formatLon(site.lon_deg, 5)}
          </dd>
        </div>
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
      </dl>
      {extra > 0 && (
        <Disclosure title="Sources" count={site.sources.length}>
          <div className="map-card-more">
            {site.frame_note && <p className="map-prose">{site.frame_note}</p>}
            {site.notes && <p className="map-prose">{site.notes}</p>}
            {site.sources.length > 0 && (
              <ul className="map-notes">
                {site.sources.map((src) => {
                  const href = safeHref(src.url);
                  const label = src.title || src.url;
                  return (
                    <li key={`${src.url}|${src.locator}`}>
                      {href ? (
                        <a href={href} target="_blank" rel="noreferrer noopener">
                          {label}
                        </a>
                      ) : (
                        label
                      )}
                      {src.locator ? <span className="faint"> · {src.locator}</span> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Disclosure>
      )}
      <div className="map-card-actions">
        <Button size="sm" variant="primary" icon="site" disabled={!canUse || isUsed} onClick={onUse}>
          {isUsed ? "Plan site" : "Use as plan site"}
        </Button>
        <Button size="sm" icon={isAlternative ? "check" : "plus"} disabled={isAlternative} onClick={onAddAlternative}>
          {isAlternative ? "In Compare" : "Add to Compare"}
        </Button>
        <IconButton icon="target" label="Zoom to site" size="sm" onClick={onFly} />
      </div>
    </section>
  );
}
