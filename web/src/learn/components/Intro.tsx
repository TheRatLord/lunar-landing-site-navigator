import { Link } from "react-router-dom";
import { ArrowRightIcon } from "./icons";

export function Intro() {
  return (
    <section className="l-intro" aria-labelledby="l-intro-title">
      <p className="l-eyebrow">Moon Lab</p>
      <h1 id="l-intro-title" className="l-intro-title">
        On the Moon, a few steps or a few days can mean light or darkness.
      </h1>
      <p className="l-intro-sub">5 short stops · about 10 minutes.</p>
      <p className="l-intro-note">In the picture, Earth and the Moon are drawn much closer together than they really are.</p>
      <div className="l-intro-actions">
        <Link to="/learn/day" className="l-btn l-btn-primary l-btn-lg">
          Start <ArrowRightIcon size={20} />
        </Link>
        <Link to="/learn/explore" className="l-btn l-btn-quiet l-btn-lg">
          Jump to free explore
        </Link>
      </div>
      <p className="l-teacher">
        Works with a keyboard: <kbd>K</kbd> plays or pauses, <kbd>←</kbd> <kbd>→</kbd> move time (add <kbd>Shift</kbd> for a
        whole day), <kbd>[</kbd> <kbd>]</kbd> change stop.
      </p>
    </section>
  );
}
