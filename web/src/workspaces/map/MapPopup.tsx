import { useLayoutEffect, useRef, type ReactNode } from "react";
import { Button, IconButton } from "../../components/ui/Button";
import { Disclosure } from "../../components/ui/Disclosure";
import { parseUtc } from "../../lib/time";
import type { SiteEntry } from "../../scenario/api";
import type { MapEngine } from "./engine";
import { KindGlyph } from "./KindGlyph";
import { KIND_STYLE } from "./sites";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dayText(text: string | null | undefined): string | null {
  if (!text) return null;
  const ms = parseUtc(text);
  if (ms === null) return text;
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function safeHref(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

interface MapPopupProps {
  engine: MapEngine | null;
  lat: number;
  lon: number;
  title: ReactNode;
  icon?: ReactNode;
  onClose(): void;
  children?: ReactNode;
}

export function MapPopup({ engine, lat, lon, title, icon, onClose, children }: MapPopupProps) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!engine) return;
    const place = () => {
      const el = ref.current;
      const parent = el?.parentElement;
      if (!el || !parent) return;
      const p = engine.screenOf(lat, lon);
      if (!p) {
        el.style.visibility = "hidden";
        return;
      }
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const below = p.y - h - 22 < 56;
      const x = Math.min(Math.max(p.x - w / 2, 8), parent.clientWidth - w - 8);
      const y = below ? p.y + 18 : p.y - h - 18;
      el.style.visibility = "visible";
      el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    };
    place();
    return engine.onFrame(place);
  }, [engine, lat, lon]);

  return (
    <section ref={ref} className="map-popup" aria-label="Selected place" style={{ visibility: "hidden" }}>
      <header className="map-popup-head">
        {icon}
        <h2 className="map-popup-title">{title}</h2>
        <IconButton icon="close" label="Close" shortcut="Esc" size="sm" onClick={onClose} />
      </header>
      {children}
    </section>
  );
}

interface PlaceActionsProps {
  isPlan: boolean;
  inCompare: boolean;
  onUse(): void;
  onCompare(): void;
}

export function PlaceActions({ isPlan, inCompare, onUse, onCompare }: PlaceActionsProps) {
  return (
    <div className="map-popup-actions">
      <Button size="sm" variant="primary" icon="site" disabled={isPlan} onClick={onUse}>
        {isPlan ? "Plan site" : "Use as plan site"}
      </Button>
      <Button size="sm" icon={inCompare ? "check" : "plus"} disabled={inCompare} onClick={onCompare}>
        {inCompare ? "In Compare" : "Add to Compare"}
      </Button>
    </div>
  );
}

export function siteFacts(site: SiteEntry): string {
  const kind = KIND_STYLE[site.kind].label;
  const when = dayText(site.landing_utc ?? site.landing_date) ?? dayText(site.planned_date);
  return [site.confidence === "high" ? kind : `${kind} · ${site.confidence} confidence`, when, site.mission && site.kind !== "poi" && site.kind !== "region" && !site.name.includes(site.mission) ? site.mission : null].filter(Boolean).join(" · ");
}

export function SiteTitleIcon({ site }: { site: SiteEntry }) {
  return <KindGlyph kind={site.kind} hollow={site.confidence !== "high"} size={16} />;
}

export function SiteSources({ site }: { site: SiteEntry }) {
  if (site.sources.length === 0 && !site.notes) return null;
  return (
    <Disclosure title="Sources">
      <ul className="map-notes">
        {site.notes && <li>{site.notes}</li>}
        {site.sources.map((src) => {
          const href = safeHref(src.url);
          const label = src.title || src.url;
          return <li key={`${src.url}|${src.locator}`}>{href ? <a href={href} target="_blank" rel="noreferrer noopener">{label}</a> : label}</li>;
        })}
      </ul>
    </Disclosure>
  );
}
