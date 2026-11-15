import { chapterBySlug, type ViewKind } from "../chapters";
import { SITES, type SiteId } from "../sites";
import { useLearn } from "../store";
import { TimeBar } from "./TimeBar";
import { Toggle } from "./Toggle";

const EXPLORE = chapterBySlug("explore")!;

const PLACES: SiteId[] = ["apollo11", "blueghost", "rim", "floor", "change4"];

const VIEWS = [
  { value: "walk", label: "Walk & drive" },
  { value: "space", label: "Space" },
];

export function Dock() {
  const siteId = useLearn((s) => s.siteId);
  const view = useLearn((s) => s.view);
  const { setSite, setView } = useLearn.getState();
  return (
    <div className="l-dock" role="group" aria-label="Explore">
      <div className="l-dock-row">
        <div className="l-places" role="group" aria-label="Place">
          {PLACES.map((id) => (
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
          {PLACES.map((id) => (
            <option key={id} value={id}>
              {SITES[id].name}
            </option>
          ))}
        </select>
        <Toggle label="View" value={view} options={VIEWS} onChange={(v) => setView(v as ViewKind)} />
      </div>
      <TimeBar c={EXPLORE} />
    </div>
  );
}
