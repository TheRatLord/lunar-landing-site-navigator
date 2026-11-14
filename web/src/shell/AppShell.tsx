import { lazy, Suspense, useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useScenario } from "../scenario/store";
import { loadAskAvailability, useAsk } from "../ask/askStore";
import { ServiceNotice } from "../components/ServiceNotice";
import { CommandPalette } from "../components/ui/CommandPalette";
import { Spinner } from "../components/ui/Progress";
import { ToastViewport } from "../components/ui/Toasts";
import { useApp } from "../state/store";
import { isHome, usesTime } from "../workspaces/registry";
import { DraftNotice } from "./DraftNotice";
import { TimeScrubber } from "./TimeScrubber";
import { ScenarioDialogs } from "../scenario/editor/ScenarioDialogs";
import { useEditorUi } from "../scenario/editor/editorUi";
import { ContextBar } from "./ContextBar";
import { TopBar } from "./TopBar";
import { useCommands } from "./useCommands";

const AskDock = lazy(() => import("../ask/AskDock").then((m) => ({ default: m.AskDock })));

export function AppShell() {
  const paletteOpen = useApp((s) => s.paletteOpen);
  const setPaletteOpen = useApp((s) => s.setPaletteOpen);
  const missionRequest = useEditorUi((s) => s.missionRequest);
  const navigate = useNavigate();
  const askEnabled = useAsk((s) => s.enabled);
  const askOpen = useAsk((s) => s.open);
  const askMode = useAsk((s) => s.mode);
  const ask = askEnabled && askOpen ? askMode : "closed";
  const { pathname } = useLocation();
  const timeRoute = usesTime(pathname);
  const home = isHome(pathname);
  const playing = useApp((s) => s.playing);
  useEffect(() => {
    void loadAskAvailability();
  }, []);
  useEffect(() => {
    if (!timeRoute && playing) useApp.getState().setPlaying(false);
  }, [timeRoute, playing]);
  useEffect(() => {
    if (missionRequest > 0 && !window.location.pathname.startsWith("/mission")) navigate("/mission");
  }, [missionRequest, navigate]);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (nowPerf: number) => {
      const dt = Math.min(0.25, (nowPerf - last) / 1000);
      last = nowPerf;
      const { timeMs, speed, bounds, range, setTime, setPlaying } = useApp.getState();
      const next = timeMs + dt * speed * 1000;
      const end = Math.min(bounds.end_ms, range.end_ms);
      if (next >= end) {
        setTime(end);
        setPlaying(false);
        return;
      }
      setTime(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
  const commands = useCommands();
  const planReady = useScenario((s) => s.doc !== null);
  const bootError = useScenario((s) => s.bootError);
  const retryStart = useScenario((s) => s.retryStart);

  return (
    <div className="shell" data-ask={ask} data-time={timeRoute ? "on" : "off"} data-home={home ? "on" : "off"}>
      <a className="skip-link" href={ask === "full" ? "#ask-dock" : "#main"}>
        Skip to page
      </a>
      <TopBar />
      {!home && <ContextBar />}
      <main id="main" className="main" tabIndex={-1} inert={ask === "full"}>
        <DraftNotice />
        {planReady ? (
          <Outlet />
        ) : bootError ? (
          <div className="plan-gate" role="alert">
            <ServiceNotice error={bootError} what="The example plan" onRetry={retryStart} />
          </div>
        ) : (
          <div className="plan-gate" role="status">
            <Spinner size={14} /> Opening the example plan
          </div>
        )}
      </main>
      {askEnabled && (
        <Suspense fallback={null}>
          <AskDock />
        </Suspense>
      )}
      {timeRoute && <TimeScrubber />}
      <ScenarioDialogs />
      <ToastViewport />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} />
    </div>
  );
}
