import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { Command } from "../components/ui/CommandPalette";
import { exportScenarioJson } from "../scenario/editor/scenarioActions";
import { useEditorUi } from "../scenario/editor/editorUi";
import { useAsk } from "../ask/askStore";
import { useScenario } from "../scenario/store";
import { useApp } from "../state/store";
import { WORKSPACES } from "../workspaces/registry";

export function useCommands(): Command[] {
  const navigate = useNavigate();
  const theme = useApp((s) => s.theme);
  const playing = useApp((s) => s.playing);
  const showMet = useApp((s) => s.showMet);
  const askEnabled = useAsk((s) => s.enabled);

  const commands = useMemo<Command[]>(() => {
    const s = useApp.getState;
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
      list.push({ id: "ask-toggle", title: "Open or close Ask", group: "Ask", icon: "analyst", shortcut: "Alt+A", keywords: "ask assistant conversation question dock", run: () => useAsk.getState().toggle() });
    }
    list.push(
      { id: "sc-site", title: "Change site", group: "Plan", icon: "pin", keywords: "site location coordinates catalogue map where", run: () => ui().show("site") },
      { id: "sc-time", title: "Change landing time", group: "Plan", icon: "clock", keywords: "epoch landing time date duration stay transfer launch when", run: () => ui().show("time") },
      { id: "sc-lander", title: "Change lander", group: "Plan", icon: "lander", keywords: "lander vehicle preset profile", run: () => ui().openField("lander") },
      { id: "sc-req", title: "Change requirements", group: "Plan", icon: "checklist", keywords: "requirements constraints limits thresholds pass fail", run: () => ui().openField("constraints") },
      { id: "sc-edit", title: "Open mission setup", group: "Plan", icon: "settings", shortcut: "Alt+E", keywords: "lander requirements constraints network ground stations model settings", run: () => ui().show() },
      { id: "sc-new", title: "New plan…", group: "Plan", icon: "plus", run: () => ui().setDialog("new") },
      { id: "sc-open", title: "Open plan…", group: "Plan", icon: "file", run: () => ui().setDialog("open") },
      { id: "sc-save", title: "Save plan", group: "Plan", icon: "check", shortcut: "Ctrl S", run: () => void sc().save() },
      { id: "sc-copy", title: "Save plan as copy", group: "Plan", icon: "copy", run: () => void sc().saveAsNew(sc().doc ? `${sc().doc?.name} (copy)` : undefined) },
      { id: "sc-revisions", title: "Plan version history…", group: "Plan", icon: "clock", run: () => ui().setDialog("revisions") },
      { id: "sc-export", title: "Download plan (JSON)", group: "Plan", icon: "download", run: exportScenarioJson },
      { id: "play", title: playing ? "Pause time" : "Play time", group: "Time", icon: playing ? "pause" : "play", shortcut: "Space", run: () => s().setPlaying(!s().playing) },
      ...([
        ["hour", "hour", "h", ".", ","],
        ["day", "day", "d"],
        ["lun", "lunation", "lunation"],
      ] as const).flatMap(([id, unit, label, fwd, back]): Command[] => [
        { id: `step-${id}-f`, title: `Step forward 1 ${label}`, group: "Time", icon: "stepFwd", shortcut: fwd, run: () => s().stepTime(unit, 1) },
        { id: `step-${id}-b`, title: `Step back 1 ${label}`, group: "Time", icon: "stepBack", shortcut: back, run: () => s().stepTime(unit, -1) },
      ]),
      { id: "met", title: showMet ? "Show UTC" : "Show MET", group: "Time", icon: "clock", run: () => s().setShowMet(!s().showMet) },
      { id: "met-epoch", title: "Set MET epoch", group: "Time", icon: "clock", run: () => s().setMetEpoch(s().timeMs) },
      {
        id: "theme",
        title: theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
        group: "View",
        icon: theme === "dark" ? "sun" : "moon",
        run: () => s().setTheme(s().theme === "dark" ? "light" : "dark"),
      },
    );
    return list;
  }, [navigate, theme, playing, showMet, askEnabled]);

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
      if (e.altKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        useEditorUi.getState().show();
        return;
      }
      if (e.altKey && e.key.toLowerCase() === "a" && useAsk.getState().enabled) {
        e.preventDefault();
        useAsk.getState().toggle();
        return;
      }
      if (e.altKey && /^[0-9]$/.test(e.key)) {
        const w = WORKSPACES.find((x) => x.hotkey === e.key);
        if (w) {
          e.preventDefault();
          navigate(w.path);
        }
        return;
      }
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === " " && t?.tagName !== "BUTTON" && t?.getAttribute("role") !== "slider") {
        e.preventDefault();
        s.setPlaying(!s.playing);
      } else if (e.key === ".") s.stepTime("hour", 1);
      else if (e.key === ",") s.stepTime("hour", -1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  return commands;
}
