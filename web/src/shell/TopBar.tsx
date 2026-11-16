import type { ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useThumb } from "../components/ui/useThumb";
import { ASK_BUTTON_ID, useAsk } from "../ask/askStore";
import { Icon } from "../components/ui/Icon";
import { IconButton } from "../components/ui/Button";
import { Spinner } from "../components/ui/Progress";
import { useApp } from "../state/store";
import { EVIDENCE_WORKSPACE, VIEW_WORKSPACES } from "../workspaces/registry";
import { ModeSwitch } from "./ModeSwitch";

function AskButton() {
  const open = useAsk((s) => s.open);
  const toggle = useAsk((s) => s.toggle);
  const { pending, running } = useAsk((s) => s.status);
  const waiting = pending !== null && pending > 0;
  const hint = [running ? "running" : "", waiting ? `${pending} awaiting sign-off` : ""].filter(Boolean).join(", ");
  return (
    <button
      type="button"
      id={ASK_BUTTON_ID}
      className="tb-ask"
      aria-expanded={open}
      aria-controls="ask-dock"
      title={`Ask (Alt+A)${hint ? `: ${hint}` : ""}`}
      onClick={toggle}
    >
      <Icon name="analyst" size={14} />
      <span>Ask AI</span>
      {running && (
        <span className="tb-ask-badge" data-kind="running">
          <Spinner size={10} />
          <span className="sr-only">an answer is in progress</span>
        </span>
      )}
      {waiting && (
        <span className="tb-ask-badge" data-kind="pending">
          {pending}
          <span className="sr-only"> assumption{pending === 1 ? "" : "s"} awaiting sign-off</span>
        </span>
      )}
    </button>
  );
}

export function PlannerNav() {
  const { pathname } = useLocation();
  const track = useThumb<HTMLElement>(".active", pathname);
  const askEnabled = useAsk((s) => s.enabled);
  return (
    <div className="tb-center">
      <nav ref={track} className="tb-nav has-thumb" aria-label="Pages">
        {VIEW_WORKSPACES.map((w) => (
          <NavLink key={w.id} to={w.path} title={w.hotkey ? `Alt+${w.hotkey}` : undefined} className={({ isActive }) => `tb-tab${isActive ? " active" : ""}`} aria-keyshortcuts={w.hotkey ? `Alt+${w.hotkey}` : undefined}>
            <Icon name={w.icon} size={14} />
            {w.label}
          </NavLink>
        ))}
      </nav>
      {askEnabled && <AskButton />}
    </div>
  );
}

export function TopBar({ nav, tools, modes = true }: { nav?: ReactNode; tools?: ReactNode; modes?: boolean }) {
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);

  return (
    <header className="topbar">
      <div className="tb-side">
        <Link to="/" state={{ front: true }} className="brand" aria-label="Moonwalker, home">
          <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
            <g transform="rotate(16 16 16)">
              <clipPath id="brand-sole">
                <path d="M15 2.5C19.5 2.5 22.5 6 22.5 11C22.5 14.5 21 16.5 21 19.5C21 22 22 23.5 22 25.5C22 28 19.8 29.5 17 29.5C14 29.5 12 28 12 25.5C12 23 12.5 21.5 12 19C11.5 16 9 14.5 9 10.5C9 5.5 11.5 2.5 15 2.5Z" />
              </clipPath>
              <g clipPath="url(#brand-sole)" fill="none" strokeWidth="3">
                <path d="M6 4H26M6 8.6H26M6 13.2H26M6 17.8H26" stroke="currentColor" />
                <path d="M6 22.4H26M6 27H26" stroke="var(--c-sun)" />
              </g>
            </g>
          </svg>
          <span className="brand-text">Moonwalker</span>
        </Link>
        {modes && <ModeSwitch />}
      </div>

      {nav ?? <span />}

      <div className="tb-side tb-side-end">
        {tools}
        <button
          type="button"
          className="btn btn-icon btn-ghost btn-md"
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          <Icon name={theme === "dark" ? "sun" : "moon"} size={16} />
        </button>
      </div>
    </header>
  );
}

export function PlannerTools() {
  const setPaletteOpen = useApp((s) => s.setPaletteOpen);
  return (
    <>
      <NavLink to={EVIDENCE_WORKSPACE.path} title={EVIDENCE_WORKSPACE.label} aria-label={EVIDENCE_WORKSPACE.label} className={({ isActive }) => `btn btn-sm btn-ghost tb-link${isActive ? " active" : ""}`}>
        <Icon name={EVIDENCE_WORKSPACE.icon} size={14} />
        <span className="tb-label">{EVIDENCE_WORKSPACE.label}</span>
      </NavLink>
      <IconButton icon="command" label="Command palette" shortcut="Ctrl K" className="tb-palette" onClick={() => setPaletteOpen(true)} />
    </>
  );
}
