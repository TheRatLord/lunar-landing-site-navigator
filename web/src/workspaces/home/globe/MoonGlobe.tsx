import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import type { SearchRow } from "../../../api/search";
import { terrainApi } from "../../../api/terrain";
import { useLoad } from "../../../api/useLoad";
import { Button, IconButton } from "../../../components/ui/Button";
import { formatLat, formatLon } from "../../../lib/coords";
import { siteLabel } from "../../../lib/siteName";
import type { SiteEntry } from "../../../scenario/api";
import type { AltMark } from "../../map/engine";
import { STATE_WORD } from "../../map/overlays";
import { dayText } from "../survey";
import { CELL_COLOR, cellAt, circle, latticeMesh, type Cell, type Lattice } from "./lattice";
import { MoonScene, type Hit, type Marker, type ViewInfo } from "./MoonScene";
import type { Rect } from "../../map/rect";
import { EARTH_COLOR, PICK_COLOR, PIN_COLOR, PLAN_COLOR, bySalience, clusterRect, clusterSites, labelCandidates, layoutClusters, layoutLabels, siteLines, siteMarkers, siteSummary, spreadOf, type SiteGroup } from "./marks";
import { polarCap, viewPatch } from "./patches";
import { subpointsAt, type Subpoints } from "./subpoints";
import { useClock } from "../clock";
import { MS_HOUR } from "../../../lib/time";

const loadTilesets = (signal: AbortSignal) => terrainApi.tilesets({ signal });

export interface GlobeFocus {
  lat_deg: number;
  lon_deg: number;
  radius_m: number | null;
  nonce: number;
}

type Popup =
  | { kind: "cell"; cell: Cell }
  | { kind: "point"; lat_deg: number; lon_deg: number }
  | { kind: "site"; site: SiteEntry }
  | { kind: "cluster"; sites: SiteEntry[] }
  | { kind: "pin"; pin: AltMark };

interface MoonGlobeProps {
  site: { lat_deg: number; lon_deg: number; name: string };
  centre?: { lat_deg: number; lon_deg: number };
  preview?: { lat_deg: number; lon_deg: number } | null;
  focus: GlobeFocus;
  sites: SiteEntry[];
  pins: AltMark[];
  timeMs: number;
  sub: Subpoints | null;
  areaRadius_m: number | null;
  lattice: Lattice | null;
  latticeStale: boolean;
  ranked: SearchRow[];
  onPickSite(id: string): void;
  onSetPoint(lat_deg: number, lon_deg: number): void;
  onUseCell(cell: Cell, withDate: boolean): void;
  onPickPin(pin: AltMark): void;
}

const WHOLE = null;
type CapKind = "south" | "north";
const CAP_DEG = 22;
const sameView = (a: ViewInfo, b: ViewInfo): boolean =>
  Math.abs(a.lat_deg - b.lat_deg) < 0.02 && Math.abs(((a.lon_deg - b.lon_deg + 540) % 360) - 180) < 0.05 && Math.abs(a.half_m / b.half_m - 1) < 0.05 && a.px === b.px;
const MAX_DETAIL_M = 700_000;
const contextView = (r: number | null): number => Math.max(20_000, (r ?? 0) * 4);
const tightView = (r: number): number => Math.max(3_000, r * 1.35);
const SITE_VIEW_M = 15_000;

function utcText(ms: number): string {
  const d = new Date(ms);
  return `${dayText(ms, true)}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}

function cellWords(c: Cell): { title: string; lines: string[] } {
  if (c.status === "steep") return { title: "Too steep or rough", lines: ["Left out before the full check: the slope limit rules it out."] };
  if (c.status !== "full") return { title: "Not checked in full", lines: ["A quick, optimistic first pass ranked it too low to check in full. Treat it as unknown, not as a fail."] };
  const lines: string[] = [];
  if (c.best_ms !== null) lines.push(`${c.nEpochs > 1 ? "Best landing" : "Landing"} ${utcText(c.best_ms)}`);
  if (c.nEpochs > 1 && c.nPass !== null) lines.push(`Passes at ${c.nPass} of ${c.nEpochs} landing times searched`);
  if (c.slope_deg !== null) lines.push(`Slope ${c.slope_deg.toFixed(1)}°`);
  return { title: STATE_WORD[c.state], lines };
}

export function MoonGlobe(props: MoonGlobeProps) {
  const { site, focus, sites, pins, timeMs, sub, areaRadius_m, lattice, latticeStale, ranked } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => bySalience(sites), [sites]);
  const shownRef = useRef(shown);
  useLayoutEffect(() => {
    shownRef.current = shown;
  });
  const cands = useMemo(() => labelCandidates(shown, pins, site), [shown, pins, site]);
  const popRef = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState<MoonScene | null>(null);
  const [popup, setPopup] = useState<Popup | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const tilesets = useLoad(loadTilesets);
  const tilesetList = tilesets.state.status === "ready" ? tilesets.state.data.tilesets : null;
  const renderVersion = tilesets.state.status === "ready" ? tilesets.state.data.render_version : "";
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let s: MoonScene;
    try {
      s = new MoonScene(canvas);
    } catch {
      return;
    }
    const p = latest.current;
    s.flyTo(p.site.lat_deg, p.site.lon_deg, WHOLE, true);
    setScene(s);
    return () => {
      s.dispose();
      setScene(null);
    };
  }, []);

  const popupAnchor = useMemo<[number, number] | null>(() => {
    if (!popup) return null;
    if (popup.kind === "cell") return [popup.cell.lat_deg, popup.cell.lon_deg];
    if (popup.kind === "point") return [popup.lat_deg, popup.lon_deg];
    if (popup.kind === "site") return [popup.site.lat_deg, popup.site.lon_deg];
    if (popup.kind === "cluster") {
      const c = spreadOf(popup.sites);
      return [c.lat_deg, c.lon_deg];
    }
    return [popup.pin.lat_deg, popup.pin.lon_deg];
  }, [popup]);

  const clusterHost = useRef<HTMLDivElement>(null);
  const groupsRef = useRef<SiteGroup[]>([]);
  const drawn = useRef<{ key: string; of: SiteEntry[] | null; index: number[] }>({ key: "", of: null, index: [] });

  const place = useCallback(() => {
    if (!scene) return;
    const lab = labelRef.current;
    const box = lab?.parentElement;
    if (lab && box) {
      const { groups, clustered } = clusterSites(shown, (la, lo) => scene.screenOf(la, lo), box.clientWidth, box.clientHeight, scene.screenOf(site.lat_deg, site.lon_deg));
      groupsRef.current = groups;
      const key = groups.map((g) => g.members.join(",")).join("|");
      if (drawn.current.of !== shown || drawn.current.key !== key) {
        const index = shown.map((_, i) => i).filter((i) => !clustered.has(i));
        drawn.current = { key, of: shown, index };
        scene.setMarkers("sites", siteMarkers(index.map((i) => shown[i]!)));
      }
      if (clusterHost.current) layoutClusters(clusterHost.current, groups, shown);
      const hidden = new Set([...clustered].map((i) => `site:${shown[i]!.id}`));
      const r0 = box.getBoundingClientRect();
      const hero = box.closest(".home-hero");
      const obstacles: Rect[] = [];
      hero?.querySelectorAll(".home-finder, .home-sky-note, .globe-tools").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width > 0) obstacles.push([r.left - r0.left, r.top - r0.top, r.right - r0.left, r.bottom - r0.top]);
      });
      for (const g of groups) obstacles.push(clusterRect(g));
      layoutLabels(lab, hidden.size ? cands.filter((c) => !hidden.has(c.id)) : cands, (la, lo) => scene.screenOf(la, lo), obstacles, box.clientWidth, box.clientHeight);
    }
    const pop = popRef.current;
    if (pop && popupAnchor) {
      const s = scene.screenOf(popupAnchor[0], popupAnchor[1]);
      pop.style.display = s ? "" : "none";
      if (s) {
        const box = pop.parentElement;
        const W = box?.clientWidth ?? 0;
        const H = box?.clientHeight ?? 0;
        const w = pop.offsetWidth;
        const h = pop.offsetHeight;
        const x = s[0] + 12 + w > W - 8 ? s[0] - 12 - w : s[0] + 12;
        const y = s[1] + 12 + h > H - 8 ? s[1] - 12 - h : s[1] + 12;
        pop.style.transform = `translate(${Math.round(Math.max(8, x))}px, ${Math.round(Math.max(8, y))}px)`;
      }
    }
  }, [scene, popupAnchor, cands, shown, site.lat_deg, site.lon_deg]);

  useLayoutEffect(() => {
    if (!scene) return;
    scene.setHandlers({ view: place });
    place();
  }, [scene, place]);

  useEffect(() => {
    if (!scene) return;
    const click = (h: Hit) => {
      const p = latest.current;
      setTip(null);
      if (h.kind === "marker") {
        if (h.layer === "sites") {
          const s = shownRef.current[drawn.current.index[h.index] ?? -1];
          if (s) setPopup({ kind: "site", site: s });
        } else if (h.layer === "pins") {
          const pin = p.pins[h.index];
          if (pin) setPopup({ kind: "pin", pin });
        } else if (h.layer === "ranked") {
          const r = p.ranked[h.index];
          const c = r && p.lattice ? cellAt(p.lattice, r.lat_deg, r.lon_deg) : null;
          if (c) setPopup({ kind: "cell", cell: c });
        } else {
          setPopup(null);
        }
        return;
      }
      const c = p.lattice ? cellAt(p.lattice, h.lat_deg, h.lon_deg) : null;
      setPopup(c ? { kind: "cell", cell: c } : { kind: "point", lat_deg: h.lat_deg, lon_deg: h.lon_deg });
    };
    const hover = (h: Hit | null) => {
      const p = latest.current;
      if (!h) return setTip(null);
      if (h.kind === "marker") {
        const text =
          h.layer === "sites"
            ? (() => {
                const s = shownRef.current[drawn.current.index[h.index] ?? -1];
                return s ? `${siteLabel(s.name)} · ${siteSummary(s)}` : "";
              })()
            : h.layer === "pins"
              ? `Pinned: ${siteLabel(p.pins[h.index]?.name ?? "")}`
              : h.layer === "ranked"
                ? `#${p.ranked[h.index]?.rank ?? ""} · ${STATE_WORD[p.ranked[h.index]?.state ?? "unknown"]}`
                : h.index === 1
                  ? "Earth is overhead here"
                  : siteLabel(p.site.name) || "Plan site";
        return setTip({ x: h.x, y: h.y, text });
      }
      const c = p.lattice ? cellAt(p.lattice, h.lat_deg, h.lon_deg) : null;
      if (c) {
        const w = cellWords(c);
        return setTip({ x: h.x, y: h.y, text: c.status === "full" && c.nEpochs > 1 && c.nPass !== null ? `${w.title} · ${c.nPass}/${c.nEpochs} times` : w.title });
      }
      setTip({ x: h.x, y: h.y, text: `${formatLat(h.lat_deg, 2)} ${formatLon(h.lon_deg, 2)}` });
    };
    scene.setHandlers({ click, hover });
  }, [scene]);

  useEffect(() => {
    if (!scene || !sub) return;
    const apply = (t: number) => {
      const at = subpointsAt(sub, t);
      if (at) scene.setSun(at.sun[0], at.sun[1]);
    };
    apply(useClock.getState().t_ms ?? timeMs);
    return useClock.subscribe((c) => apply(c.t_ms ?? timeMs));
  }, [scene, sub, timeMs]);

  const earthStep = useClock((c) => Math.round((c.t_ms ?? timeMs) / (6 * MS_HOUR)));
  const earthMark = useMemo<Marker[]>(() => {
    const at = sub ? subpointsAt(sub, earthStep * 6 * MS_HOUR) : null;
    return at ? [{ lat_deg: at.earth[0], lon_deg: at.earth[1], color: EARTH_COLOR, size: 11 }] : [];
  }, [sub, earthStep]);

  const previewLat = props.preview?.lat_deg ?? null;
  const previewLon = props.preview?.lon_deg ?? null;
  useEffect(() => {
    scene?.setMarkers("hover", previewLat === null || previewLon === null ? [] : [{ lat_deg: previewLat, lon_deg: previewLon, color: PICK_COLOR, size: 34, shape: "ring" }]);
  }, [scene, previewLat, previewLon]);

  const playing = useClock((c) => c.playing);
  const setPlaying = useClock((c) => c.setPlaying);

  useEffect(() => {
    if (!scene) return;
    scene.setMarkers("plan", [
      { lat_deg: site.lat_deg, lon_deg: site.lon_deg, color: PLAN_COLOR, size: 28, shape: "target" },
      ...earthMark,
    ]);
    place();
  }, [scene, site.lat_deg, site.lon_deg, earthMark, place]);

  const pick = popup?.kind === "point" ? ([popup.lat_deg, popup.lon_deg] as const) : popup?.kind === "cell" ? ([popup.cell.lat_deg, popup.cell.lon_deg] as const) : null;
  const pickLat = pick?.[0] ?? null;
  const pickLon = pick?.[1] ?? null;
  useEffect(() => {
    scene?.setMarkers("pick", pickLat === null || pickLon === null ? [] : [{ lat_deg: pickLat, lon_deg: pickLon, color: PICK_COLOR, size: 26, shape: "target" }]);
  }, [scene, pickLat, pickLon]);

  useEffect(() => {
    scene?.setMarkers(
      "pins",
      pins.map((p) => ({ lat_deg: p.lat_deg, lon_deg: p.lon_deg, color: PIN_COLOR, size: 18, shape: "pin" })),
    );
  }, [scene, pins]);

  useEffect(() => {
    scene?.setMarkers(
      "ranked",
      latticeStale ? [] : ranked.map((r) => ({ lat_deg: r.lat_deg, lon_deg: r.lon_deg, color: CELL_COLOR[r.state], size: 18, shape: "ring" })),
    );
  }, [scene, ranked, latticeStale]);

  const cells = useMemo(() => (lattice ? latticeMesh(lattice) : null), [lattice]);
  useEffect(() => {
    scene?.setCells(cells, latticeStale);
  }, [scene, cells, latticeStale]);

  const ringCentre = lattice ? { lat: lattice.lat0, lon: lattice.lon0, r: lattice.radius_m } : { lat: (props.centre ?? site).lat_deg, lon: (props.centre ?? site).lon_deg, r: areaRadius_m };
  useEffect(() => {
    scene?.setRing(ringCentre.r ? circle(ringCentre.lat, ringCentre.lon, ringCentre.r) : null);
  }, [scene, ringCentre.lat, ringCentre.lon, ringCentre.r]);

  const [view, setView] = useState<ViewInfo | null>(null);
  useEffect(() => {
    scene?.setHandlers({ settle: (v) => setView((prev) => (prev && sameView(prev, v) ? prev : v)) });
  }, [scene]);

  const home: CapKind = site.lat_deg < 0 ? "south" : "north";
  const other: CapKind = home === "south" ? "north" : "south";
  const showOther = view !== null && 90 + (other === "north" ? -view.lat_deg : view.lat_deg) - CAP_DEG < (Math.acos(1 / (1 + view.alt)) * 180) / Math.PI;
  const capLoad = useRef<{ ctl: AbortController; done: Set<CapKind> } | null>(null);

  useEffect(() => {
    if (!scene || !tilesetList) return;
    const run = { ctl: new AbortController(), done: new Set<CapKind>() };
    capLoad.current = run;
    return () => {
      run.ctl.abort();
      if (capLoad.current === run) capLoad.current = null;
    };
  }, [scene, tilesetList, renderVersion]);

  useEffect(() => {
    const run = capLoad.current;
    if (!scene || !tilesetList || !run) return;
    for (const kind of showOther ? [home, other] : [home]) {
      if (run.done.has(kind)) continue;
      run.done.add(kind);
      polarCap(kind, tilesetList, renderVersion, run.ctl.signal).then(
        (p) => {
          if (!run.ctl.signal.aborted) scene.setPatch(kind, p);
        },
        () => run.done.delete(kind),
      );
    }
  }, [scene, tilesetList, renderVersion, home, other, showOther]);
  useEffect(() => {
    if (!scene || !tilesetList || !view) return;
    if (view.half_m > MAX_DETAIL_M) {
      scene.setPatch("view", null, true);
      return;
    }
    const ctl = new AbortController();
    viewPatch(tilesetList, renderVersion, view.lat_deg, view.lon_deg, view.half_m, view.px, ctl.signal).then(
      (p) => {
        if (!ctl.signal.aborted && p) scene.setPatch("view", p, true);
      },
      () => undefined,
    );
    return () => ctl.abort();
  }, [scene, tilesetList, renderVersion, view]);

  useEffect(() => {
    if (!scene || focus.nonce === 0) return;
    scene.flyTo(focus.lat_deg, focus.lon_deg, focus.radius_m === null ? WHOLE : focus.radius_m > 0 ? tightView(focus.radius_m) : contextView(latest.current.areaRadius_m));
  }, [scene, focus]);

  const [popupFor, setPopupFor] = useState(lattice);
  if (popupFor !== lattice) {
    setPopupFor(lattice);
    setPopup(null);
  }

  const close = () => setPopup(null);
  const goTo = (s: SiteEntry) => {
    scene?.flyTo(s.lat_deg, s.lon_deg, SITE_VIEW_M);
    setPopup({ kind: "site", site: s });
  };
  const openCluster = (e: MouseEvent<HTMLDivElement>) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>(".globe-cluster");
    const g = el ? groupsRef.current[Number(el.dataset["index"])] : undefined;
    if (!g) return;
    setTip(null);
    setPopup({ kind: "cluster", sites: g.members.map((i) => shown[i]!) });
  };
  const words = popup?.kind === "cell" ? cellWords(popup.cell) : null;

  return (
    <div className="globe">
      <canvas ref={canvasRef} className="globe-canvas" role="img" aria-label="3D Moon with the plan's site, catalogue sites and search results. Drag to turn, scroll to zoom, click a point for details." />
      <div ref={labelRef} className="globe-labels" aria-hidden />
      <div ref={clusterHost} className="globe-clusters" onClick={openCluster} />
      {tip && !popup && (
        <div className="globe-tip" style={{ transform: `translate(${tip.x + 12}px, ${tip.y - 28}px)` }} aria-hidden>
          {tip.text}
        </div>
      )}
      {popup && (
        <div ref={popRef} className="globe-pop" role="dialog" aria-label="Point details">
          <IconButton icon="close" size="sm" label="Close" className="globe-pop-close" onClick={close} />
          {popup.kind === "cell" && words && (
            <>
              <p className="globe-pop-title" data-tone={popup.cell.status === "full" ? popup.cell.state : "unknown"}>
                {words.title}
              </p>
              {words.lines.map((l) => (
                <p key={l} className="globe-pop-line">
                  {l}
                </p>
              ))}
              <p className="globe-pop-coord">
                {formatLat(popup.cell.lat_deg, 3)} {formatLon(popup.cell.lon_deg, 3)}
              </p>
              <div className="globe-pop-actions">
                {popup.cell.best_ms !== null && popup.cell.nEpochs > 1 && (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => {
                      props.onUseCell(popup.cell, true);
                      close();
                    }}
                  >
                    Land here on {dayText(popup.cell.best_ms)}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant={popup.cell.best_ms !== null && popup.cell.nEpochs > 1 ? "default" : "primary"}
                  onClick={() => {
                    props.onUseCell(popup.cell, false);
                    close();
                  }}
                >
                  Move site here
                </Button>
              </div>
            </>
          )}
          {popup.kind === "point" && (
            <>
              <p className="globe-pop-title">{`${formatLat(popup.lat_deg, 3)} ${formatLon(popup.lon_deg, 3)}`}</p>
              <div className="globe-pop-actions">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    props.onSetPoint(popup.lat_deg, popup.lon_deg);
                    close();
                  }}
                >
                  Move site here
                </Button>
              </div>
            </>
          )}
          {popup.kind === "site" && (
            <>
              <p className="globe-pop-title">{siteLabel(popup.site.name)}</p>
              {siteLines(popup.site).map((l) => (
                <p key={l} className="globe-pop-line">
                  {l}
                </p>
              ))}
              <p className="globe-pop-coord">
                {formatLat(popup.site.lat_deg, 3)} {formatLon(popup.site.lon_deg, 3)}
              </p>
              <div className="globe-pop-actions">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    props.onPickSite(popup.site.id);
                    close();
                  }}
                >
                  Use this site
                </Button>
                <Button size="sm" icon="target" onClick={() => scene?.flyTo(popup.site.lat_deg, popup.site.lon_deg, SITE_VIEW_M)}>
                  Go to
                </Button>
              </div>
            </>
          )}
          {popup.kind === "cluster" && (
            <>
              <p className="globe-pop-title">{popup.sites.length} sites</p>
              <ul className="globe-pop-list">
                {popup.sites.map((s) => (
                  <li key={s.id}>
                    <span className="globe-pop-list-text">
                      <span className="globe-pop-list-name">{siteLabel(s.name)}</span>
                      <span className="globe-pop-list-sub">{siteSummary(s)}</span>
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => goTo(s)}>
                      Go to
                    </Button>
                  </li>
                ))}
              </ul>
              <div className="globe-pop-actions">
                <Button
                  size="sm"
                  variant="primary"
                  icon="plus"
                  onClick={() => {
                    const c = spreadOf(popup.sites);
                    scene?.flyTo(c.lat_deg, c.lon_deg, Math.max(3_000, c.radius_m * 1.6));
                    close();
                  }}
                >
                  Zoom to these
                </Button>
              </div>
            </>
          )}
          {popup.kind === "pin" && (
            <>
              <p className="globe-pop-title">{siteLabel(popup.pin.name)}</p>
              <p className="globe-pop-line">Pinned for comparison</p>
              <div className="globe-pop-actions">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    props.onPickPin(popup.pin);
                    close();
                  }}
                >
                  Use this site
                </Button>
              </div>
            </>
          )}
        </div>
      )}
      <div className="globe-tools toolstrip">
        <IconButton icon={playing ? "pause" : "play"} size="sm" label={playing ? "Pause sunlight" : "Play sunlight over the stay"} onClick={() => setPlaying(!playing)} />
        <IconButton icon="plus" size="sm" label="Zoom in" onClick={() => scene?.zoomBy(0.5)} />
        <IconButton icon="minus" size="sm" label="Zoom out" onClick={() => scene?.zoomBy(2)} />
        <IconButton icon="target" size="sm" label="Centre on the site" onClick={() => scene?.flyTo(site.lat_deg, site.lon_deg, contextView(areaRadius_m ?? lattice?.radius_m ?? null))} />
        <IconButton icon="moon" size="sm" label="Whole Moon" onClick={() => scene?.flyTo(site.lat_deg, site.lon_deg, WHOLE)} />
      </div>
    </div>
  );
}
