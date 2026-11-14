import { lazy, Suspense, type ComponentType, type ReactElement } from "react";
import type { IconName } from "../components/ui/Icon";
import { Spinner } from "../components/ui/Progress";
import { WorkspaceBoundary } from "../components/WorkspaceBoundary";

export interface Workspace {
  id: string;
  path: string;
  label: string;
  icon: IconName;
  element: ReactElement;
  /** Alt+<hotkey> navigates here. */
  hotkey: string | null;
  /** Whether the page at exactly `path` reads the shared selected time, analysis range or playback; the shell shows the time scrubber only there. */
  time: boolean;
  about: string;
}

interface WorkspaceSpec {
  id: string;
  label: string;
  icon: IconName;
  hotkey: string | null;
  about: string;
  usesDraft?: boolean;
  time?: boolean;
  load: () => Promise<ComponentType>;
}

function workspace({ id, label, icon, hotkey, about, usesDraft = true, time = false, load }: WorkspaceSpec): Workspace {
  const Lazy = lazy(() => load().then((c) => ({ default: c })));
  const element = (
    <WorkspaceBoundary key={label} workspace={label} usesDraft={usesDraft}>
      <Suspense fallback={<p className="faint panel-pad"><Spinner size={12} /> Loading page…</p>}>
        <Lazy />
      </Suspense>
    </WorkspaceBoundary>
  );
  return { id, path: `/${id}`, label, icon, element, hotkey, time, about };
}

const OVERVIEW = workspace({
  id: "overview",
  label: "Overview",
  icon: "target",
  hotkey: "0",
  about: "Is this site usable on this date? Sun, Earth and the year at a glance",
  load: () => import("./home/HomeWorkspace").then((m) => m.HomeWorkspace),
});
const MAP = workspace({
  id: "explore",
  label: "Map",
  icon: "map",
  hotkey: "1",
  about: "Where else could it land? Browse the Moon, search a region for sites that pass",
  load: () => import("./explore/ExploreWorkspace").then((m) => m.ExploreWorkspace),
});
const SITE = workspace({
  id: "site",
  label: "Site",
  icon: "site",
  hotkey: "2",
  about: "Does this site and date meet every requirement, and why? The full analysis",
  time: true,
  load: () => import("./site/SiteWorkspace").then((m) => m.SiteWorkspace),
});
const DATES = workspace({
  id: "dates",
  label: "Dates",
  icon: "calendar",
  hotkey: "3",
  about: "When else can it land here? Every landing date in a year, scored",
  load: () => import("./calendar/CalendarWorkspace").then((m) => m.CalendarWorkspace),
});
const COMPARE = workspace({
  id: "compare",
  label: "Compare",
  icon: "compare",
  hotkey: "4",
  about: "Which site and date is best? Sites against dates, side by side",
  load: () => import("./compare/CompareWorkspace").then((m) => m.CompareWorkspace),
});
const MISSION = workspace({
  id: "mission",
  label: "Mission setup",
  icon: "sliders",
  hotkey: "5",
  about: "Every setting of the lander, requirements, ground stations and model",
  load: () => import("./mission/MissionWorkspace").then((m) => m.MissionWorkspace),
});
const EVIDENCE = workspace({
  id: "evidence",
  label: "Evidence",
  icon: "evidence",
  hotkey: null,
  about: "How far to trust the numbers: validation reports and data versions",
  usesDraft: false,
  load: () => import("./evidence/EvidenceWorkspace").then((m) => m.EvidenceWorkspace),
});

export const HOME: Workspace = OVERVIEW;
export const VIEW_WORKSPACES: Workspace[] = [OVERVIEW, MAP, SITE, DATES, COMPARE];
export const SETUP_WORKSPACE: Workspace = MISSION;
export const EVIDENCE_WORKSPACE: Workspace = EVIDENCE;
export const WORKSPACES: Workspace[] = [...VIEW_WORKSPACES, MISSION, EVIDENCE];

export function isAt(w: Workspace, pathname: string): boolean {
  return pathname === w.path || pathname.startsWith(`${w.path}/`);
}

/** Whether the page at `pathname` reads the shared time. */
export function usesTime(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return WORKSPACES.some((w) => w.time && w.path === path);
}
