import { useMemo } from "react";
import type { ApiError } from "../../api/client";
import { ServiceNotice } from "../../components/ServiceNotice";
import { EmptyState } from "../../components/ui/EmptyState";
import { Select } from "../../components/ui/Fields";
import { Icon } from "../../components/ui/Icon";
import { Popover } from "../../components/ui/Popover";
import { Spinner } from "../../components/ui/Progress";
import { Tooltip } from "../../components/ui/Tooltip";
import type { SiteEntry } from "../../scenario/api";
import { KindGlyph } from "./KindGlyph";
import { useMapStore } from "./mapStore";
import { KIND_ORDER, KIND_STYLE, countBy, filterSites } from "./sites";

const CONF_ORDER = ["high", "medium", "low", "unverified"];

interface SitesPanelProps {
  sites: SiteEntry[] | null;
  loading: boolean;
  error: ApiError | null;
  onRetry(): void;
  onSelect(site: SiteEntry): void;
  searchRef: React.Ref<HTMLInputElement>;
}

export function SitesPanel({ sites, loading, error, onRetry, onSelect, searchRef }: SitesPanelProps) {
  const s = useMapStore();
  const all = useMemo(() => sites ?? [], [sites]);
  const kindCounts = useMemo(() => new Map(countBy(all, (x) => x.kind).map((c) => [c.value, c.count])), [all]);
  const statuses = useMemo(() => countBy(all, (x) => x.status ?? "").filter((c) => c.value !== ""), [all]);
  const confidences = useMemo(() => {
    const have = new Set(all.map((x) => x.confidence));
    return CONF_ORDER.filter((c) => have.has(c as SiteEntry["confidence"]));
  }, [all]);
  const shown = useMemo(() => filterSites(all, { kinds: s.kinds, confidence: s.confidence, status: s.status, query: s.query }), [all, s.kinds, s.confidence, s.status, s.query]);
  const active = (s.confidence ? 1 : 0) + (s.status ? 1 : 0);

  return (
    <div className="map-panel map-sites">
      {error && <ServiceNotice error={error} what="the site catalogue (GET /api/v1/sites)" onRetry={onRetry} />}
      <div className="map-search">
        <Icon name="search" size={14} />
        <input
          ref={searchRef}
          type="search"
          className="map-search-input"
          placeholder="Search sites"
          aria-label="Search sites by name, mission or operator"
          value={s.query}
          onChange={(e) => s.set({ query: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && shown[0]) onSelect(shown[0]);
            if (e.key === "Escape" && s.query) {
              e.stopPropagation();
              s.set({ query: "" });
            }
          }}
        />
        {loading ? <Spinner size={12} label="Loading" /> : sites && <span className="map-count num">{shown.length}</span>}
        <Popover label={active > 0 ? `Filter · ${active}` : "Filter"} icon="filter" align="end" width={260}>
          <div className="map-filters">
            <label className="map-filter">
              <span className="field-label">Confidence</span>
              <Select aria-label="Filter by confidence" value={s.confidence ?? ""} options={[{ value: "", label: "Any" }, ...confidences.map((c) => ({ value: c, label: c }))]} onChange={(v) => s.set({ confidence: v || null })} />
            </label>
            <label className="map-filter">
              <span className="field-label">Status</span>
              <Select
                aria-label="Filter by status"
                value={s.status ?? ""}
                options={[{ value: "", label: "Any" }, ...statuses.map((c) => ({ value: c.value, label: `${c.value.length > 34 ? `${c.value.slice(0, 33)}…` : c.value} (${c.count})` }))]}
                onChange={(v) => s.set({ status: v || null })}
              />
            </label>
          </div>
        </Popover>
      </div>
      <div className="map-chips" role="group" aria-label="Site kinds shown on the map">
        {KIND_ORDER.map((k) => {
          const on = s.kinds.has(k);
          return (
            <Tooltip key={k} content={KIND_STYLE[k].label}>
              <button type="button" className="map-chip" aria-pressed={on} aria-label={KIND_STYLE[k].label} onClick={() => s.toggleKind(k)}>
                <KindGlyph kind={k} />
                <span className="num">{kindCounts.get(k) ?? 0}</span>
              </button>
            </Tooltip>
          );
        })}
      </div>
      <ul className="map-site-list" aria-label="Matching sites">
        {shown.map((x) => (
          <li key={x.id}>
            <button type="button" className="map-site-item" aria-current={s.selectedId === x.id} onClick={() => onSelect(x)}>
              <KindGlyph kind={x.kind} hollow={x.confidence !== "high"} />
              <span className="map-site-name">{x.name}</span>
              <span className="map-site-meta">{KIND_STYLE[x.kind].label}</span>
            </button>
          </li>
        ))}
      </ul>
      {sites && shown.length === 0 && <EmptyState icon="search" title="No matching sites" />}
    </div>
  );
}
