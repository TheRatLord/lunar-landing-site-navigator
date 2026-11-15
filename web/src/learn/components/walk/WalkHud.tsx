import { useRef, type PointerEvent } from "react";
import { useLive } from "../../derive";
import { useLearn } from "../../store";
import { useIsTouch } from "../../touch";
import { FactCard } from "./FactCard";

const PAD = [
  { label: "Turn left", x: -1, y: 0, glyph: "◀", cls: "is-left" },
  { label: "Forward", x: 0, y: 1, glyph: "▲", cls: "is-up" },
  { label: "Back", x: 0, y: -1, glyph: "▼", cls: "is-down" },
  { label: "Turn right", x: 1, y: 0, glyph: "▶", cls: "is-right" },
];

export function WalkHud({ onStick, onJump }: { onStick: (x: number, y: number) => void; onJump: () => void }) {
  const body = useLearn((s) => s.walkBody);
  const edge = useLearn((s) => s.walkEdge);
  const hint = useLearn((s) => s.walkHint);
  const setBody = useLearn((s) => s.setWalkBody);
  const pov = useLearn((s) => s.walkPov);
  const setPov = useLearn((s) => s.setWalkPov);
  const touch = useIsTouch();
  const lights = useLearn((s) => s.walkLights);
  const dark = useLive().sky.sunlight < 0.05;
  const held = useRef(new Map<number, { x: number; y: number }>());
  const apply = () => {
    let x = 0;
    let y = 0;
    for (const v of held.current.values()) {
      x += v.x;
      y += v.y;
    }
    onStick(Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y)));
  };
  const start = (e: PointerEvent<HTMLButtonElement>, x: number, y: number) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    held.current.set(e.pointerId, { x, y });
    apply();
  };
  const stop = (e: PointerEvent<HTMLButtonElement>) => {
    held.current.delete(e.pointerId);
    apply();
  };
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
              {dark && <> · <kbd>L</kbd> lights</>}
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
          {body === "astronaut" && (
            <button type="button" className="is-jump" onPointerDown={onJump} onContextMenu={(e) => e.preventDefault()}>
              Jump
            </button>
          )}
        </div>
      )}
      <div className="l-walk-actions">
        {(dark || lights) && (
          <button type="button" className="l-btn l-walk-lights" aria-pressed={lights} onClick={() => useLearn.setState({ walkLights: !lights })}>
            Lights
          </button>
        )}
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
