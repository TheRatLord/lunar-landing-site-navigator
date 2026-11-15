import { chapterBySlug } from "../chapters";
import { SITES, type SiteId } from "../sites";
import { useLearn } from "../store";
import { TimeBar } from "./TimeBar";

const EXPLORE = chapterBySlug("explore")!;

const PLACES: SiteId[] = ["apollo11", "blueghost", "rim", "floor", "change4"];

export function Dock() {
  const siteId = useLearn((s) => s.siteId);
  const { setSite } = useLearn.getState();
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
      </div>
      <TimeBar c={EXPLORE} />
    </div>
  );
}
