import { Link, useLocation } from "react-router-dom";
import { useThumb } from "../components/ui/useThumb";

const prefetch = () => void import("../learn/LearnPage");

export function ModeSwitch() {
  const { pathname } = useLocation();
  const learn = pathname === "/learn" || pathname.startsWith("/learn/");
  const track = useThumb<HTMLElement>('[aria-current="page"]', learn);
  return (
    <nav ref={track} className="mode-switch has-thumb" aria-label="App mode">
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
