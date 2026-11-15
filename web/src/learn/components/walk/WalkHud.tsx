import type { PointerEvent } from "react";
import { useLearn } from "../../store";
import { useIsTouch } from "../../touch";
import { FactCard } from "./FactCard";

const PAD = [
  { label: "Turn left", x: -1, y: 0, glyph: "◀", cls: "is-left" },
  { label: "Forward", x: 0, y: 1, glyph: "▲", cls: "is-up" },
  { label: "Back", x: 0, y: -1, glyph: "▼", cls: "is-down" },
  { label: "Turn right", x: 1, y: 0, glyph: "▶", cls: "is-right" },
];

export function WalkHud({ onStick }: { onStick: (x: number, y: number) => void }) {
  const body = useLearn((s) => s.walkBody);
  const edge = useLearn((s) => s.walkEdge);
  const hint = useLearn((s) => s.walkHint);
  const setBody = useLearn((s) => s.setWalkBody);
  const pov = useLearn((s) => s.walkPov);
  const setPov = useLearn((s) => s.setWalkPov);
  const touch = useIsTouch();
  const start = (e: PointerEvent<HTMLButtonElement>, x: number, y: number) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    onStick(x, y);
  };
  const stop = () => onStick(0, 0);
  return (
    <div className="l-walk-hud">
      {pov === "first" && body === "astronaut" && <div className="l-walk-visor" aria-hidden="true" />}
      {hint && (
        <p className="l-walk-hint" role="note">
          {touch ? (
            <>Drag to look · ▲ to {body === "rover" ? "drive" : "walk"}</>
          ) : (
            <>
              <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> {body === "rover" ? "drive" : "walk"} · drag look · <kbd>E</kbd> switch
            </>
          )}
        </p>
      )}
      <FactCard />
      {edge && <p className="l-walk-edge">Edge of the map. Turn back.</p>}
      {touch && (
        <div className="l-walk-pad" role="group" aria-label="Move">
          {PAD.map((b) => (
            <button
              key={b.cls}
              type="button"
              className={b.cls}
              aria-label={b.label}
              onPointerDown={(e) => start(e, b.x, b.y)}
              onPointerUp={stop}
              onPointerCancel={stop}
              onContextMenu={(e) => e.preventDefault()}
            >
              {b.glyph}
            </button>
          ))}
        </div>
      )}
      <div className="l-walk-actions">
        <button type="button" className="l-btn l-walk-pov" onClick={() => setPov(pov === "first" ? "third" : "first")}>
          {pov === "first" ? "Outside" : "Inside"}
        </button>
        <button type="button" className="l-btn l-btn-primary l-walk-switch" onClick={() => setBody(body === "rover" ? "astronaut" : "rover")}>
          {body === "rover" ? "Be the astronaut" : "Drive the rover"}
        </button>
      </div>
    </div>
  );
}
