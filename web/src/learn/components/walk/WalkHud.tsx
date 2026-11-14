import { useLearn } from "../../store";
import { CloseIcon } from "../icons";

export function WalkHud() {
  const body = useLearn((s) => s.walkBody);
  const edge = useLearn((s) => s.walkEdge);
  const hint = useLearn((s) => s.walkHint);
  const setBody = useLearn((s) => s.setWalkBody);
  const other = body === "rover" ? "astronaut" : "rover";
  return (
    <div className="l-walk-hud">
      {hint && (
        <div className="l-walk-hint" role="note">
          <p>
            <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> or arrows to move · drag to look around · <kbd>Space</kbd> to jump ·{" "}
            <kbd>E</kbd> to switch · <kbd>K</kbd> to play time
          </p>
          <button
            type="button"
            className="l-note-close"
            aria-label="Hide the controls"
            onClick={() => useLearn.setState({ walkHint: false })}
          >
            <CloseIcon size={16} />
          </button>
        </div>
      )}
      {edge && <p className="l-walk-edge">This is as far as the map goes. Turn back to explore more.</p>}
      <div className="l-walk-actions">
        <button type="button" className="l-btn l-btn-primary l-walk-switch" onClick={() => setBody(other)}>
          {body === "rover" ? "Switch to the astronaut" : "Switch to the rover"}
        </button>
      </div>
    </div>
  );
}
