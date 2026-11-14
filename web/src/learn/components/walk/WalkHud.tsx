import type { PointerEvent } from "react";
import { useLearn } from "../../store";
import { CloseIcon } from "../icons";

export function WalkHud({ onStick }: { onStick: (x: number, y: number) => void }) {
  const body = useLearn((s) => s.walkBody);
  const chapter = useLearn((s) => s.chapter);
  const edge = useLearn((s) => s.walkEdge);
  const hint = useLearn((s) => s.walkHint);
  const setBody = useLearn((s) => s.setWalkBody);
  const other = body === "rover" ? "astronaut" : "rover";
  const start = (e: PointerEvent<HTMLButtonElement>, x: number, y: number) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    onStick(x, y);
  };
  const stop = () => onStick(0, 0);
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
        {chapter === "explore" && <div className="l-walk-drive" role="group" aria-label="Movement controls">
          <button type="button" aria-label="Turn left" onPointerDown={(e) => start(e, -1, 0)} onPointerUp={stop} onPointerCancel={stop}>A ◀</button>
          <button type="button" aria-label="Move forward" onPointerDown={(e) => start(e, 0, 1)} onPointerUp={stop} onPointerCancel={stop}>W ▲</button>
          <button type="button" aria-label="Move backward" onPointerDown={(e) => start(e, 0, -1)} onPointerUp={stop} onPointerCancel={stop}>S ▼</button>
          <button type="button" aria-label="Turn right" onPointerDown={(e) => start(e, 1, 0)} onPointerUp={stop} onPointerCancel={stop}>D ▶</button>
        </div>}
        <button type="button" className="l-btn l-btn-primary l-walk-switch" onClick={() => setBody(other)}>
          {body === "rover" ? "Switch to the astronaut" : "Switch to the rover"}
        </button>
      </div>
    </div>
  );
}
