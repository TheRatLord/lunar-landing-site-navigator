import "../styles/front.css";
import { Link, Navigate, useLocation } from "react-router-dom";
import { Icon } from "../components/ui/Icon";
import { prefetchExplorer } from "../learn/prefetch";
import { lastMode } from "../shell/lastMode";
import { TopBar } from "../shell/TopBar";
import { EVIDENCE_WORKSPACE, HOME } from "../workspaces/registry";

export function FrontDoor() {
  const { search, hash, state } = useLocation();
  if (search || hash) return <Navigate to={{ pathname: HOME.path, search, hash }} replace />;
  const mode = (state as { front?: boolean } | null)?.front ? null : lastMode();
  if (mode) return <Navigate to={mode === "explorer" ? "/learn" : HOME.path} replace />;
  return (
    <div className="front">
      <TopBar modes={false} />
      <main className="front-main" id="main">
        <header className="front-head">
          <h1>Where can a lander work on the Moon?</h1>
        </header>

        <div className="front-doors">
          <Link to={HOME.path} className="front-door" data-mode="planner">
            <img className="front-shot" src="/front/planner.webp" alt="" width={1040} height={650} />
            <div className="front-body">
              <span className="front-for">
                <Icon name="checklist" size={14} />
                For mission teams
              </span>
              <h2>Plan a landing</h2>
              <ul className="front-points">
                <li>Check sunlight, Earth link and slope</li>
                <li>Compare sites and dates</li>
                <li>Export reports</li>
              </ul>
              <span className="front-go">
                Open Planner
                <Icon name="chevronRight" size={14} />
              </span>
              <span className="front-wide">Needs a larger screen</span>
            </div>
          </Link>

          <Link
            to="/learn"
            className="front-door"
            data-mode="explorer"
            onPointerEnter={prefetchExplorer}
            onFocus={prefetchExplorer}
          >
            <img className="front-shot" src="/front/explorer.webp" alt="" width={1040} height={650} />
            <div className="front-body">
              <span className="front-for">
                <Icon name="rover" size={14} />
                For everyone
              </span>
              <h2>Explore the Moon</h2>
              <ul className="front-points">
                <li>Drive a rover and walk in 3D</li>
                <li>Visit Apollo 11 and the south pole</li>
                <li>5 short lessons</li>
              </ul>
              <span className="front-go">
                Start exploring
                <Icon name="chevronRight" size={14} />
              </span>
            </div>
          </Link>
        </div>

        <footer className="front-foot">
          <Link to={EVIDENCE_WORKSPACE.path}>How we check the numbers</Link>
          <span>Built for the NASA Space Apps Challenge 2026</span>
        </footer>
      </main>
    </div>
  );
}
