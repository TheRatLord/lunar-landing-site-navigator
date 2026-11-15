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
          <p>
            Sunlight for power and a clear line to Earth for radio decide where and when a lander can land. This
            site works both out from NASA terrain and orbit data. Choose how you want to use it.
          </p>
        </header>

        <div className="front-doors">
          <Link to={HOME.path} className="front-door" data-mode="planner">
            <img className="front-shot" src="/front/planner.webp" alt="" width={1040} height={650} />
            <div className="front-body">
              <span className="front-for">
                <Icon name="checklist" size={14} />
                Planner · for mission teams
              </span>
              <h2>Plan a landing</h2>
              <p>
                Check a landing site, date and lander against your requirements: days of sunlight with an Earth link,
                the longest dark span, the slope. Compare sites across the year and export a report.
              </p>
              <ul className="front-points">
                <li>Answers from SPICE ephemerides and LOLA terrain</li>
                <li>Every number with its uncertainty</li>
              </ul>
              <span className="front-go">
                Open the Planner
                <Icon name="chevronRight" size={14} />
              </span>
              <span className="front-wide">Needs a laptop or larger screen</span>
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
                Explorer · for everyone
              </span>
              <h2>Explore the Moon</h2>
              <p>
                Drive a rover where Apollo 11 landed, watch the Sun skim the horizon at the south pole, and see why
                some crater floors never get daylight. No background needed.
              </p>
              <ul className="front-points">
                <li>Five short lessons with a question each</li>
                <li>Or roam free: walk, drive, fly out to space</li>
              </ul>
              <span className="front-go">
                Start exploring
                <Icon name="chevronRight" size={14} />
              </span>
            </div>
          </Link>
        </div>

        <footer className="front-foot">
          <Link to={EVIDENCE_WORKSPACE.path}>How every number was checked</Link>
          <span aria-hidden="true">·</span>
          <span>Built for the NASA Space Apps Challenge 2026</span>
        </footer>
      </main>
    </div>
  );
}
