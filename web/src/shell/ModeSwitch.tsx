import { Link, useLocation } from "react-router-dom";
import { Icon } from "../components/ui/Icon";
import { useThumb } from "../components/ui/useThumb";
import { HOME } from "../workspaces/registry";
import { prefetchExplorer } from "../learn/prefetch";

export function ModeSwitch() {
  const { pathname } = useLocation();
  const learn = pathname === "/learn" || pathname.startsWith("/learn/");
  const track = useThumb<HTMLElement>('[aria-current="page"]', learn);
  return (
    <nav ref={track} className="mode-switch has-thumb" data-mode={learn ? "explorer" : "planner"} aria-label="App mode">
      <Link
        to={HOME.path}
        className="mode-switch-opt"
        data-mode="planner"
        aria-current={learn ? undefined : "page"}
      >
        <Icon name="checklist" size={14} />
        Planner
        <span className="mode-switch-for">for mission teams</span>
      </Link>
      <Link
        to="/learn"
        className="mode-switch-opt"
        data-mode="explorer"
        aria-current={learn ? "page" : undefined}
        onPointerEnter={prefetchExplorer}
        onFocus={prefetchExplorer}
      >
        <Icon name="rover" size={14} />
        Explorer
        <span className="mode-switch-for">for everyone</span>
      </Link>
    </nav>
  );
}
