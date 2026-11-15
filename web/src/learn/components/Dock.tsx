import { type ViewKind } from "../chapters";
import { dateOfDay } from "../geometry";
import { SITES, type SiteId } from "../sites";
import { chapterOf, useLearn } from "../store";
import { TimeBar } from "./TimeBar";
import { Toggle } from "./Toggle";

const LANDINGS: SiteId[] = ["apollo11", "blueghost", "change4"];
const POLE: SiteId[] = ["rim", "floor"];

const viewsAt = (id: SiteId): { value: ViewKind; label: string }[] => [
  { value: "walk", label: "Walk & drive" },
  { value: "ground", label: "On the ground" },
  { value: "space", label: "In space" },
  ...(id === "rim" || id === "floor" ? [{ value: "crater" as const, label: "Close-up" }] : []),
];

function Group({ label, ids }: { label: string; ids: SiteId[] }) {
  const siteId = useLearn((s) => s.siteId);
  const { setSite } = useLearn.getState();
  return (
    <div className="l-place-group" role="group" aria-label={label}>
      <span className="l-place-kind" aria-hidden>
        {label}
      </span>
      <div className="l-place-row">
        {ids.map((id) => (
          <button key={id} type="button" className="l-place" aria-pressed={siteId === id} onClick={() => setSite(id)}>
            {SITES[id].name}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Dock() {
  const siteId = useLearn((s) => s.siteId);
  const view = useLearn((s) => s.view);
  const t = useLearn((s) => s.t);
  const plan = useLearn((s) => s.planPlace);
  const { setSite, setView } = useLearn.getState();
  const views = viewsAt(siteId);
  const viewLabel = views.find((v) => v.value === view)?.label ?? "";
  const date = dateOfDay(chapterOf("explore").epochD + t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const groups: { label: string; ids: SiteId[] }[] = [
    { label: "Past landings", ids: LANDINGS },
    { label: "South pole, no landing yet", ids: POLE },
    ...(plan ? [{ label: "Your plan", ids: ["plan" as SiteId] }] : []),
  ];
  return (
    <div className="l-dock l-fold" role="group" aria-label="Explore">
      <button type="button" className="l-fold-sum l-dock-sum" aria-label={`Place, view and time: ${SITES[siteId].name}, ${viewLabel}, ${date}. Show the controls`}>
        <strong>{SITES[siteId].name}</strong>
        <span>{viewLabel}</span>
        <span>{date}</span>
      </button>
      <div className="l-dock-row">
        <div className="l-places">
          {groups.map((g) => (
            <Group key={g.label} label={g.label} ids={g.ids} />
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
          {groups.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.ids.map((id) => (
                <option key={id} value={id}>
                  {SITES[id].name}
                </option>
              ))}
            </optgroup>
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
      </div>
      <div className="l-dock-time">
        <div className="l-dock-views">
          <Toggle label="View" value={view} options={views} onChange={(v) => setView(v as ViewKind)} />
        </div>
        <TimeBar c={chapterOf("explore")} />
      </div>
    </div>
  );
}
