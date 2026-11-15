import { Link, useLocation } from "react-router-dom";

const prefetch = () => void import("../learn/LearnPage");

export function ModeSwitch() {
  const { pathname } = useLocation();
  const learn = pathname === "/learn" || pathname.startsWith("/learn/");
  return (
    <nav className="mode-switch" aria-label="App mode">
      <Link
        to="/"
        className="mode-switch-opt"
        aria-current={learn ? undefined : "page"}
      >
        Planner
      </Link>
      <Link
        to="/learn"
        className="mode-switch-opt"
        aria-current={learn ? "page" : undefined}
        onPointerEnter={prefetch}
        onFocus={prefetch}
      >
        Explorer
      </Link>
    </nav>
  );
}
