import type { ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { ASK_BUTTON_ID, useAsk } from "../ask/askStore";
import { Icon } from "../components/ui/Icon";
import { IconButton } from "../components/ui/Button";
import { Menu } from "../components/ui/Menu";
import { Spinner } from "../components/ui/Progress";
import { useApp } from "../state/store";
import { DETAIL_WORKSPACES, HOME } from "../workspaces/registry";
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
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const detail = DETAIL_WORKSPACES.find((w) => pathname === w.path || pathname.startsWith(`${w.path}/`));
  return (
    <nav className="tb-nav" aria-label="Pages">
      <NavLink to={HOME.path} className={({ isActive }) => `tb-tab${isActive ? " active" : ""}`} aria-keyshortcuts={`Alt+${HOME.hotkey}`}>
        {HOME.label}
      </NavLink>
      <span className={`tb-more${detail ? " active" : ""}`}>
        <Menu
          label="Detailed analysis pages"
          text={detail ? detail.label : "Detailed analysis"}
          width={220}
          items={DETAIL_WORKSPACES.map((w) => ({
            id: w.id,
            label: w.label,
            icon: w.icon,
            hint: w.hotkey ? `Alt+${w.hotkey}` : undefined,
            onSelect: () => navigate(w.path),
          }))}
        />
      </span>
    </nav>
  );
}

export function TopBar({ nav, tools }: { nav: ReactNode; tools?: ReactNode }) {
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);

  return (
    <header className="topbar">
      <Link to={HOME.path} className="brand" aria-label="Lunar Landing Site Navigator, home">
        <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden="true">
          <circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M3.5 19Q9 14 14 18T28.5 16" fill="none" stroke="var(--c-sun)" strokeWidth="2.6" />
        </svg>
        <span className="brand-text">Lunar Navigator</span>
      </Link>

      <ModeSwitch />

      {nav}

      <span className="grow" />

      {tools}
      <IconButton
        icon={theme === "dark" ? "sun" : "moon"}
        label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      />
    </header>
  );
}

export function PlannerTools() {
  const setPaletteOpen = useApp((s) => s.setPaletteOpen);
  const askEnabled = useAsk((s) => s.enabled);
  return (
    <>
      {askEnabled && <AskButton />}
      <IconButton icon="command" label="Command palette" shortcut="Ctrl K" onClick={() => setPaletteOpen(true)} />
    </>
  );
}
