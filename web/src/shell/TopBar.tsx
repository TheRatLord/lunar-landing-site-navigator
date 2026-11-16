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
      className="btn btn-sm btn-ghost tb-ask"
      aria-expanded={open}
      aria-controls="ask-dock"
      title={`Ask (Alt+A)${hint ? `: ${hint}` : ""}`}
      onClick={toggle}
    >
      <Icon name="analyst" size={14} />
      <span className="tb-label">Ask</span>
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
  return (
    <nav ref={track} className="tb-nav has-thumb" aria-label="Pages">
      {VIEW_WORKSPACES.map((w) => (
        <NavLink key={w.id} to={w.path} title={w.hotkey ? `Alt+${w.hotkey}` : undefined} className={({ isActive }) => `tb-tab${isActive ? " active" : ""}`} aria-keyshortcuts={w.hotkey ? `Alt+${w.hotkey}` : undefined}>
          <Icon name={w.icon} size={14} />
          {w.label}
        </NavLink>
      ))}
    </nav>
  );
}

export function TopBar({ nav, tools, modes = true }: { nav?: ReactNode; tools?: ReactNode; modes?: boolean }) {
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);

  return (
    <header className="topbar">
      <div className="tb-side">
        <Link to="/" state={{ front: true }} className="brand" aria-label="Crater, home">
          <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
            <circle cx="16" cy="16" r="12.5" fill="none" stroke="currentColor" strokeWidth="3" />
            <path d="M22.55 11.41A8 8 0 0 1 11.41 22.55A16 16 0 0 0 22.55 11.41Z" fill="var(--c-sun)" />
          </svg>
          <span className="brand-text">Crater</span>
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
  const askEnabled = useAsk((s) => s.enabled);
  return (
    <>
      <NavLink to={EVIDENCE_WORKSPACE.path} title={EVIDENCE_WORKSPACE.label} aria-label={EVIDENCE_WORKSPACE.label} className={({ isActive }) => `btn btn-sm btn-ghost tb-link${isActive ? " active" : ""}`}>
        <Icon name={EVIDENCE_WORKSPACE.icon} size={14} />
        <span className="tb-label">{EVIDENCE_WORKSPACE.label}</span>
      </NavLink>
      {askEnabled && <AskButton />}
      <IconButton icon="command" label="Command palette" shortcut="Ctrl K" className="tb-palette" onClick={() => setPaletteOpen(true)} />
    </>
  );
}
