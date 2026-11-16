import { lazy, Suspense, useEffect, useSyncExternalStore } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { planStay, useScenario } from "../scenario/store";
import { loadAskAvailability, useAsk } from "../ask/askStore";
import { ServiceNotice } from "../components/ServiceNotice";
import { CommandPalette } from "../components/ui/CommandPalette";
import { Spinner } from "../components/ui/Progress";
import { ToastViewport } from "../components/ui/Toasts";
import { useApp } from "../state/store";
import { showsPlan, usesTime } from "../workspaces/registry";
import { DraftNotice } from "./DraftNotice";
import { TimeScrubber } from "./TimeScrubber";
import { ScenarioDialogs } from "../scenario/editor/ScenarioDialogs";
import { useEditorUi } from "../scenario/editor/editorUi";
import { PlanPanel } from "./PlanPanel";
import { PlannerNav, PlannerTools, TopBar } from "./TopBar";
import { useArrivingSite } from "../scenario/arrivingSite";
import { useScenarioUrl } from "../scenario/scenarioUrl";
import { useCommands } from "./useCommands";
import { useRememberMode } from "./lastMode";

const AskDock = lazy(() => import("../ask/AskDock").then((m) => ({ default: m.AskDock })));

const NARROW = "(max-width: 1023.98px)";
const PLAY_SECONDS = 40;

function subscribeNarrow(cb: () => void): () => void {
  const mq = window.matchMedia(NARROW);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const isNarrow = () => window.matchMedia(NARROW).matches;

export function AppShell() {
  const narrow = useSyncExternalStore(subscribeNarrow, isNarrow);
  const { pathname } = useLocation();
  if (narrow && !pathname.startsWith("/evidence")) return <NarrowGate />;
  return <Planner />;
}

function NarrowGate() {
  return (
    <div className="narrow-gate">
      <strong className="narrow-gate-app">Moonwalkr</strong>
      <p>The planner needs a wider screen.</p>
      <Link className="btn btn-primary" to="/learn">
        Open Explorer
      </Link>
    </div>
  );
}

function usePlayback(timeRoute: boolean): void {
  const playing = useApp((s) => s.playing);
  useEffect(() => {
    if (!timeRoute && playing) useApp.getState().setPlaying(false);
  }, [timeRoute, playing]);
  useEffect(() => {
    if (!playing) return;
    const doc = useScenario.getState().doc;
    const stay = doc ? planStay(doc) : null;
    if (!stay) return void useApp.getState().setPlaying(false);
    const rate = (stay.end_ms - stay.start_ms) / PLAY_SECONDS;
    let raf = 0;
    let last = performance.now();
    const tick = (nowPerf: number) => {
      const dt = Math.min(0.25, (nowPerf - last) / 1000);
      last = nowPerf;
      const { timeMs, setTime, setPlaying } = useApp.getState();
      const next = Math.max(timeMs, stay.start_ms) + dt * rate;
      if (next >= stay.end_ms) {
        setTime(stay.end_ms);
        setPlaying(false);
        return;
      }
      setTime(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
}

function Planner() {
  useScenarioUrl();
  useArrivingSite();
  const paletteOpen = useApp((s) => s.paletteOpen);
  const setPaletteOpen = useApp((s) => s.setPaletteOpen);
  const route = useEditorUi((s) => s.route);
  const navigate = useNavigate();
  const askEnabled = useAsk((s) => s.enabled);
  const askOpen = useAsk((s) => s.open);
  const askMode = useAsk((s) => s.mode);
  const ask = askEnabled && askOpen ? askMode : "closed";
  const { pathname } = useLocation();
  const timeRoute = usesTime(pathname);
  const plan = showsPlan(pathname);
  usePlayback(timeRoute);
  useRememberMode(plan ? "planner" : null);
  useEffect(() => {
    void loadAskAvailability();
  }, []);
  useEffect(() => {
    if (route && !window.location.pathname.startsWith(route.path)) navigate(route.path);
  }, [route, navigate]);
  const commands = useCommands();
  const planReady = useScenario((s) => s.doc !== null);
  const bootError = useScenario((s) => s.bootError);
  const retryStart = useScenario((s) => s.retryStart);

  return (
    <div className="shell" data-ask={ask} data-time={timeRoute ? "on" : "off"} data-plan={plan ? "open" : "none"}>
      <a className="skip-link" href={ask === "full" ? "#ask-dock" : "#main"}>
        Skip to page
      </a>
      <TopBar nav={<PlannerNav />} tools={<PlannerTools />} />
      {plan && <PlanPanel />}
      <main id="main" className="main" tabIndex={-1} inert={ask === "full"}>
        {plan && <DraftNotice />}
        {planReady || !plan ? (
          <Outlet />
        ) : bootError ? (
          <div className="plan-gate" role="alert">
            <ServiceNotice error={bootError} what="The demo plan" onRetry={retryStart} />
          </div>
        ) : (
          <div className="plan-gate" role="status">
            <Spinner size={14} /> Loading
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
