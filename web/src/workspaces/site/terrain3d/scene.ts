import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  LineLoop,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { disposeTree } from "../../../lib/three";
import {
  colorize,
  dirFromAzEl,
  edgeDistance,
  heightAtOffset,
  indices,
  offsetAt,
  positions,
  shadingOf,
  shadowMask,
  surfaceGrid,
  type ColorMode,
  type Grid,
  type LightState,
  type Shading,
  type ShadowMask,
} from "./mesh";
import { formatNum } from "../../../lib/format";
import { directionLabel } from "./legend";
import type { Patch } from "./patch";

export interface SceneColors {
  sky: string;
  text: string;
  textBg: string;
  sun: string;
  earth: string;
  accent: string;
  blocker: string;
  ring: string;
}

interface BlockerView {
  az_deg: number;
  dist_m: number;
  label: string;
}

export interface Direction {
  az_deg: number;
  el_deg: number;
}

export interface SceneStats {
  triangles: number;
  vertices: number;
  shadowN: number;
  shadowedFraction: number;
  sunUp: boolean;
  shadeMs: number;
  buildMs: number;
  heightMin: number;
  heightMax: number;
  patch: Patch;
  nodata: number;
}

interface BenchResult {
  frames: number;
  msPerFrame: number;
  triangles: number;
}

const TAU = Math.PI * 2;
const LABEL_H = 0.024;

function label(text: string, color: string, bg: string, anchor = 0.5): Sprite {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  const font = '600 22px "IBM Plex Mono", ui-monospace, monospace';
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 16;
  c.width = w;
  c.height = 34;
  ctx.font = font;
  ctx.fillStyle = bg;
  ctx.globalAlpha = 0.82;
  ctx.fillRect(0, 0, w, 34);
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.fillText(text, 8, 18);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  const s = new Sprite(new SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false }));
  s.userData["aspect"] = w / 34;
  s.center.set(anchor, 0.5);
  s.renderOrder = 10;
  return s;
}

export class TerrainScene {
  readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(40, 1, 1, 1e6);
  private readonly controls: OrbitControls;
  private readonly ground = new Group();
  private readonly sky = new Group();
  private terrain: Group | null = null;
  private colorAttr: BufferAttribute | null = null;
  private grid: Grid | null = null;
  private shading: Shading | null = null;
  private mask: ShadowMask | null = null;
  private mode: ColorMode = "height";
  private light: LightState | null = null;
  private mast = 0;
  private blockerView: BlockerView | null = null;
  private dirs: { sun: Direction | null; earth: Direction | null } = { sun: null, earth: null };
  private exag = 1;
  private colors: SceneColors;
  private raf = 0;
  private disposed = false;
  private width = 1;
  private height = 1;
  private lastStats: SceneStats | null = null;
  onFrame: ((cpuMs: number) => void) | null = null;

  constructor(canvas: HTMLCanvasElement, colors: SceneColors) {
    this.colors = colors;
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "default" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(new Color(colors.sky));
    this.scene.add(this.ground, this.sky);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = false;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.addEventListener("change", () => this.requestRender());
    canvas.addEventListener("webglcontextlost", (e) => e.preventDefault());
    canvas.addEventListener("webglcontextrestored", () => this.requestRender());
  }

  setPatch(p: Patch, mode: ColorMode, light: LightState | null, mastHeight_m: number): SceneStats {
    const t0 = performance.now();
    if (this.terrain) {
      disposeTree(this.terrain);
      this.ground.remove(this.terrain);
    }
    const g = surfaceGrid(p);
    this.grid = g;
    this.applyExaggeration();
    this.shading = shadingOf(g);
    this.mode = mode;
    this.light = light;
    this.mast = mastHeight_m;
    const { index, triangles } = indices(g);
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(positions(g), 3));
    this.colorAttr = new Float32BufferAttribute(new Float32Array(g.n * g.n * 3), 3);
    geo.setAttribute("color", this.colorAttr);
    geo.setIndex(new BufferAttribute(index, 1));
    geo.computeBoundingSphere();
    const mesh = new Mesh(geo, new MeshBasicMaterial({ vertexColors: true }));
    mesh.frustumCulled = false;
    const root = new Group();
    root.add(mesh);
    this.terrain = root;
    this.ground.add(root);
    this.buildOverlays();
    const buildMs = performance.now() - t0;
    const shade = this.shade();
    this.camera.far = Math.max(1e4, ((g.n - 1) * g.spacing) * 20);
    this.camera.near = Math.max(1, ((g.n - 1) * g.spacing) / 2000);
    this.camera.updateProjectionMatrix();
    this.resetCamera();
    this.lastStats = {
      triangles,
      vertices: g.n * g.n,
      shadowN: this.mask?.nc ?? 0,
      shadowedFraction: this.mask?.shadowedFraction ?? 0,
      sunUp: this.mask?.sunUp ?? false,
      shadeMs: shade,
      buildMs,
      heightMin: g.min,
      heightMax: g.max,
      patch: p,
      nodata: p.nodata,
    };
    this.rebuildSky();
    this.requestRender();
    return this.lastStats;
  }

  private shade(): number {
    const g = this.grid;
    if (!g || !this.shading || !this.colorAttr) return 0;
    const t0 = performance.now();
    this.mask = this.light ? shadowMask(g, this.light.sunAz_deg, this.light.sunEl_deg) : null;
    const col = colorize(g, this.shading, this.mode, this.light, this.mask);
    (this.colorAttr.array as Float32Array).set(col);
    this.colorAttr.needsUpdate = true;
    return performance.now() - t0;
  }

  setLight(light: LightState | null): SceneStats | null {
    this.light = light;
    const ms = this.shade();
    if (this.lastStats) {
      this.lastStats = { ...this.lastStats, shadeMs: ms, shadowN: this.mask?.nc ?? 0, shadowedFraction: this.mask?.shadowedFraction ?? 0, sunUp: this.mask?.sunUp ?? false };
    }
    this.requestRender();
    return this.lastStats;
  }

  setColorMode(mode: ColorMode): void {
    this.mode = mode;
    this.shade();
    this.requestRender();
  }

  private pivot(): number {
    return this.grid ? (this.grid.min + this.grid.max) / 2 : 0;
  }

  private applyExaggeration(): void {
    this.ground.scale.y = this.exag;
    this.ground.position.y = this.pivot() * (1 - this.exag);
  }

  setExaggeration(v: number): void {
    this.exag = v;
    this.applyExaggeration();
    this.rebuildSky();
    this.requestRender();
  }

  setMast(mastHeight_m: number): void {
    if (mastHeight_m === this.mast) return;
    this.mast = mastHeight_m;
    this.buildOverlays();
    this.requestRender();
  }

  setBlocker(b: BlockerView | null): void {
    this.blockerView = b;
    this.buildOverlays();
    this.requestRender();
  }

  setDirections(sun: Direction | null, earth: Direction | null): void {
    this.dirs = { sun, earth };
    this.rebuildSky();
    this.requestRender();
  }

  setColors(c: SceneColors): void {
    this.colors = c;
    this.renderer.setClearColor(new Color(c.sky));
    this.buildOverlays();
    this.rebuildSky();
    this.requestRender();
  }

  private half(): number {
    const g = this.grid;
    return g ? ((g.n - 1) * g.spacing) / 2 : 1000;
  }

  private buildOverlays(): void {
    const g = this.grid;
    const root = this.terrain;
    if (!g || !root) return;
    for (const c of [...root.children]) if (!(c instanceof Mesh)) {
      disposeTree(c);
      root.remove(c);
    }
    const half = this.half();
    const col = this.colors;
    const overlay = new Group();
    const base = g.min - half * 0.01;

    const R = half * 1.06;
    const ring: number[] = [];
    for (let k = 0; k < 180; k++) ring.push(R * Math.sin((k / 180) * TAU), base, -R * Math.cos((k / 180) * TAU));
    const ringGeo = new BufferGeometry().setAttribute("position", new Float32BufferAttribute(ring, 3));
    overlay.add(new LineLoop(ringGeo, new LineBasicMaterial({ color: col.ring, depthTest: false, transparent: true, opacity: 0.8 })));
    const ticks: number[] = [];
    for (let a = 0; a < 360; a += 10) {
      const long = a % 90 === 0 ? 0.06 : a % 30 === 0 ? 0.035 : 0.018;
      const s = Math.sin((a * Math.PI) / 180);
      const c = Math.cos((a * Math.PI) / 180);
      ticks.push(R * s, base, -R * c, R * (1 + long) * s, base, -R * (1 + long) * c);
    }
    overlay.add(new LineSegments(new BufferGeometry().setAttribute("position", new Float32BufferAttribute(ticks, 3)), new LineBasicMaterial({ color: col.ring, depthTest: false, transparent: true, opacity: 0.8 })));
    for (const [text, a] of [["N", 0], ["E", 90], ["S", 180], ["W", 270]] as const) {
      const s = label(text, col.text, col.textBg);
      const rr = R * 1.13;
      s.position.set(rr * Math.sin((a * Math.PI) / 180), base, -rr * Math.cos((a * Math.PI) / 180));
      s.scale.set(LABEL_H * (s.userData["aspect"] as number), LABEL_H, 1);
      overlay.add(s);
    }

    const h0 = heightAtOffset(g, 0, 0);
    const y0 = Number.isFinite(h0) ? h0 : g.min;
    const pin = Math.max(this.mast, half * 0.04);
    overlay.add(new Line(new BufferGeometry().setFromPoints([new Vector3(0, y0, 0), new Vector3(0, y0 + pin, 0)]), new LineBasicMaterial({ color: col.accent, depthTest: false })));
    overlay.add(point(0, y0 + pin, 0, col.accent, 9));
    const bLeft = this.blockerView !== null && Math.sin((this.blockerView.az_deg * Math.PI) / 180) < 0;
    const ls = label(`Lander · mast ${formatNum(this.mast, 1)} m (pin not to scale)`, col.text, col.textBg, this.blockerView ? (bLeft ? 0 : 1) : 1);
    ls.center.y = 1;
    ls.position.set(0, y0 + pin, 0);
    ls.scale.set(LABEL_H * (ls.userData["aspect"] as number), LABEL_H, 1);
    overlay.add(ls);

    const b = this.blockerView;
    if (b) {
      const edge = edgeDistance(g, b.az_deg);
      const inside = b.dist_m <= edge;
      const d = inside ? b.dist_m : edge;
      const o = offsetAt(b.az_deg, d);
      const hv = heightAtOffset(g, o.east, o.north);
      const yb = Number.isFinite(hv) ? hv : y0;
      const top = yb + half * 0.12;
      const line = new BufferGeometry().setFromPoints([new Vector3(0, y0 + pin, 0), new Vector3(o.east, yb, -o.north)]);
      overlay.add(new Line(line, new LineBasicMaterial({ color: col.blocker, depthTest: false })));
      overlay.add(new Line(new BufferGeometry().setFromPoints([new Vector3(o.east, yb, -o.north), new Vector3(o.east, top, -o.north)]), new LineBasicMaterial({ color: col.blocker, depthTest: false })));
      overlay.add(point(o.east, yb, -o.north, col.blocker, 12));
      const text = inside ? b.label : `${b.label} (beyond this patch)`;
      const bs = label(text, col.text, col.textBg, bLeft ? 1 : 0);
      bs.center.y = 0;
      bs.position.set(o.east, top, -o.north);
      bs.scale.set(LABEL_H * (bs.userData["aspect"] as number), LABEL_H, 1);
      overlay.add(bs);
    }
    root.add(overlay);
  }

  private rebuildSky(): void {
    disposeTree(this.sky);
    this.sky.clear();
    const g = this.grid;
    if (!g) return;
    const half = this.half();
    const h0 = heightAtOffset(g, 0, 0);
    const y0 = Number.isFinite(h0) ? h0 : g.min;
    const origin = new Vector3(0, this.pivot() + (y0 - this.pivot()) * this.exag, 0);
    for (const [name, d, color] of [["Sun", this.dirs.sun, this.colors.sun], ["Earth", this.dirs.earth, this.colors.earth]] as const) {
      if (!d) continue;
      const v = dirFromAzEl(d.az_deg, d.el_deg);
      const L = half * 0.95;
      const end = new Vector3(v[0] * L, origin.y + v[1] * L, v[2] * L);
      const dashed = d.el_deg <= 0;
      this.sky.add(new Line(new BufferGeometry().setFromPoints([origin, end]), new LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: dashed ? 0.45 : 1 })));
      this.sky.add(point(end.x, end.y, end.z, color, 14));
      const s = label(directionLabel(name, d), this.colors.text, this.colors.textBg, name === "Sun" ? 0 : 1);
      s.position.set(end.x, end.y, end.z);
      s.scale.set(LABEL_H * (s.userData["aspect"] as number), LABEL_H, 1);
      this.sky.add(s);
    }
  }

  resetCamera(): void {
    const half = this.half();
    const el = (32 * Math.PI) / 180;
    const dist = half * 3.1;
    const mid = this.pivot();
    this.camera.position.set(0, mid + dist * Math.sin(el), dist * Math.cos(el));
    this.controls.target.set(0, mid, 0);
    this.controls.minDistance = half * 0.08;
    this.controls.maxDistance = half * 12;
    this.controls.update();
    this.requestRender();
  }

  resize(w: number, h: number): void {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  stats(): SceneStats | null {
    return this.lastStats;
  }

  renderSync(): number {
    const t0 = performance.now();
    this.renderer.render(this.scene, this.camera);
    this.renderer.getContext().finish();
    return performance.now() - t0;
  }

  requestRender(): void {
    if (this.raf || this.disposed) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.renderNow();
    });
  }

  private renderNow(): void {
    if (this.disposed) return;
    const t0 = performance.now();
    this.renderer.render(this.scene, this.camera);
    this.onFrame?.(performance.now() - t0);
  }

  async benchmark(frames = 30): Promise<BenchResult> {
    const gl = this.renderer.getContext();
    const px = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const t0 = performance.now();
    for (let k = 0; k < frames; k++) {
      const p = this.camera.position;
      const r = Math.hypot(p.x, p.z);
      const ang = Math.atan2(p.x, p.z) + 0.02;
      this.camera.position.set(r * Math.sin(ang), p.y, r * Math.cos(ang));
      this.camera.lookAt(this.controls.target);
      this.renderer.render(this.scene, this.camera);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    }
    const ms = (performance.now() - t0) / frames;
    this.resetCamera();
    return { frames, msPerFrame: ms, triangles: this.lastStats?.triangles ?? 0 };
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.controls.dispose();
    if (this.terrain) disposeTree(this.terrain);
    disposeTree(this.sky);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

function point(x: number, y: number, z: number, color: string, size: number): Points {
  const geo = new BufferGeometry().setAttribute("position", new Float32BufferAttribute([x, y, z], 3));
  return new Points(geo, new PointsMaterial({ color, size, sizeAttenuation: false, depthTest: false }));
}
