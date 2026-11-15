import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  LineBasicMaterial,
  LineLoop,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  Points,
  Quaternion,
  Raycaster,
  Scene,
  ShaderMaterial,
  Sphere,
  SphereGeometry,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Texture,
} from "three";
import moonMap from "../../../learn/scene/maps/moon.jpg";
import { MOON_R_M } from "../../../lib/projection";

export type V3 = [number, number, number];

export const surfacePoint = (lat_deg: number, lon_deg: number, r = 1): V3 => {
  const la = (lat_deg * Math.PI) / 180;
  const lo = (lon_deg * Math.PI) / 180;
  return [Math.cos(la) * Math.cos(lo) * r, Math.sin(la) * r, -Math.cos(la) * Math.sin(lo) * r];
};

export interface Marker {
  lat_deg: number;
  lon_deg: number;
  color: string;
  size: number;
  shape?: MarkerShape;
}

export type MarkerLayer = "plan" | "ranked" | "pins" | "sites";
const PICK_ORDER: MarkerLayer[] = ["plan", "ranked", "pins", "sites"];
const LAYER_ORDER: Record<MarkerLayer, number> = { sites: 4, pins: 5, ranked: 6, plan: 7 };

export interface SurfaceMesh {
  positions: Float32Array;
  index: Uint32Array;
}

export interface Patch extends SurfaceMesh {
  canvas: HTMLCanvasElement;
  uvs: Float32Array;
  round: boolean;
}

export interface CellMesh extends SurfaceMesh {
  colors: Float32Array;
}

export type Hit = { kind: "marker"; layer: MarkerLayer; index: number; x: number; y: number } | { kind: "surface"; lat_deg: number; lon_deg: number; x: number; y: number };

const SURFACE_VERT = `
varying vec2 vUv;
varying vec3 vN;
void main() {
  vUv = uv;
  vN = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SURFACE_FRAG = `
uniform sampler2D map;
uniform vec3 sun;
uniform float night;
uniform float opacity;
uniform float round;
varying vec2 vUv;
varying vec3 vN;
void main() {
  vec4 t = texture2D(map, vUv);
  float d = dot(normalize(vN), sun);
  float lit = smoothstep(-0.012, 0.025, d);
  vec2 q = abs(vUv - 0.5);
  float edge = round > 1.5 ? smoothstep(0.5, 0.3, length(vUv - 0.5)) : round > 0.5 ? smoothstep(0.5, 0.36, max(q.x, q.y)) : 1.0;
  gl_FragColor = vec4(t.rgb * 0.8 * mix(night, 1.0, lit), t.a * opacity * edge);
  #include <colorspace_fragment>
}`;

const CELL_VERT = `
attribute vec4 rgba;
varying vec4 vC;
void main() {
  vC = rgba;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const CELL_FRAG = `
uniform float opacity;
varying vec4 vC;
void main() {
  gl_FragColor = vec4(vC.rgb, vC.a * opacity);
  #include <colorspace_fragment>
}`;

const MARK_VERT = `
attribute vec3 mcolor;
attribute float msize;
attribute float mshape;
uniform vec3 cam;
uniform float dpr;
varying vec3 vColor;
varying float vShape;
varying float vSize;
varying float vVis;
void main() {
  vColor = mcolor;
  vShape = mshape;
  vSize = msize * dpr;
  vVis = step(0.0, dot(normalize(position), normalize(cam - position)));
  gl_PointSize = vSize;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const MARK_FRAG = `
varying vec3 vColor;
varying float vShape;
varying float vSize;
varying float vVis;
float box(vec2 p, vec2 b) {
  vec2 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
}
float tri(vec2 p, float r) {
  const float k = 1.7320508;
  p.x = abs(p.x) - r;
  p.y = p.y + r / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}
void main() {
  if (vVis < 0.5) discard;
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  p.y = -p.y;
  float s = vShape;
  float d;
  if (s < 0.5) d = length(p) - 0.5;
  else if (s < 1.5) d = abs(length(p) - 0.55) - 0.13;
  else if (s < 2.5) d = tri(p + vec2(0.0, 0.12), 0.68);
  else if (s < 3.5) d = (abs(p.x) + abs(p.y) - 0.74) * 0.7071;
  else if (s < 4.5) d = box(p, vec2(0.5)) - 0.04;
  else if (s < 5.5) {
    vec2 q = vec2(p.x + p.y, p.x - p.y) * 0.7071;
    d = min(box(q, vec2(0.68, 0.12)), box(q, vec2(0.12, 0.68)));
  }
  else if (s < 6.5) d = min(abs(length(p) - 0.6) - 0.1, length(p) - 0.2);
  else d = min(abs(length(p) - 0.55) - 0.12, length(p) - 0.18);
  float px = 2.0 / max(vSize, 1.0);
  float halo = 1.6 * px;
  float aa = 0.9 * px;
  float fill = smoothstep(aa, -aa, d);
  float alpha = smoothstep(halo + aa, halo - aa, d);
  if (alpha <= 0.0) discard;
  vec3 c = mix(vec3(0.04, 0.05, 0.07), vColor, fill);
  gl_FragColor = vec4(c, alpha * mix(0.75, 1.0, fill));
  #include <colorspace_fragment>
}`;

export const SHAPE = { dot: 0, ring: 1, triangle: 2, diamond: 3, square: 4, cross: 5, target: 6, pin: 7 } as const;
export type MarkerShape = keyof typeof SHAPE;

const FOV = 34;
const TAN = Math.tan(((FOV / 2) * Math.PI) / 180);
const MIN_ALT = 1.5 / (MOON_R_M / 1000);
const MAX_ALT = 4;
const SETTLE_MS = 220;
const FLY_MS = 1600;
const FADE_MS = 300;
const ORIGIN = new Vector3();
const UNIT = new Sphere(ORIGIN, 1);
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const clampAlt = (a: number) => Math.min(MAX_ALT, Math.max(MIN_ALT, a));

export interface ViewInfo {
  lat_deg: number;
  lon_deg: number;
  alt: number;
  half_m: number;
  px: number;
}

interface Tween {
  q0: Quaternion;
  q1: Quaternion;
  a0: number;
  a1: number;
  t0: number;
  dur: number;
  arc: number;
}

type Drag =
  | { kind: "grab"; p0: Vector3; start: [number, number]; moved: boolean; button: number }
  | { kind: "twist"; last: [number, number]; start: [number, number]; moved: boolean }
  | { kind: "pinch"; p0: Vector3; dist: number };

interface Fade {
  mesh: Mesh;
  from: number;
  to: number;
  t0: number;
  drop: boolean;
}

function orientFor(dir: Vector3): Quaternion {
  const up = Math.abs(dir.y) > 0.999 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
  return new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(dir, ORIGIN, up));
}

export class MoonScene {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(FOV, 1, 1e-4, 10);
  private readonly sun = new Vector3(1, 0, 0);
  private readonly surfaceMats: ShaderMaterial[] = [];
  private readonly moonTex: Texture;
  private readonly markers = new Map<MarkerLayer, { points: Points; data: Marker[] }>();
  private readonly patches = new Map<string, Mesh>();
  private fades: Fade[] = [];
  private cells: Mesh | null = null;
  private ring: LineLoop | null = null;
  private q = new Quaternion();
  private alt = 2.2;
  private tween: Tween | null = null;
  private drag: Drag | null = null;
  private readonly pointers = new Map<number, [number, number]>();
  private vel: { axis: Vector3; rate: number; t: number } | null = null;
  private spin: { axis: Vector3; rate: number } | null = null;
  private dirty = true;
  private moved = false;
  private lastMove = 0;
  private lastFrame = 0;
  private raf = 0;
  private w = 1;
  private h = 1;
  private shift = 0;
  private readonly ro: ResizeObserver;
  private readonly raycaster = new Raycaster();
  private onClick: (h: Hit) => void = () => undefined;
  private onHover: (h: Hit | null) => void = () => undefined;
  private onView: () => void = () => undefined;
  private onSettle: (v: ViewInfo) => void = () => undefined;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(new Color("#030407"), 1);
    this.moonTex = new TextureLoader().load(moonMap, () => {
      this.dirty = true;
    });
    this.moonTex.colorSpace = SRGBColorSpace;
    this.moonTex.anisotropy = 8;
    const moon = new Mesh(new SphereGeometry(1, 192, 96), this.surfaceMaterial(this.moonTex, "none", 0.22));
    moon.renderOrder = 0;
    this.scene.add(moon);
    this.apply();

    canvas.style.cursor = "grab";
    canvas.addEventListener("wheel", this.wheel, { passive: false });
    canvas.addEventListener("pointerdown", this.down);
    canvas.addEventListener("pointerup", this.up);
    canvas.addEventListener("pointercancel", this.cancel);
    canvas.addEventListener("pointermove", this.move);
    canvas.addEventListener("pointerleave", this.leave);
    canvas.addEventListener("contextmenu", this.menu);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
    this.raf = requestAnimationFrame(this.frame);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.canvas.removeEventListener("wheel", this.wheel);
    this.canvas.removeEventListener("pointerdown", this.down);
    this.canvas.removeEventListener("pointerup", this.up);
    this.canvas.removeEventListener("pointercancel", this.cancel);
    this.canvas.removeEventListener("pointermove", this.move);
    this.canvas.removeEventListener("pointerleave", this.leave);
    this.canvas.removeEventListener("contextmenu", this.menu);
    for (const f of this.fades) if (f.drop && f.mesh.parent === null) this.disposeMesh(f.mesh);
    this.scene.traverse((o) => {
      if (o instanceof Mesh || o instanceof Points || o instanceof LineLoop) {
        o.geometry.dispose();
        const m = o.material as ShaderMaterial;
        const map = m.uniforms?.["map"]?.value as Texture | undefined;
        map?.dispose();
        m.dispose();
      }
    });
    this.moonTex.dispose();
    this.renderer.dispose();
  }

  private surfaceMaterial(map: Texture, fade: "none" | "square" | "round", night: number): ShaderMaterial {
    const m = new ShaderMaterial({
      vertexShader: SURFACE_VERT,
      fragmentShader: SURFACE_FRAG,
      uniforms: { map: { value: map }, sun: { value: this.sun }, night: { value: night }, opacity: { value: 1 }, round: { value: fade === "round" ? 2 : fade === "square" ? 1 : 0 } },
      transparent: true,
    });
    this.surfaceMats.push(m);
    return m;
  }

  setHandlers(h: { click?: (h: Hit) => void; hover?: (h: Hit | null) => void; view?: () => void; settle?: (v: ViewInfo) => void }): void {
    if (h.click) this.onClick = h.click;
    if (h.hover) this.onHover = h.hover;
    if (h.view) this.onView = h.view;
    if (h.settle) this.onSettle = h.settle;
  }

  setSun(lat_deg: number, lon_deg: number): void {
    this.sun.set(...surfacePoint(lat_deg, lon_deg));
    this.dirty = true;
  }

  private disposeMesh(mesh: Mesh): void {
    this.scene.remove(mesh);
    mesh.geometry.dispose();
    const m = mesh.material as ShaderMaterial;
    (m.uniforms["map"]!.value as Texture).dispose();
    const i = this.surfaceMats.indexOf(m);
    if (i >= 0) this.surfaceMats.splice(i, 1);
    m.dispose();
  }

  setPatch(key: string, patch: Patch | null, fade = false): void {
    const old = this.patches.get(key);
    if (old) {
      this.patches.delete(key);
      this.fades = this.fades.filter((f) => f.mesh !== old);
      if (fade) this.fades.push({ mesh: old, from: (old.material as ShaderMaterial).uniforms["opacity"]!.value as number, to: 0, t0: performance.now(), drop: true });
      else this.disposeMesh(old);
    }
    if (patch) {
      const g = new BufferGeometry();
      g.setAttribute("position", new BufferAttribute(patch.positions, 3));
      g.setAttribute("uv", new BufferAttribute(patch.uvs, 2));
      g.setIndex(new BufferAttribute(patch.index, 1));
      const tex = new CanvasTexture(patch.canvas);
      tex.colorSpace = SRGBColorSpace;
      tex.anisotropy = 8;
      const mat = this.surfaceMaterial(tex, patch.round ? "round" : "square", 0.3);
      mat.depthWrite = false;
      mat.side = DoubleSide;
      const mesh = new Mesh(g, mat);
      mesh.renderOrder = patch.round ? 1 : 2;
      this.scene.add(mesh);
      this.patches.set(key, mesh);
      if (fade) {
        mat.uniforms["opacity"]!.value = 0;
        this.fades.push({ mesh, from: 0, to: 1, t0: performance.now(), drop: false });
      }
    }
    this.dirty = true;
  }

  setCells(cells: CellMesh | null, faded: boolean): void {
    if (this.cells) {
      this.scene.remove(this.cells);
      this.cells.geometry.dispose();
      (this.cells.material as ShaderMaterial).dispose();
      this.cells = null;
    }
    if (cells && cells.index.length > 0) {
      const g = new BufferGeometry();
      g.setAttribute("position", new BufferAttribute(cells.positions, 3));
      g.setAttribute("rgba", new BufferAttribute(cells.colors, 4));
      g.setIndex(new BufferAttribute(cells.index, 1));
      const mat = new ShaderMaterial({ vertexShader: CELL_VERT, fragmentShader: CELL_FRAG, uniforms: { opacity: { value: faded ? 0.45 : 1 } }, transparent: true, depthWrite: false, side: DoubleSide });
      this.cells = new Mesh(g, mat);
      this.cells.renderOrder = 3;
      this.scene.add(this.cells);
    }
    this.dirty = true;
  }

  setRing(points: V3[] | null): void {
    if (this.ring) {
      this.scene.remove(this.ring);
      this.ring.geometry.dispose();
      (this.ring.material as LineBasicMaterial).dispose();
      this.ring = null;
    }
    if (points && points.length > 2) {
      const g = new BufferGeometry();
      g.setAttribute("position", new BufferAttribute(new Float32Array(points.flat()), 3));
      this.ring = new LineLoop(g, new LineBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.85, depthWrite: false }));
      this.ring.renderOrder = 3;
      this.scene.add(this.ring);
    }
    this.dirty = true;
  }

  setMarkers(layer: MarkerLayer, list: Marker[]): void {
    const old = this.markers.get(layer);
    if (old) {
      this.scene.remove(old.points);
      old.points.geometry.dispose();
      (old.points.material as ShaderMaterial).dispose();
      this.markers.delete(layer);
    }
    if (list.length === 0) {
      this.dirty = true;
      return;
    }
    const pos = new Float32Array(list.length * 3);
    const col = new Float32Array(list.length * 3);
    const size = new Float32Array(list.length);
    const shape = new Float32Array(list.length);
    const c = new Color();
    list.forEach((m, i) => {
      pos.set(surfacePoint(m.lat_deg, m.lon_deg, 1 + 1e-6), i * 3);
      c.set(m.color);
      col.set([c.r, c.g, c.b], i * 3);
      size[i] = m.size;
      shape[i] = SHAPE[m.shape ?? "dot"];
    });
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(pos, 3));
    g.setAttribute("mcolor", new BufferAttribute(col, 3));
    g.setAttribute("msize", new BufferAttribute(size, 1));
    g.setAttribute("mshape", new BufferAttribute(shape, 1));
    const mat = new ShaderMaterial({
      vertexShader: MARK_VERT,
      fragmentShader: MARK_FRAG,
      uniforms: { cam: { value: this.camera.position }, dpr: { value: this.renderer.getPixelRatio() } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const points = new Points(g, mat);
    points.frustumCulled = false;
    points.renderOrder = LAYER_ORDER[layer];
    this.scene.add(points);
    this.markers.set(layer, { points, data: list });
    this.dirty = true;
  }

  private apply(): void {
    this.camera.quaternion.copy(this.q);
    this.camera.position.set(0, 0, 1 + this.alt).applyQuaternion(this.q);
    this.camera.updateMatrixWorld();
    this.dirty = true;
    this.moved = true;
    this.lastMove = performance.now();
    this.onView();
  }

  private stop(): void {
    this.tween = null;
    this.spin = null;
  }

  private altFor(radius_m: number): number {
    return clampAlt(radius_m / MOON_R_M / TAN);
  }

  flyTo(lat_deg: number, lon_deg: number, radius_m: number | null, instant = false): void {
    const a1 = radius_m === null ? 2.2 : this.altFor(radius_m);
    const dir = new Vector3(...surfacePoint(lat_deg, lon_deg));
    this.spin = null;
    if (instant) {
      this.tween = null;
      this.q = orientFor(dir);
      this.alt = a1;
      this.apply();
      return;
    }
    const cur = new Vector3(0, 0, 1).applyQuaternion(this.q);
    const q1 = Math.abs(dir.y) < 0.97 ? orientFor(dir) : new Quaternion().setFromUnitVectors(cur, dir).multiply(this.q);
    const angle = cur.angleTo(dir);
    const arc = Math.max(0, Math.min(1.8, angle * 0.9) - Math.max(this.alt, a1));
    this.tween = { q0: this.q.clone(), q1, a0: this.alt, a1, t0: performance.now(), dur: FLY_MS + Math.min(FLY_MS, angle * 900), arc };
    this.dirty = true;
    this.onSettle(this.infoFor(dir, a1));
  }

  zoomBy(factor: number): void {
    this.stop();
    this.alt = clampAlt(this.alt * factor);
    this.apply();
  }

  private zoomAt(x: number, y: number, factor: number): void {
    this.stop();
    const p0 = this.hit(x, y);
    this.alt = clampAlt(this.alt * factor);
    this.apply();
    if (p0) this.regrab(p0, x, y);
  }

  private regrab(p0: Vector3, x: number, y: number): void {
    const p1 = this.grabPoint(x, y);
    const r = new Quaternion().setFromUnitVectors(p1, p0);
    this.q.premultiply(r);
    this.apply();
  }

  screenOf(lat_deg: number, lon_deg: number): [number, number] | null {
    const p = new Vector3(...surfacePoint(lat_deg, lon_deg));
    if (p.dot(this.camera.position.clone().sub(p)) < 0) return null;
    p.project(this.camera);
    if (p.z > 1) return null;
    return [((p.x + 1) / 2) * this.w, ((1 - p.y) / 2) * this.h];
  }

  private viewInfo(): ViewInfo {
    return this.infoFor(this.camera.position.clone().normalize(), this.alt);
  }

  private infoFor(dir: Vector3, alt: number): ViewInfo {
    const widen = 1 + (2 * this.shift) / this.w;
    const aspect = Math.max(1, this.w / this.h);
    const dpr = this.renderer.getPixelRatio();
    return {
      lat_deg: (Math.asin(Math.max(-1, Math.min(1, dir.y))) * 180) / Math.PI,
      lon_deg: (Math.atan2(-dir.z, dir.x) * 180) / Math.PI,
      alt,
      half_m: alt * MOON_R_M * TAN * aspect * widen * 1.1,
      px: Math.min(2048, Math.ceil(Math.max(this.w, this.h) * widen * 1.1 * Math.min(dpr, 1.5))),
    };
  }

  private resize(): void {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    this.w = w;
    this.h = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.shift = w > 760 ? Math.round(w * 0.16) : 0;
    if (this.shift) this.camera.setViewOffset(w, h, -this.shift, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    this.moved = true;
    this.dirty = true;
  }

  private readonly frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = this.lastFrame ? Math.min(64, now - this.lastFrame) : 16;
    this.lastFrame = now;
    if (this.tween) {
      const t = Math.min(1, (now - this.tween.t0) / this.tween.dur);
      const e = ease(t);
      const { q0, q1, a0, a1, arc } = this.tween;
      this.q.slerpQuaternions(q0, q1, e);
      this.alt = Math.exp(Math.log(a0) + (Math.log(a1) - Math.log(a0)) * e) + arc * Math.sin(Math.PI * e);
      if (t >= 1) this.tween = null;
      this.apply();
    }
    if (this.spin) {
      this.q.premultiply(new Quaternion().setFromAxisAngle(this.spin.axis, this.spin.rate * dt));
      this.spin.rate *= Math.exp(-dt / 260);
      if (Math.abs(this.spin.rate) * 1000 < this.alt * 0.01) this.spin = null;
      this.apply();
    }
    if (this.fades.length) {
      this.fades = this.fades.filter((f) => {
        const t = Math.min(1, (now - f.t0) / FADE_MS);
        (f.mesh.material as ShaderMaterial).uniforms["opacity"]!.value = f.from + (f.to - f.from) * t;
        if (t >= 1 && f.drop) this.disposeMesh(f.mesh);
        return t < 1;
      });
      this.dirty = true;
    }
    if (this.moved && !this.drag && !this.tween && !this.spin && now - this.lastMove > SETTLE_MS) {
      this.moved = false;
      this.onSettle(this.viewInfo());
    }
    if (!this.dirty) return;
    this.dirty = false;
    const near = Math.max(1e-6, this.alt * 0.25);
    const far = this.alt + 2.2;
    if (this.camera.near !== near || this.camera.far !== far) {
      this.camera.near = near;
      this.camera.far = far;
      this.camera.updateProjectionMatrix();
    }
    const night = Math.min(0.6, 0.22 + Math.max(0, 0.3 - this.alt) * 1.3);
    for (const m of this.surfaceMats) m.uniforms["night"]!.value = night;
    this.renderer.render(this.scene, this.camera);
  };

  private ray(x: number, y: number) {
    this.raycaster.setFromCamera(new Vector2((x / this.w) * 2 - 1, -(y / this.h) * 2 + 1), this.camera);
    return this.raycaster.ray;
  }

  private hit(x: number, y: number): Vector3 | null {
    return this.ray(x, y).intersectSphere(UNIT, new Vector3());
  }

  private grabPoint(x: number, y: number): Vector3 {
    const r = this.ray(x, y);
    const p = r.intersectSphere(UNIT, new Vector3());
    return (p ?? r.closestPointToPoint(ORIGIN, new Vector3())).normalize();
  }

  private pick(x: number, y: number): Hit | null {
    let best: { layer: MarkerLayer; index: number; d: number } | null = null;
    for (const layer of PICK_ORDER) {
      const m = this.markers.get(layer);
      if (!m) continue;
      m.data.forEach((mk, i) => {
        const s = this.screenOf(mk.lat_deg, mk.lon_deg);
        if (!s) return;
        const d = Math.hypot(s[0] - x, s[1] - y);
        if (d <= Math.max(7, mk.size / 2 + 3) && (!best || d < best.d - 0.5)) best = { layer, index: i, d };
      });
      if (best) break;
    }
    if (best) {
      const b = best as { layer: MarkerLayer; index: number };
      return { kind: "marker", layer: b.layer, index: b.index, x, y };
    }
    const p = this.hit(x, y);
    if (!p) return null;
    return { kind: "surface", lat_deg: (Math.asin(Math.max(-1, Math.min(1, p.y))) * 180) / Math.PI, lon_deg: (Math.atan2(-p.z, p.x) * 180) / Math.PI, x, y };
  }

  private local(e: { clientX: number; clientY: number }): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private pinchState(): { mid: [number, number]; dist: number } | null {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return null;
    const [a, b] = pts as [[number, number], [number, number]];
    return { mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], dist: Math.max(1, Math.hypot(a[0] - b[0], a[1] - b[1])) };
  }

  private startGrab(x: number, y: number, button: number): void {
    this.drag = { kind: "grab", p0: this.grabPoint(x, y), start: [x, y], moved: false, button };
    this.vel = null;
  }

  private readonly down = (e: PointerEvent) => {
    const [x, y] = this.local(e);
    this.stop();
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, [x, y]);
    this.onHover(null);
    if (this.pointers.size === 1) {
      if (e.button === 2 || e.shiftKey || e.ctrlKey) this.drag = { kind: "twist", last: [x, y], start: [x, y], moved: false };
      else this.startGrab(x, y, e.button);
    } else {
      const p = this.pinchState();
      if (p) this.drag = { kind: "pinch", p0: this.grabPoint(p.mid[0], p.mid[1]), dist: p.dist };
    }
    this.canvas.style.cursor = "grabbing";
  };

  private readonly move = (e: PointerEvent) => {
    const [x, y] = this.local(e);
    if (!this.pointers.has(e.pointerId)) {
      if (e.buttons) return;
      const hit = this.pick(x, y);
      this.canvas.style.cursor = hit?.kind === "marker" ? "pointer" : "grab";
      this.onHover(hit);
      return;
    }
    this.pointers.set(e.pointerId, [x, y]);
    const d = this.drag;
    if (!d) return;
    if (d.kind === "grab") {
      if (!d.moved && Math.hypot(x - d.start[0], y - d.start[1]) <= 4) return;
      d.moved = true;
      const p1 = this.grabPoint(x, y);
      const r = new Quaternion().setFromUnitVectors(p1, d.p0);
      const now = performance.now();
      const angle = 2 * Math.acos(Math.min(1, Math.abs(r.w)));
      if (angle > 1e-12) {
        const axis = new Vector3(r.x, r.y, r.z).normalize().multiplyScalar(Math.sign(r.w) || 1);
        const dtm = this.vel ? Math.max(1, now - this.vel.t) : 16;
        this.vel = { axis, rate: angle / dtm, t: now };
      }
      this.q.premultiply(r);
      this.apply();
    } else if (d.kind === "twist") {
      const dx = x - d.last[0];
      d.last = [x, y];
      if (!d.moved && Math.hypot(x - d.start[0], y - d.start[1]) <= 4) return;
      d.moved = true;
      const axis = this.camera.position.clone().normalize();
      this.q.premultiply(new Quaternion().setFromAxisAngle(axis, dx * 0.006));
      this.apply();
    } else {
      const p = this.pinchState();
      if (!p) return;
      this.alt = clampAlt((this.alt * d.dist) / p.dist);
      d.dist = p.dist;
      this.apply();
      this.regrab(d.p0, p.mid[0], p.mid[1]);
    }
  };

  private release(e: PointerEvent, click: boolean): void {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    const d = this.drag;
    if (this.pointers.size === 1) {
      const [rest] = [...this.pointers.values()] as [[number, number]];
      this.startGrab(rest[0], rest[1], 0);
      if (this.drag) (this.drag as { moved: boolean }).moved = true;
      return;
    }
    if (this.pointers.size > 0) return;
    this.drag = null;
    this.canvas.style.cursor = "grab";
    if (d?.kind === "grab") {
      if (d.moved && this.vel && performance.now() - this.vel.t < 60) this.spin = { axis: this.vel.axis, rate: Math.min(this.vel.rate, 0.002 * Math.max(this.alt, 0.02)) };
      this.vel = null;
      if (click && !d.moved && d.button === 0) {
        const [x, y] = this.local(e);
        const hit = this.pick(x, y);
        if (hit) this.onClick(hit);
      }
    }
  }

  private readonly up = (e: PointerEvent) => this.release(e, true);
  private readonly cancel = (e: PointerEvent) => this.release(e, false);

  private readonly wheel = (e: WheelEvent) => {
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    const [x, y] = this.local(e);
    this.zoomAt(x, y, Math.exp(dy * 0.0016));
  };

  private readonly menu = (e: MouseEvent) => {
    e.preventDefault();
  };

  private readonly leave = () => {
    if (this.pointers.size === 0) this.onHover(null);
  };
}
