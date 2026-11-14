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
        title="Planner: the full tool mission engineers use"
      >
        Planner
      </Link>
      <Link
        to="/learn"
        className="mode-switch-opt"
        aria-current={learn ? "page" : undefined}
        title="Learn: a simple, guided tour of the Moon"
        onPointerEnter={prefetch}
        onFocus={prefetch}
      >
        Learn
      </Link>
    </nav>
  );
}
