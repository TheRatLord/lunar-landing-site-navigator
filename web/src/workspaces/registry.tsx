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
  /** Whether the page at exactly `path` reads the shared selected time or playback; the shell shows the time scrubber only there. */
  time: boolean;
  plan: boolean;
}

interface WorkspaceSpec {
  id: string;
  label: string;
  icon: IconName;
  hotkey?: string | null;
  usesDraft?: boolean;
  time?: boolean;
  plan?: boolean;
  load: () => Promise<ComponentType>;
}

function workspace({ id, label, icon, hotkey = null, usesDraft = true, time = false, plan = true, load }: WorkspaceSpec): Workspace {
  const Lazy = lazy(() => load().then((c) => ({ default: c })));
  const element = (
    <WorkspaceBoundary key={label} workspace={label} usesDraft={usesDraft}>
      <Suspense fallback={<p className="faint panel-pad"><Spinner size={12} /> Loading</p>}>
        <Lazy />
      </Suspense>
    </WorkspaceBoundary>
  );
  return { id, path: `/${id}`, label, icon, element, hotkey, time, plan };
}

const OVERVIEW = workspace({
  id: "overview",
  label: "Overview",
  icon: "target",
  hotkey: "1",
  load: () => import("./home/HomeWorkspace").then((m) => m.HomeWorkspace),
});
const SITE = workspace({
  id: "site",
  label: "Site",
  icon: "site",
  hotkey: "2",
  time: true,
  load: () => import("./site/SiteWorkspace").then((m) => m.SiteWorkspace),
});
const MAP = workspace({
  id: "map",
  label: "Map",
  icon: "map",
  hotkey: "3",
  time: true,
  load: () => import("./map/MapWorkspace").then((m) => m.MapWorkspace),
});
const COMPARE = workspace({
  id: "compare",
  label: "Compare",
  icon: "compare",
  hotkey: "4",
  load: () => import("./compare/CompareWorkspace").then((m) => m.CompareWorkspace),
});
const SETUP = workspace({
  id: "mission",
  label: "Setup",
  icon: "sliders",
  load: () => import("./mission/MissionWorkspace").then((m) => m.MissionWorkspace),
});
const EVIDENCE = workspace({
  id: "evidence",
  label: "Evidence",
  icon: "evidence",
  usesDraft: false,
  plan: false,
  load: () => import("./evidence/EvidenceWorkspace").then((m) => m.EvidenceWorkspace),
});

export const HOME: Workspace = OVERVIEW;
export const VIEW_WORKSPACES: Workspace[] = [OVERVIEW, SITE, MAP, COMPARE];
export const SETUP_WORKSPACE: Workspace = SETUP;
export const EVIDENCE_WORKSPACE: Workspace = EVIDENCE;
export const WORKSPACES: Workspace[] = [...VIEW_WORKSPACES, SETUP, EVIDENCE];

export function isAt(w: Workspace, pathname: string): boolean {
  return pathname === w.path || pathname.startsWith(`${w.path}/`);
}

const trimmed = (pathname: string): string => (pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname);

/** Whether the page at `pathname` reads the shared time. */
export function usesTime(pathname: string): boolean {
  const path = trimmed(pathname);
  return WORKSPACES.some((w) => w.time && w.path === path);
}

export function showsPlan(pathname: string): boolean {
  return !WORKSPACES.some((w) => !w.plan && isAt(w, pathname));
}
