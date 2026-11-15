import { useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { Command } from "../components/ui/CommandPalette";
import { exportScenarioJson } from "../scenario/editor/scenarioActions";
import { useEditorUi, type PlanField } from "../scenario/editor/editorUi";
import { useAsk } from "../ask/askStore";
import { BLANK_LINK, DEMO_LINK, RESET_LINK, useScenario } from "../scenario/store";
import { useApp } from "../state/store";
import { HOME, VIEW_WORKSPACES, WORKSPACES, showsPlan, usesTime } from "../workspaces/registry";
import { copyPlanLink, requestPlanAction } from "./PlanSwitcher";
import { togglePlay } from "./TimeScrubber";

const PLAN_FIELDS: Array<{ field: PlanField; title: string; icon: Command["icon"]; keywords: string }> = [
  { field: "site", title: "Change site", icon: "pin", keywords: "location coordinates where radius nearby" },
  { field: "time", title: "Change landing", icon: "calendar", keywords: "date time stay when window" },
  { field: "lander", title: "Change lander", icon: "lander", keywords: "vehicle" },
  { field: "constraints", title: "Change requirements", icon: "checklist", keywords: "limits pass fail rank" },
];

export function useCommands(): Command[] {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const theme = useApp((s) => s.theme);
  const askEnabled = useAsk((s) => s.enabled);
  const plan = showsPlan(pathname);

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = WORKSPACES.map((w) => ({
      id: `go-${w.id}`,
      title: `Go to ${w.label}`,
      group: "Navigate",
      icon: w.icon,
      shortcut: w.hotkey ? `Alt+${w.hotkey}` : undefined,
      run: () => navigate(w.path),
    }));
    if (import.meta.env.DEV) {
      list.push({ id: "go-gallery", title: "Go to component gallery", group: "Navigate", icon: "ruler", run: () => navigate("/dev/gallery") });
    }
    const ui = useEditorUi.getState;
    const sc = useScenario.getState;
    if (askEnabled) {
      list.push({ id: "ask-toggle", title: "Open or close Ask", group: "Ask", icon: "analyst", shortcut: "Alt+A", keywords: "ask assistant question", run: () => useAsk.getState().toggle() });
    }
    for (const f of PLAN_FIELDS) {
      list.push({
        id: `plan-${f.field}`,
        title: f.title,
        group: "Plan",
        icon: f.icon,
        keywords: f.keywords,
        run: () => {
          if (!plan) navigate(HOME.path);
          ui().openField(f.field);
        },
      });
    }
    list.push(
      { id: "plan-open", title: "Your plans…", group: "Plan", icon: "folder", keywords: "open switch saved", run: () => ui().setDialog("open") },
      { id: "plan-demo", title: "Open the demo plan", group: "Plan", icon: "rover", keywords: "example switch", run: () => void requestPlanAction(DEMO_LINK) },
      { id: "plan-demo-reset", title: "Reset the demo plan", group: "Plan", icon: "reset", keywords: "example restore", run: () => void requestPlanAction(RESET_LINK) },
      {
        id: "plan-blank",
        title: "Start a blank plan",
        group: "Plan",
        icon: "plus",
        keywords: "new empty",
        run: () => {
          if (!plan) navigate(HOME.path);
          void requestPlanAction(BLANK_LINK);
        },
      },
      { id: "plan-save", title: "Save plan", group: "Plan", icon: "check", shortcut: "Ctrl S", run: () => void sc().save() },
      { id: "plan-link", title: "Copy link", group: "Plan", icon: "link", run: () => void copyPlanLink() },
      { id: "plan-export", title: "Download plan file", group: "Plan", icon: "download", run: exportScenarioJson },
      {
        id: "theme",
        title: theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
        group: "View",
        icon: theme === "dark" ? "sun" : "moon",
        run: () => useApp.getState().setTheme(theme === "dark" ? "light" : "dark"),
      },
    );
    return list;
  }, [navigate, theme, askEnabled, plan]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useApp.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        s.setPaletteOpen(!s.paletteOpen);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && useScenario.getState().doc) {
        e.preventDefault();
        void useScenario.getState().save();
        return;
      }
      if (e.altKey && e.key.toLowerCase() === "a" && useAsk.getState().enabled) {
        e.preventDefault();
        useAsk.getState().toggle();
        return;
      }
      if (e.altKey && /^[1-9]$/.test(e.key)) {
        const w = VIEW_WORKSPACES.find((x) => x.hotkey === e.key);
        if (w) {
          e.preventDefault();
          navigate(w.path);
        }
        return;
      }
      if (e.key !== " " || e.ctrlKey || e.metaKey || e.altKey || !usesTime(window.location.pathname)) return;
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if (typing || t?.tagName === "BUTTON") return;
      e.preventDefault();
      togglePlay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  return commands;
}
