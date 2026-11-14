import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { HorizonProfile, TargetTrack } from "../../../contract/types";
import { interpTrack } from "../../../lib/track";
import { GroundOverlay, type BodyLabel } from "./GroundOverlay";
import { GroundViewer } from "./GroundViewer";
import { buildGroundLevels, GROUND_LEVELS, GROUND_LEVELS_SMALL, skyVector, type Vec3 } from "./groundMesh";
import { ARRIVE_MS, arrivalPose, dragLook, FOV_DEFAULT_DEG, lookToward, standingPose, zoomLook, type Look } from "./look";
import { useGroundPatches } from "./useGroundPatches";

export interface GroundViewProps {
  siteName: string;
  lat: number;
  lon: number;
  /** Eye height above the ground (m): the observer height the engine's horizon was computed for. */
  eyeM: number;
  horizon: HorizonProfile | null;
  sunTrack: TargetTrack | null;
  earthTrack: TargetTrack | null;
  timeMs: number;
  onExit(): void;
}

const SMALL_PX = 720;
const BELOW: Vec3 = [0, 0, -1];

function bodyAt(track: TargetTrack | null, timeMs: number) {
  const p = track ? interpTrack(track, timeMs) : null;
  return p ? { dir: skyVector(p.az_deg, p.el_deg), az: p.az_deg, el: p.el_deg, radius: p.ang_radius_deg } : null;
}

/**
 * Standing on the Moon at the plan site: LOLA terrain round the site, lit by the engine's Sun, with
 * the Sun and Earth where the engine's tracks put them at the overview's time. Opens with a fly-down
 * from above.
 */
export function GroundView({ siteName, lat, lon, eyeM, horizon, sunTrack, earthTrack, timeMs, onExit }: GroundViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [viewer, setViewer] = useState<GroundViewer | null>(null);
  const [lost, setLost] = useState(false);
  const small = useMemo(() => window.innerWidth < SMALL_PX, []);
  const specs = small ? GROUND_LEVELS_SMALL : GROUND_LEVELS;
  const terrain = useGroundPatches(lat, lon, specs);

  const sun = bodyAt(sunTrack, timeMs);
  const earth = bodyAt(earthTrack, timeMs);

  // Face the Sun if it is anywhere near the horizon, else Earth, else south.
  const [look, setLook] = useState<Look>(() => {
    const base = { headingDeg: 180, pitchDeg: 2, fovDeg: FOV_DEFAULT_DEG };
    const target = sun && sun.el > -5 ? sun : earth;
    return target ? lookToward(base, target.az, target.el) : base;
  });
  const reduced = useMemo(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false, []);
  const [arrive, setArrive] = useState(reduced ? 1 : 0);
  const ready = terrain.status === "ready";

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const v = new GroundViewer(canvas, small, setLost);
    setViewer(v);
    return () => {
      v.dispose();
      setViewer(null);
    };
  }, [small]);

  useEffect(() => {
    if (!viewer || terrain.status !== "ready") return;
    viewer.setTerrain(buildGroundLevels(terrain.patches, specs).levels);
  }, [viewer, terrain, specs]);

  useEffect(() => viewer?.setSkyline(horizon, eyeM), [viewer, horizon, eyeM]);

  // The fly-down starts once the terrain is in.
  useEffect(() => {
    if (!ready || arrive >= 1) return;
    const t0 = performance.now() - arrive * ARRIVE_MS;
    let raf = requestAnimationFrame(function step(now) {
      const t = Math.min(1, (now - t0) / ARRIVE_MS);
      setArrive(t);
      if (t < 1) raf = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(raf);
    // Only on arrival; later changes of `arrive` come from this loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const [labels, setLabels] = useState<BodyLabel[]>([]);
  useEffect(() => {
    if (!viewer) return;
    const pose = arrive < 1 ? arrivalPose(arrive, look, eyeM) : standingPose(look, eyeM);
    viewer.draw({
      ...pose,
      toSun: sun?.dir ?? BELOW,
      toEarth: earth?.dir ?? BELOW,
      sunRadiusDeg: sun?.radius ?? 0.27,
      earthRadiusDeg: earth?.radius ?? 0.95,
    });
    const next: BodyLabel[] = [];
    for (const [body, b] of [["sun", sun], ["earth", earth]] as const) {
      if (!b) continue;
      const p = viewer.project(b.dir);
      if (p.onScreen) next.push({ body, x: p.x, y: p.y, elDeg: b.el, azDeg: b.az });
    }
    setLabels(next);
    // sun and earth are derived from the tracks and timeMs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, look, arrive, eyeM, sunTrack, earthTrack, timeMs]);

  // Dragging turns the view and ends the fly-down; the wheel narrows or widens it. The wheel is
  // ignored during the fly-down: it is usually the same scroll that zoomed the map past its limit.
  const drag = useRef<{ x: number; y: number } | null>(null);
  const settle = () => setArrive(1);
  const arriving = useRef(true);
  useEffect(() => {
    arriving.current = arrive < 1;
  }, [arrive]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (arriving.current) return;
      setLook((l) => zoomLook(l, e.deltaY));
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  const onKey = (e: React.KeyboardEvent) => {
    const h = canvasRef.current?.clientHeight ?? 600;
    const turn = (dx: number, dy: number) => setLook((l) => dragLook(l, dx, dy, h));
    const step = h / 12;
    const moves: Record<string, () => void> = {
      ArrowLeft: () => turn(step, 0),
      ArrowRight: () => turn(-step, 0),
      ArrowUp: () => turn(0, step),
      ArrowDown: () => turn(0, -step),
      "+": () => setLook((l) => zoomLook(l, -200)),
      "=": () => setLook((l) => zoomLook(l, -200)),
      "-": () => setLook((l) => zoomLook(l, 200)),
      Escape: onExit,
    };
    const move = moves[e.key];
    if (!move) return;
    e.preventDefault();
    settle();
    move();
  };

  return (
    <div className="ground">
      <canvas
        ref={canvasRef}
        className="ground-canvas"
        tabIndex={0}
        role="application"
        aria-label={`Standing at ${siteName}. Drag or use the arrow keys to look around, scroll or plus and minus to zoom, Escape to go back to the map.`}
        onKeyDown={onKey}
        onPointerDown={(e) => {
          settle();
          drag.current = { x: e.clientX, y: e.clientY };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const h = e.currentTarget.clientHeight;
          setLook((l) => dragLook(l, e.clientX - d.x, e.clientY - d.y, h));
          drag.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      />
      <GroundOverlay
        siteName={siteName}
        eyeM={eyeM}
        terrain={terrain}
        lost={lost}
        labels={labels}
        headingDeg={look.headingDeg}
        sun={sun}
        earth={earth}
        onFace={(b) => {
          settle();
          setLook((l) => lookToward(l, b.az, b.el));
        }}
        onExit={onExit}
      />
    </div>
  );
}
