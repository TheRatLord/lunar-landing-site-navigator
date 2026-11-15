import { chapterBySlug, type ViewKind } from "../chapters";
import { SITES, type SiteId } from "../sites";
import { useLearn } from "../store";
import { TimeBar } from "./TimeBar";
import { Toggle } from "./Toggle";

const EXPLORE = chapterBySlug("explore")!;

const PLACES: SiteId[] = ["apollo11", "blueghost", "rim", "floor", "change4"];

const viewsAt = (id: SiteId): { value: ViewKind; label: string }[] => [
  { value: "walk", label: "Walk & drive" },
  { value: "ground", label: "On the ground" },
  { value: "space", label: "In space" },
  ...(id === "rim" || id === "floor" ? [{ value: "crater" as const, label: "Close-up" }] : []),
];

export function Dock() {
  const siteId = useLearn((s) => s.siteId);
  const view = useLearn((s) => s.view);
  const minimized = useLearn((s) => s.walkUiMinimized) && view === "walk";
  const places: SiteId[] = useLearn((s) => s.planPlace) ? [...PLACES, "plan"] : PLACES;
  const { setSite, setView, setWalkUiMinimized } = useLearn.getState();
  const views = viewsAt(siteId);
  if (minimized) {
    return (
      <div className="l-dock is-compact" role="group" aria-label="Explore controls">
        <span className="l-dock-compact-place">{SITES[siteId].name} · Free roam</span>
        <button type="button" className="l-dock-collapse" aria-expanded={false} onClick={() => setWalkUiMinimized(false)}>
          Show controls
        </button>
      </div>
    );
  }
  return (
    <div className="l-dock" role="group" aria-label="Explore">
      <div className="l-dock-row">
        <div className="l-places" role="group" aria-label="Place">
          {places.map((id) => (
            <button key={id} type="button" className="l-place" aria-pressed={siteId === id} onClick={() => setSite(id)}>
              {SITES[id].name}
            </button>
          ))}
        </div>
        <select
          className="l-place-select"
          aria-label="Place"
          value={siteId}
          onChange={(e) => {
            setSite(e.target.value as SiteId);
            e.currentTarget.blur();
          }}
        >
          {places.map((id) => (
            <option key={id} value={id}>
              {SITES[id].name}
            </option>
          ))}
        </select>
        <select
          className="l-place-select"
          aria-label="View"
          value={view}
          onChange={(e) => {
            setView(e.target.value as ViewKind);
            e.currentTarget.blur();
          }}
        >
          {views.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {view === "walk" && (
          <button type="button" className="l-dock-collapse" aria-expanded={true} onClick={() => setWalkUiMinimized(true)}>
            Minimize
          </button>
        )}
      </div>
      <div className="l-dock-time">
        <div className="l-dock-views">
          <Toggle label="View" value={view} options={views} onChange={(v) => setView(v as ViewKind)} />
        </div>
        <TimeBar c={EXPLORE} />
      </div>
    </div>
  );
}
