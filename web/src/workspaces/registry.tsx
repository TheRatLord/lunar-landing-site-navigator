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
}

function workspace(id: string, label: string, icon: IconName, hotkey: string | null, usesDraft: boolean, load: () => Promise<ComponentType>, time = false): Workspace {
  const Lazy = lazy(() => load().then((c) => ({ default: c })));
  const element = (
    <WorkspaceBoundary key={label} workspace={label} usesDraft={usesDraft}>
      <Suspense fallback={<p className="faint panel-pad"><Spinner size={12} /> Loading page…</p>}>
        <Lazy />
      </Suspense>
    </WorkspaceBoundary>
  );
  return { id, path: `/${id}`, label, icon, element, hotkey, time };
}

export const WORKSPACES: Workspace[] = [
  workspace("overview", "Overview", "target", "0", true, () => import("./home/HomeWorkspace").then((m) => m.HomeWorkspace)),
  workspace("explore", "Explore", "map", "1", true, () => import("./explore/ExploreWorkspace").then((m) => m.ExploreWorkspace)),
  workspace("site", "Site", "site", "2", true, () => import("./site/SiteWorkspace").then((m) => m.SiteWorkspace), true),
  workspace("dates", "Dates", "calendar", "3", true, () => import("./calendar/CalendarWorkspace").then((m) => m.CalendarWorkspace)),
  workspace("compare", "Compare", "compare", "4", true, () => import("./compare/CompareWorkspace").then((m) => m.CompareWorkspace)),
  workspace("mission", "Mission", "battery", "5", true, () => import("./mission/MissionWorkspace").then((m) => m.MissionWorkspace)),
  workspace("evidence", "Evidence", "evidence", null, false, () => import("./evidence/EvidenceWorkspace").then((m) => m.EvidenceWorkspace)),
];

export const HOME: Workspace = WORKSPACES[0]!;
export const DETAIL_WORKSPACES: Workspace[] = WORKSPACES.slice(1);

export function isHome(pathname: string): boolean {
  return pathname === HOME.path || pathname.startsWith(`${HOME.path}/`);
}

/** Whether the page at `pathname` reads the shared time. */
export function usesTime(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return WORKSPACES.some((w) => w.time && w.path === path);
}
