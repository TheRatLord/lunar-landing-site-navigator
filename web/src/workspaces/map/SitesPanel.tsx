import type { ApiError } from "../../api/client";
import { ServiceNotice } from "../../components/ServiceNotice";
import { Spinner } from "../../components/ui/Progress";
import type { SiteEntry } from "../../scenario/api";
import { KindGlyph } from "./KindGlyph";

interface SitesPanelProps {
  sites: SiteEntry[] | null;
  selectedId: string | null;
  error: ApiError | null;
  onRetry(): void;
  onSelect(site: SiteEntry): void;
}

export function SitesPanel({ sites, selectedId, error, onRetry, onSelect }: SitesPanelProps) {
  return (
    <div className="map-panel map-sites">
      {error && <ServiceNotice error={error} what="the site catalogue" onRetry={onRetry} />}
      {!sites && !error && <Spinner size={12} label="Loading" />}
      <ul className="map-site-list" aria-label="Sites">
        {(sites ?? []).map((x) => (
          <li key={x.id}>
            <button type="button" className="map-site-item" aria-current={selectedId === x.id} onClick={() => onSelect(x)}>
              <KindGlyph kind={x.kind} hollow={x.confidence !== "high"} />
              <span className="map-site-name" title={x.name}>
                {x.name.replace(/^Artemis candidate region: /, "")}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
