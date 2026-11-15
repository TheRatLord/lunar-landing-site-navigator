import { type ViewKind } from "../chapters";
import { dateOfDay } from "../geometry";
import { SITES, type SiteId } from "../sites";
import { chapterOf, useLearn } from "../store";
import { LanderIcon, PauseIcon, PlayIcon } from "./icons";
import { LessonsPop } from "./LessonsPop";
import { Pop } from "./Pop";
import { TimeBar } from "./TimeBar";

const LANDINGS: { id: SiteId; note: string }[] = [
  { id: "apollo11", note: "1969, the first people on the Moon" },
  { id: "blueghost", note: "2025, the first fully successful commercial landing" },
  { id: "change4", note: "2019, the first landing on the far side" },
];
const POLE: { id: SiteId; note: string }[] = [
  { id: "rim", note: "On the rim, sunlit most of the time" },
  { id: "floor", note: "On the floor, always in shadow" },
];

const viewsAt = (id: SiteId): { value: ViewKind; label: string; note: string }[] => [
  { value: "walk", label: "Walk & drive", note: "Walk or drive on the surface" },
  { value: "ground", label: "On the ground", note: "Stand still and watch the sky" },
  { value: "space", label: "In space", note: "See the Sun, Earth and Moon from far away" },
  ...(id === "rim" || id === "floor" ? [{ value: "crater" as const, label: "Close-up", note: "The whole crater in 3D" }] : []),
];

function Options({ items, current, pick }: { items: { id: string; label: string; note: string }[]; current: string; pick: (id: string) => void }) {
  return (
    <ul className="l-pop-list">
      {items.map((o) => (
        <li key={o.id}>
          <button type="button" className="l-pop-opt" aria-pressed={o.id === current} onClick={() => pick(o.id)}>
            <strong>{o.label}</strong>
            <span>{o.note}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function PoleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M2 18c4-7 16-7 20 0" />
      <path d="M8 18c1.5-3 6.5-3 8 0" />
      <circle cx="12" cy="6" r="2.5" />
    </svg>
  );
}

function ViewIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}

export function Dock() {
  const siteId = useLearn((s) => s.siteId);
  const view = useLearn((s) => s.view);
  const t = useLearn((s) => s.t);
  const playing = useLearn((s) => s.playing);
  const plan = useLearn((s) => s.planPlace);
  const { setSite, setView } = useLearn.getState();
  const views = viewsAt(siteId);
  const viewLabel = views.find((v) => v.value === view)?.label ?? "";
  const date = dateOfDay(chapterOf("explore").epochD + t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const landing = LANDINGS.find((p) => p.id === siteId);
  const pole = POLE.find((p) => p.id === siteId);
  const pickSite = (id: string) => setSite(id as SiteId);
  return (
    <div className="l-popbar" role="group" aria-label="Explore">
      <Pop label={`View: ${viewLabel}`} summary={<><ViewIcon /><span className="l-pop-text">{viewLabel}</span></>}>
        <p className="l-pop-title">How to look</p>
        <Options items={views.map((v) => ({ id: v.value, label: v.label, note: v.note }))} current={view} pick={(v) => setView(v as ViewKind)} />
      </Pop>
      <Pop
        label={`Past landings${landing ? `: ${SITES[landing.id].name}` : ""}`}
        active={!!landing}
        summary={<><LanderIcon size={18} /><span className="l-pop-text">{landing ? SITES[landing.id].name : "Past landings"}</span></>}
      >
        <p className="l-pop-title">Past landings</p>
        <Options items={LANDINGS.map((p) => ({ id: p.id, label: SITES[p.id].name, note: p.note }))} current={siteId} pick={pickSite} />
      </Pop>
      <Pop
        label={`South pole${pole ? `: ${SITES[pole.id].name}` : ""}`}
        active={!!pole}
        summary={<><PoleIcon /><span className="l-pop-text">{pole ? SITES[pole.id].name : "South pole"}</span></>}
      >
        <p className="l-pop-title">South pole, no landing yet</p>
        <Options items={POLE.map((p) => ({ id: p.id, label: SITES[p.id].name, note: p.note }))} current={siteId} pick={pickSite} />
      </Pop>
      {plan && (
        <button type="button" className={`l-pop-btn${siteId === "plan" ? " is-active" : ""}`} onClick={() => setSite("plan")}>
          <span className="l-pop-text">{SITES.plan.name}</span>
        </button>
      )}
      <LessonsPop />
      <Pop
        className="l-pop-time"
        label={`Time: ${date}, ${playing ? "playing" : "paused"}`}
        summary={<>{playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}<span className="l-pop-text">{date}</span></>}
      >
        <TimeBar c={chapterOf("explore")} />
      </Pop>
    </div>
  );
}
