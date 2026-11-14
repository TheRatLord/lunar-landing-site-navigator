import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { fetchTerrainPatch } from "../../../api/site";
import { ApiError, isAbort } from "../../../api/client";
import { IconButton } from "../../../components/ui/Button";
import { Select, Slider } from "../../../components/ui/Fields";
import { EmptyState } from "../../../components/ui/EmptyState";
import { Icon } from "../../../components/ui/Icon";
import { Popover } from "../../../components/ui/Popover";
import { Segmented } from "../../../components/ui/Segmented";
import { Spinner } from "../../../components/ui/Progress";
import { ServiceNotice } from "../../../components/ServiceNotice";
import { useColors } from "../../../components/viz/useColors";
import { cividis, cssGradient, viridis } from "../../../lib/colormaps";
import { formatNum, formatValue, glue } from "../../../lib/format";
import type { BlockerMark } from "../../../scenario/alternatives";
import type { Scenario } from "../../../scenario/types";
import type { ColorMode } from "./mesh";
import { SLOPE_FULL_SCALE_DEG, triangleCount } from "./mesh";
import { decodePatch, type Patch, PatchFormatError } from "./patch";
import { directionLabel, heightLegendText, slopeLegendText, sunLightText } from "./legend";
import type { Direction, SceneColors, SceneStats, TerrainScene } from "./scene";

interface Terrain3DProps {
  scenario: Scenario;
  sun: Direction | null;
  earth: Direction | null;
  blocker: BlockerMark | null;
}

const PATCH_SIZES_KM = [2, 5, 10, 20, 40] as const;
const MESH_SAMPLES = [129, 257, 513, 1025] as const;
const DEFAULT_SIZE_KM = 10;
const DEFAULT_SAMPLES = 257;

interface Loaded {
  key: string;
  patch: Patch;
  fetchMs: number;
  decodeMs: number;
  t0: number;
}

type Status = { kind: "loading-three" } | { kind: "ready" } | { kind: "unavailable"; message: string };

const sizeOptions = PATCH_SIZES_KM.map((k) => ({ value: String(k), label: `${k} km` }));
const meshOptions = MESH_SAMPLES.map((n) => ({ value: String(n), label: `${n} × ${n}` }));
const modeOptions = [
  { value: "height", label: "Height" },
  { value: "slope", label: "Slope" },
];

type Fetch = { loaded: Loaded | null; failed: { key: string; error: Error } | null };

function fetchReducer(s: Fetch, a: { type: "ok"; loaded: Loaded } | { type: "fail"; key: string; error: Error }): Fetch {
  return a.type === "ok" ? { loaded: a.loaded, failed: null } : { loaded: s.loaded, failed: { key: a.key, error: a.error } };
}

export default function Terrain3D({ scenario, sun, earth, blocker }: Terrain3DProps) {
  const colors = useColors();
  const [sizeKm, setSizeKm] = useState<number>(DEFAULT_SIZE_KM);
  const [samples, setSamples] = useState<number>(DEFAULT_SAMPLES);
  const [mode, setMode] = useState<ColorMode>("height");
  const [exag, setExag] = useState(1);
  const [status, setStatus] = useState<Status>({ kind: "loading-three" });
  const [scene, setScene] = useState<TerrainScene | null>(null);
  const [fetched, dispatch] = useReducer(fetchReducer, { loaded: null, failed: null });
  const [retry, bump] = useReducer((n: number) => n + 1, 0);
  const [stats, setStats] = useState<SceneStats | null>(null);
  const [totalMs, setTotalMs] = useState<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const lat = scenario.site.lat_deg;
  const lon = scenario.site.lon_deg;
  const key = `${lat}|${lon}|${sizeKm}|${samples}|${retry}`;
  const mast = scenario.profile.array_height_m;

  const sceneColors = useMemo<SceneColors>(
    () => ({
      sky: colors.get("sky"),
      text: colors.get("text"),
      textBg: colors.get("panel"),
      sun: colors.get("c-sun"),
      earth: colors.get("c-earth"),
      accent: colors.get("accent"),
      blocker: colors.get("c-fail"),
      ring: colors.get("text-3"),
    }),
    [colors],
  );
  const latest = useRef({ mode, mast, exag, sceneColors, sun, earth, blocker });
  useEffect(() => {
    latest.current = { mode, mast, exag, sceneColors, sun, earth, blocker };
  });

  useEffect(() => {
    let created: TerrainScene | null = null;
    let observer: ResizeObserver | null = null;
    let dead = false;
    void import("./scene").then(
      (m) => {
        const canvas = canvasRef.current;
        if (dead || !canvas) return;
        try {
          created = new m.TerrainScene(canvas, latest.current.sceneColors);
        } catch (e) {
          setStatus({ kind: "unavailable", message: e instanceof Error ? e.message : String(e) });
          return;
        }
        const box = boxRef.current;
        observer = new ResizeObserver(([entry]) => {
          const r = entry!.contentRect;
          created?.resize(r.width, r.height);
        });
        if (box) {
          observer.observe(box);
          created.resize(box.clientWidth, box.clientHeight);
        }
        const s = created;
        const win = window as unknown as { __terrain3d?: { benchmark: (frames?: number) => Promise<unknown> } };
        if (import.meta.env.DEV) win.__terrain3d = { benchmark: (f) => s.benchmark(f) };
        setScene(s);
        setStatus({ kind: "ready" });
      },
      (e: unknown) => setStatus({ kind: "unavailable", message: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      dead = true;
      observer?.disconnect();
      created?.dispose();
      setScene(null);
    };
  }, []);

  useEffect(() => {
    const ctl = new AbortController();
    const t0 = performance.now();
    fetchTerrainPatch({ lat, lon, size_m: sizeKm * 1000, n: samples }, ctl.signal).then(
      (buf) => {
        const t1 = performance.now();
        try {
          const patch = decodePatch(buf);
          dispatch({ type: "ok", loaded: { key, patch, fetchMs: t1 - t0, decodeMs: performance.now() - t1, t0 } });
        } catch (e) {
          dispatch({ type: "fail", key, error: e instanceof Error ? e : new Error(String(e)) });
        }
      },
      (e: unknown) => {
        if (ctl.signal.aborted || isAbort(e)) return;
        dispatch({ type: "fail", key, error: e instanceof Error ? e : new Error(String(e)) });
      },
    );
    return () => ctl.abort();
  }, [lat, lon, sizeKm, samples, key]);

  const loaded = fetched.loaded;
  const failed = fetched.failed?.key === key ? fetched.failed.error : null;
  const loading = !failed && loaded?.key !== key;

  useEffect(() => {
    if (!scene || !loaded || loaded.key !== key) return;
    const raf = requestAnimationFrame(() => {
      const l = latest.current;
      const light = l.sun ? { sunAz_deg: l.sun.az_deg, sunEl_deg: l.sun.el_deg } : null;
      scene.setPatch(loaded.patch, l.mode, light, l.mast);
      scene.setExaggeration(l.exag);
      scene.setBlocker(blockerView(l.blocker));
      scene.setDirections(l.sun, l.earth);
      const first = scene.renderSync();
      const total = performance.now() - loaded.t0;
      const st = scene.stats();
      setStats(st);
      setTotalMs(total);
      const box = boxRef.current;
      if (box) {
        box.dataset["loadTotalMs"] = total.toFixed(0);
        box.dataset["fetchMs"] = loaded.fetchMs.toFixed(0);
        box.dataset["decodeMs"] = loaded.decodeMs.toFixed(1);
        box.dataset["buildMs"] = (st?.buildMs ?? 0).toFixed(0);
        box.dataset["shadeMs"] = (st?.shadeMs ?? 0).toFixed(0);
        box.dataset["firstFrameMs"] = first.toFixed(0);
        box.dataset["triangles"] = String(st?.triangles ?? 0);
        box.dataset["samples"] = String(loaded.patch.n);
        box.dataset["ready"] = "1";
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [scene, loaded, key]);

  useEffect(() => {
    scene?.setColors(sceneColors);
  }, [scene, sceneColors]);
  useEffect(() => {
    scene?.setColorMode(mode);
  }, [scene, mode]);
  useEffect(() => {
    scene?.setExaggeration(exag);
  }, [scene, exag]);
  useEffect(() => {
    scene?.setBlocker(blockerView(blocker));
  }, [scene, blocker]);
  useEffect(() => {
    scene?.setDirections(sun, earth);
  }, [scene, sun, earth]);
  useEffect(() => {
    scene?.setMast(mast);
  }, [scene, mast]);

  const sunAz = sun?.az_deg;
  const sunEl = sun?.el_deg;
  useEffect(() => {
    if (!scene) return;
    const id = window.setTimeout(() => {
      const st = scene.setLight(sunAz !== undefined && sunEl !== undefined ? { sunAz_deg: sunAz, sunEl_deg: sunEl } : null);
      if (st) setStats(st);
    }, 90);
    return () => window.clearTimeout(id);
  }, [scene, sunAz, sunEl]);

  const header = loaded?.patch.header;
  const shownStats = stats && loaded && stats.patch === loaded.patch ? stats : null;
  const spacing = header?.spacing_m;
  const srcRes = header?.effective_resolution_m;
  const err = failed instanceof ApiError ? failed : null;

  const noData = shownStats && shownStats.nodata > 0 ? (100 * shownStats.nodata) / (shownStats.vertices || 1) : null;
  const sunState = sun === null || !Number.isFinite(sun.el_deg) ? "no Sun data" : !(sun.el_deg > 0) ? "Sun below horizon" : null;

  return (
    <div className="site-stage t3">
      <div className="t3-box" ref={boxRef}>
        <canvas
          ref={canvasRef}
          className="t3-canvas"
          tabIndex={0}
          aria-label={`3D terrain of the site. Drag to orbit, wheel to zoom, right-drag or arrow keys to pan. Vertical exaggeration ×${exag}.`}
        />
        <div className="t3-controls" role="toolbar" aria-label="3D view controls">
          <Segmented label="Colour by" size="sm" value={mode} onChange={(v) => setMode(v === "slope" ? "slope" : "height")} options={modeOptions} />
          <Select aria-label="Patch size" value={String(sizeKm)} options={sizeOptions} onChange={(v) => setSizeKm(Number(v))} />
          <Select aria-label="Mesh samples per side" value={String(samples)} options={meshOptions} onChange={(v) => setSamples(Number(v))} />
          <div className="t3-slider">
            <Slider label="Exaggeration" value={exag} min={1} max={10} step={0.5} onChange={setExag} format={(v) => `×${v}`} />
          </div>
          <IconButton icon="reset" label="Reset camera" size="sm" onClick={() => scene?.resetCamera()} disabled={!scene} />
          {header && shownStats && (
            <Popover label="About this view" icon="info" align="end" width={380}>
              <div className="site-basis">
                <p>{mode === "height" ? heightLegendText(header.size_m, header.radius_m || undefined) : slopeLegendText(spacing ?? 0, header.size_m, header.radius_m || undefined)}</p>
                <p>
                  Shading and hard shadows are computed on the true surface, not the exaggerated one; shadows are the Sun centre's terrain shadow (no penumbra) tested every{" "}
                  {shownStats.shadowN ? formatNum(((header.n ?? 1) - 1) / (shownStats.shadowN - 1), 0) : "1"} grid step(s); the lander pin is drawn larger than the mast.
                  {triangleCount(samples) > 1_000_000 ? " This mesh size is for desktop GPUs." : ""}
                </p>
                <p className="faint num">{sunLightText(sun ? sun.el_deg : null, 100 * shownStats.shadowedFraction, shownStats.shadowN).replace(/^ · /, "")}</p>
              </div>
            </Popover>
          )}
        </div>
        {status.kind === "unavailable" && (
          <div className="t3-overlay" role="alert">
            <EmptyState icon="terrain" title="3D unavailable" />
            <p className="faint num">{status.message}</p>
          </div>
        )}
        {status.kind !== "unavailable" && (loading || status.kind === "loading-three") && !failed && (
          <div className="t3-overlay t3-overlay-soft" role="status">
            <Spinner size={14} />
            <span className="num faint">
              {sizeKm} km · {samples}²
            </span>
          </div>
        )}
        {failed && (
          <div className="t3-overlay" role="alert">
            {err ? (
              <ServiceNotice error={err} what="the terrain patch" onRetry={bump} />
            ) : (
              <div>
                <strong>{failed instanceof PatchFormatError ? "Could not read the terrain patch" : "Could not load the terrain patch"}</strong>
                <p>{failed.message}</p>
              </div>
            )}
          </div>
        )}
        {noData !== null && (
          <div className="t3-badge chip chip-marginal num" role="status">
            <Icon name="warn" size={12} />
            {formatValue(noData, "%", 1)} no data
          </div>
        )}
        {header && shownStats && (
          <>
            <div className="t3-legend" aria-label="Colour legend">
              {mode === "height" ? (
                <>
                  <span className="num">{formatValue(shownStats.heightMin, "m", 0)}</span>
                  <i style={{ background: cssGradient(cividis, 9) }} />
                  <span className="num">{formatValue(shownStats.heightMax, "m", 0)}</span>
                </>
              ) : (
                <>
                  <span className="num">0°</span>
                  <i style={{ background: cssGradient(viridis, 9) }} />
                  <span className="num">{glue(`≥ ${SLOPE_FULL_SCALE_DEG}°`)}</span>
                </>
              )}
            </div>
            <p className="sr-only t3-directions">{[sun && directionLabel("Sun", sun), earth && directionLabel("Earth", earth)].filter(Boolean).join(" · ")}</p>
            <div className="t3-stats num" aria-label="Rendering statistics">
              <span>
                {formatNum(header.size_m / 1000, header.size_m % 1000 === 0 ? 0 : 1)} km · {formatNum(spacing ?? 0, 1)} m grid{srcRes != null && Number.isFinite(srcRes) ? ` · source ${formatNum(srcRes, 1)} m` : ""}
              </span>
              <span>
                {formatNum(shownStats.triangles / 1000, 0)} k triangles · {header.n}² samples
                {sunState ? ` · ${sunState}` : Number.isFinite(shownStats.shadowedFraction) ? ` · ${formatValue(100 * shownStats.shadowedFraction, "%", 1)} shadow` : ""}
                {totalMs !== null ? ` · ${formatValue(totalMs, "ms", 0)}` : ""}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function blockerView(b: BlockerMark | null) {
  return b ? { az_deg: b.azimuth_deg, dist_m: b.distance_m, label: b.label } : null;
}
