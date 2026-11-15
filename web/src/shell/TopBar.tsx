import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { ASK_BUTTON_ID, useAsk } from "../ask/askStore";
import { Icon } from "../components/ui/Icon";
import { IconButton } from "../components/ui/Button";
import { Spinner } from "../components/ui/Progress";
import { useApp } from "../state/store";
import { EVIDENCE_WORKSPACE, HOME, VIEW_WORKSPACES } from "../workspaces/registry";
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
      className="btn btn-sm btn-ghost tb-ask"
      aria-expanded={open}
      aria-controls="ask-dock"
      title={`Ask (Alt+A)${hint ? `: ${hint}` : ""}`}
      onClick={toggle}
    >
      <Icon name="analyst" size={14} />
      Ask
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
  return (
    <nav className="tb-nav" aria-label="Pages">
      {VIEW_WORKSPACES.map((w) => (
        <NavLink key={w.id} to={w.path} title={w.hotkey ? `Alt+${w.hotkey}` : undefined} className={({ isActive }) => `tb-tab${isActive ? " active" : ""}`} aria-keyshortcuts={w.hotkey ? `Alt+${w.hotkey}` : undefined}>
          <Icon name={w.icon} size={14} />
          {w.label}
        </NavLink>
      ))}
    </nav>
  );
}

export function TopBar({ nav, tools }: { nav: ReactNode; tools?: ReactNode }) {
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);

  return (
    <header className="topbar">
      <div className="tb-side">
        <Link to={HOME.path} className="brand" aria-label="Lunar Landing Site Navigator, home">
          <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
            <circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M3.5 19Q9 14 14 18T28.5 16" fill="none" stroke="var(--c-sun)" strokeWidth="2.6" />
          </svg>
          <span className="brand-text">Lunar Navigator</span>
        </Link>
        <ModeSwitch />
      </div>

      {nav}

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
  const askEnabled = useAsk((s) => s.enabled);
  return (
    <>
      <NavLink to={EVIDENCE_WORKSPACE.path} className={({ isActive }) => `btn btn-sm btn-ghost tb-link${isActive ? " active" : ""}`}>
        <Icon name={EVIDENCE_WORKSPACE.icon} size={14} />
        {EVIDENCE_WORKSPACE.label}
      </NavLink>
      {askEnabled && <AskButton />}
      <IconButton icon="command" label="Command palette" shortcut="Ctrl K" onClick={() => setPaletteOpen(true)} />
    </>
  );
}
