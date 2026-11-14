import {
  CircleGeometry,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  RingGeometry,
  Scene,
  WebGLRenderTarget,
  PCFShadowMap,
  WebGLRenderer,
  type PerspectiveCamera,
  type Object3D,
} from "three";
import { clamp } from "../../lib/scale";
import { disposeTree } from "../../lib/three";
import { describeShort } from "../describe";
import { CraterView, type CraterSource } from "./craterView";
import { GroundView } from "./groundView";
import { SpaceView, type SpacePreset } from "./spaceView";
import { discTexture, earthTexture, glowTexture, Label, moonTexture, regolithTexture, ringTexture, withPhoto } from "./textures";
import earthMap from "./maps/earth.jpg";
import moonMap from "./maps/moon.jpg";
import { CameraTween } from "./tween";
import { SPACE_BG, type SceneFrame, type Shared, type ViewKind } from "./types";
import { WalkView, type WalkBody } from "../walk/walkView";

type Phase = "fly" | "out" | "in";

interface Transition {
  phase: Phase;
  start: number;
  dur: number;
  to: ViewKind;
  half: number;
}

function insetRect(w: number, h: number, phone: boolean): { x: number; y: number; size: number } {
  const size = Math.round(Math.max(110, Math.min(phone ? 0.36 * w : 0.3 * w, (phone ? 0.5 : 0.42) * h, 340)));
  const margin = phone ? 12 : 28;
  const bottom = phone ? 12 : 150;
  return { x: w - margin - size, y: bottom, size };
}

export class LearnScene {
  private readonly canvas: HTMLCanvasElement;
  private readonly pixelRatioCap: number;
  private renderer!: WebGLRenderer;
  private shared!: Shared;
  private space!: SpaceView;
  private ground!: GroundView;
  private crater: CraterView | null = null;
  private walk: WalkView | null = null;
  private walkBody: WalkBody = "astronaut";
  private overlay!: Scene;
  private overlayCam!: OrthographicCamera;
  private insetRT!: WebGLRenderTarget;
  private insetDisc!: Mesh;
  private insetRing!: Mesh;
  private insetTitle!: Label;
  private insetLine!: Label;
  private view: ViewKind = "space";
  private frame: SceneFrame | null = null;
  private chapterKey = "";
  private w = 1;
  private h = 1;
  private safeLeft = 0;
  private phone = false;
  private raf = 0;
  private lastNow = 0;
  private disposed = false;
  private lost = false;
  private trans: Transition | null = null;
  private readonly tween = new CameraTween();
  private insetShown = false;
  private insetAlpha = 0;
  private flyTimer = 0;
  private dragging: { id: number; x: number; y: number; moved: boolean } | null = null;
  private lastLook = "";
  private reduced = false;

  onLookChange: ((headingDeg: number, fovDeg: number, pitchDeg: number, vfovDeg: number) => void) | null = null;
  onUserLook: (() => void) | null = null;
  onCraterTerrain: ((source: CraterSource) => void) | null = null;
  onWalkSwitch: (() => void) | null = null;
  onWalkEdge: ((atEdge: boolean) => void) | null = null;

  constructor(canvas: HTMLCanvasElement, opts: { pixelRatioCap: number }) {
    this.canvas = canvas;
    this.pixelRatioCap = opts.pixelRatioCap;
    this.build();
    canvas.addEventListener("webglcontextlost", this.onLost);
    canvas.addEventListener("webglcontextrestored", this.onRestored);
    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("pointercancel", this.onUp);
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  private build() {
    this.renderer = new WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
    try {
      this.buildScenes();
    } catch (err) {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      throw err;
    }
  }

  private buildScenes() {
    this.renderer.setClearColor(SPACE_BG, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.pixelRatioCap));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.shared = {
      glow: glowTexture(),
      disc: discTexture(),
      ring: ringTexture(),
      moon: withPhoto(moonTexture(), moonMap, this.requestRender),
      earth: withPhoto(earthTexture(), earthMap, this.requestRender),
      regolith: regolithTexture(),
    };
    this.space = new SpaceView(this.canvas, this.shared);
    this.ground = new GroundView(this.shared);
    this.crater = null;
    this.walk = null;
    for (const c of [this.space.controls]) c.addEventListener("change", this.requestRender);
    this.space.controls.addEventListener("start", this.cancelFly);
    this.overlay = new Scene();
    this.overlayCam = new OrthographicCamera(0, 1, 1, 0, -10, 10);
    this.insetRT = new WebGLRenderTarget(16, 16);
    this.insetDisc = new Mesh(new CircleGeometry(0.5, 72), new MeshBasicMaterial({ map: this.insetRT.texture, transparent: true }));
    this.insetRing = new Mesh(
      new RingGeometry(0.5, 0.5 + 0.012, 72),
      new MeshBasicMaterial({ color: 0xe9ebf0, transparent: true, opacity: 0.85 }),
    );
    this.insetTitle = new Label("", { px: 14, anchorY: 0 });
    this.insetLine = new Label("", { px: 13, anchorY: 0, color: "#ffd98a" });
    this.overlay.add(this.insetDisc, this.insetRing, this.insetTitle.sprite, this.insetLine.sprite);
    if (this.w > 1) this.resize(this.w, this.h, this.safeLeft);
  }

  private ensureCrater(): CraterView {
    if (!this.crater) {
      this.crater = new CraterView(this.canvas, this.shared, (source) => {
        this.onCraterTerrain?.(source);
        this.requestRender();
      });
      this.crater.controls.addEventListener("change", this.requestRender);
      this.crater.phone = this.phone;
      this.applyCamera(this.crater.camera);
      this.crater.fitLabels(this.h);
    }
    return this.crater;
  }

  private ensureWalk(): WalkView {
    if (!this.walk) {
      this.walk = new WalkView(this.shared);
      this.walk.input.onActive = this.requestRender;
      this.walk.input.onSwitch = () => this.onWalkSwitch?.();
      this.walk.onEdge = (e) => this.onWalkEdge?.(e);
      this.walk.setBody(this.walkBody);
      this.applyCamera(this.walk.camera);
    }
    return this.walk;
  }

  setWalkBody(b: WalkBody) {
    if (b === this.walkBody) return;
    this.walkBody = b;
    this.walk?.setBody(b);
    this.requestRender();
  }

  setWalkStick(x: number, y: number) {
    if (this.view !== "walk" || !this.walk) return;
    this.walk.input.setStick(x, y);
    this.requestRender();
  }

  private teardown() {
    window.clearTimeout(this.flyTimer);
    this.space.controls.removeEventListener("change", this.requestRender);
    this.space.controls.removeEventListener("start", this.cancelFly);
    this.space.dispose();
    this.ground.dispose();
    if (this.crater) {
      this.crater.controls.removeEventListener("change", this.requestRender);
      this.crater.dispose();
    }
    const scenes: Object3D[] = [this.space.scene, this.ground.scene, this.overlay];
    if (this.crater) scenes.push(this.crater.scene);
    if (this.walk) {
      this.walk.dispose();
      scenes.push(this.walk.scene);
    }
    for (const s of scenes) disposeTree(s);
    this.insetTitle.dispose();
    this.insetLine.dispose();
    for (const t of Object.values(this.shared)) t.dispose();
    this.insetRT.dispose();
  }

  private readonly onLost = (e: Event) => {
    e.preventDefault();
    this.lost = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  };

  private readonly onRestored = () => {
    this.teardown();
    this.renderer.dispose();
    this.lost = false;
    this.build();
    const f = this.frame;
    this.frame = null;
    this.chapterKey = "";
    if (f) this.update(f);
  };

  private readonly onVisibility = () => {
    if (document.hidden) {
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
    } else this.requestRender();
  };

  private readonly cancelFly = () => {
    window.clearTimeout(this.flyTimer);
    if (this.tween.active && this.view === "space") {
      this.tween.cancel();
      this.insetShown = true;
    }
  };

  readonly requestRender = () => {
    if (this.raf || this.disposed || this.lost) return;
    this.raf = requestAnimationFrame(this.loop);
  };

  private spacePreset(f: SceneFrame): SpacePreset {
    if (f.chapter === "day") return "day";
    return "explore";
  }

  private applyCamera(cam: PerspectiveCamera) {
    const s = this.safeLeft / 2;
    if (s > 0) {
      cam.aspect = (this.w + 2 * s) / this.h;
      cam.setViewOffset(this.w + 2 * s, this.h, 0, 0, this.w, this.h);
    } else {
      cam.aspect = this.w / this.h;
      cam.clearViewOffset();
    }
    cam.updateProjectionMatrix();
  }

  resize(w: number, h: number, safeLeft = 0) {
    this.w = Math.max(1, Math.round(w));
    this.h = Math.max(1, Math.round(h));
    this.safeLeft = safeLeft;
    this.phone = window.innerWidth < 760;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth < 700 ? 1.5 : this.pixelRatioCap));
    this.renderer.setSize(this.w, this.h, false);
    this.ground.camera.fov = this.groundFov();
    this.ground.phone = this.phone;
    if (this.crater) this.crater.phone = this.phone;
    this.applyCamera(this.space.camera);
    this.applyCamera(this.ground.camera);
    if (this.crater) this.applyCamera(this.crater.camera);
    if (this.walk) this.applyCamera(this.walk.camera);
    this.space.fitLabels(this.h);
    if (this.crater) this.crater.fitLabels(this.h);
    this.overlayCam.left = 0;
    this.overlayCam.right = this.w;
    this.overlayCam.top = this.h;
    this.overlayCam.bottom = 0;
    this.overlayCam.updateProjectionMatrix();
    const r = insetRect(this.w, this.h, this.phone);
    const px = Math.round(r.size * this.renderer.getPixelRatio());
    this.insetRT.setSize(px, px);
    this.insetDisc.scale.setScalar(r.size);
    this.insetRing.scale.setScalar(r.size);
    this.insetDisc.position.set(r.x + r.size / 2, r.y + r.size / 2, 0);
    this.insetRing.position.copy(this.insetDisc.position);
    this.placeCaption();
    if (this.frame && this.frame.view === "space" && !this.tween.active) {
      this.poseSpace(this.frame, true);
    }
    this.requestRender();
  }

  private placeCaption() {
    const r = insetRect(this.w, this.h, this.phone);
    const cx = r.x + r.size / 2;
    const fitX = (l: Label) => Math.min(cx, this.w - 8 - l.widthPx / 2);
    this.insetTitle.fitPixels();
    this.insetLine.fitPixels();
    this.insetTitle.sprite.position.set(fitX(this.insetTitle), r.y + r.size + 30, 1);
    this.insetLine.sprite.position.set(fitX(this.insetLine), r.y + r.size + 8, 1);
  }

  private groundFov(): number {
    const f = this.frame;
    const ch = f?.chapter;
    if (f && this.ground.eclipseZoom(f)) return 14;
    if (ch === "earth" && f?.site.id !== "change4") return 100;
    if (ch === "pole") return this.phone ? 76 : 66;
    return this.phone ? 70 : 60;
  }

  private poseSpace(f: SceneFrame, snap: boolean) {
    const preset = this.spacePreset(f);
    const sv = this.space;
    sv.controls.enabled = true;
    sv.controls.enableDamping = !f.reducedMotion;
    if (snap || f.reducedMotion) {
      this.tween.cancel();
      const p = sv.pose(preset, this.phone);
      sv.camera.position.copy(p.pos);
      sv.controls.target.copy(p.target);
      sv.camera.lookAt(p.target);
      sv.controls.update();
    } else {
      this.tween.run(sv.camera, sv.controls.target, () => sv.pose(preset, this.phone), 1200, performance.now());
    }
  }

  private enterView(f: SceneFrame, snap: boolean) {
    this.space.controls.enabled = false;
    if (this.crater) this.crater.controls.enabled = false;
    this.canvas.style.cursor = "";
    this.walk?.setActive(this.view === "walk");
    if (this.view === "space") this.poseSpace(f, snap);
    else if (this.view === "crater") {
      const c = this.ensureCrater();
      const p = c.pose(this.phone);
      c.camera.position.copy(p.pos);
      c.controls.target.copy(p.target);
      c.camera.lookAt(p.target);
      c.controls.enabled = true;
      c.controls.enableDamping = !f.reducedMotion;
      c.controls.update();
    } else if (this.view === "walk") {
      this.canvas.style.cursor = "grab";
      const w = this.ensureWalk();
      w.setActive(true);
      w.update(f);
    } else {
      this.canvas.style.cursor = "grab";
      this.ground.camera.fov = this.groundFov();
      this.applyCamera(this.ground.camera);
      this.ground.update(f);
      this.ground.snap();
    }
  }

  private onChapter(f: SceneFrame) {
    window.clearTimeout(this.flyTimer);
    this.tween.cancel();
    this.insetAlpha = 0;
    this.insetShown = f.inset === "ground" && (f.reducedMotion || f.chapter !== "day");
    if (f.view === this.view && !this.trans) this.enterView(f, f.reducedMotion);
    if (f.chapter === "day" && !f.reducedMotion) {
      this.flyTimer = window.setTimeout(() => this.flyDown(), 2600);
    }
  }

  private flyDown() {
    const f = this.frame;
    if (!f || this.view !== "space" || f.chapter !== "day") return;
    const sv = this.space;
    const now = performance.now();
    this.tween.run(sv.camera, sv.controls.target, () => sv.pose("fly", this.phone), 1300, now, () => {
      this.insetShown = true;
      this.tween.run(sv.camera, sv.controls.target, () => sv.pose("day", this.phone), 1300, performance.now());
      this.requestRender();
    });
    this.requestRender();
  }

  update(frame: SceneFrame) {
    if (this.disposed) return;
    const first = this.frame === null;
    this.frame = frame;
    this.reduced = frame.reducedMotion;
    const fov = this.groundFov();
    if (fov !== this.ground.camera.fov) {
      this.ground.camera.fov = fov;
      this.applyCamera(this.ground.camera);
    }
    this.space.follow = frame.chapter === "day" && this.view === "space";
    this.space.update(frame);
    if (frame.view === "ground" || frame.inset === "ground" || this.view === "ground") this.ground.update(frame);
    if (first) {
      this.view = frame.view;
      this.chapterKey = frame.chapter;
      this.ground.camera.fov = this.groundFov();
      this.enterView(frame, true);
      this.onChapter(frame);
    } else if (frame.chapter !== this.chapterKey) {
      this.chapterKey = frame.chapter;
      this.onChapter(frame);
    }
    const target = this.trans ? this.trans.to : this.view;
    if (frame.view !== target) this.startTransition(frame.view);
    if (frame.view === "crater" || this.view === "crater") this.ensureCrater().update(frame, performance.now());
    if (frame.view === "walk" || this.view === "walk") this.ensureWalk().update(frame);
    if (frame.inset === "ground") {
      const site = frame.site.name;
      this.insetTitle.set(this.phone ? "Standing there" : `Standing at ${site}`);
      this.insetLine.set(describeShort(frame.sky));
      this.placeCaption();
    }
    this.requestRender();
  }

  private startTransition(to: ViewKind) {
    const now = performance.now();
    if (this.reduced) {
      this.trans = { phase: "out", start: now, dur: 75, to, half: 75 };
    } else if (this.view === "space" && to === "ground" && !this.trans) {
      this.trans = { phase: "fly", start: now, dur: 800, to, half: 200 };
      const sv = this.space;
      sv.controls.enabled = false;
      this.tween.run(sv.camera, sv.controls.target, () => sv.pose("fly", this.phone), 800, now);
    } else {
      this.trans = { phase: "out", start: now, dur: 200, to, half: 200 };
    }
  }

  private stepTransition(now: number) {
    const t = this.trans;
    if (!t) return;
    const p = Math.min(1, (now - t.start) / t.dur);
    if (t.phase === "out") this.canvas.style.opacity = String(1 - p);
    if (t.phase === "in") this.canvas.style.opacity = String(p);
    if (p < 1) return;
    if (t.phase === "fly") {
      this.trans = { ...t, phase: "out", start: now, dur: t.half };
    } else if (t.phase === "out") {
      this.tween.cancel();
      this.view = t.to;
      if (this.frame) {
        if (this.view === "ground") this.ground.update(this.frame);
        this.enterView(this.frame, true);
      }
      this.trans = { ...t, phase: "in", start: now, dur: t.half };
    } else {
      this.canvas.style.opacity = "1";
      this.trans = null;
    }
  }

  private readonly loop = (now: number) => {
    this.raf = 0;
    if (this.disposed || this.lost || !this.frame) return;
    const dt = this.lastNow ? Math.min(0.1, (now - this.lastNow) / 1000) : 0.016;
    this.lastNow = now;
    let more = false;
    if (this.trans) {
      this.stepTransition(now);
      more = true;
    }
    const f = this.frame;
    if (this.view === "space") {
      const sv = this.space;
      if (this.tween.active) {
        this.tween.step(sv.camera, sv.controls.target, now);
        more = true;
      } else if (sv.controls.enabled && sv.controls.update()) more = true;
      sv.setPinPulse(now, f.reducedMotion);
    } else if (this.view === "crater" && this.crater) {
      if (this.crater.controls.update()) more = true;
      this.crater.update(f, now);
    } else if (this.view === "ground") {
      if (this.ground.step(dt, f.reducedMotion)) more = true;
    } else if (this.view === "walk" && this.walk) {
      if (this.walk.step(dt, f.reducedMotion)) more = true;
    }
    if (f.inset === "ground" && this.view !== "ground") {
      if (this.ground.step(dt, f.reducedMotion)) more = true;
      const goal = this.insetShown ? 1 : 0;
      if (this.insetAlpha !== goal) {
        this.insetAlpha = f.reducedMotion ? goal : clamp(this.insetAlpha + (goal ? dt : -dt) * 3, 0, 1);
        more = true;
      }
    }
    this.render();
    if (more) this.requestRender();
  };

  private render() {
    const r = this.renderer;
    const f = this.frame;
    if (!f) return;
    r.setRenderTarget(null);
    r.autoClear = true;
    if (this.view === "space") {
      r.render(this.space.scene, this.space.camera);
    } else if (this.view === "crater" && this.crater) {
      r.render(this.crater.scene, this.crater.camera);
    } else if (this.view === "walk" && this.walk) {
      r.render(this.walk.scene, this.walk.camera);
    } else {
      this.ground.fitLabels(this.h, this.ground.camera);
      r.render(this.ground.scene, this.ground.camera);
      this.emitLook();
    }
    if (f.inset === "ground" && this.view !== "ground" && this.insetAlpha > 0.01) {
      const size = insetRect(this.w, this.h, this.phone).size;
      this.ground.fitLabels(size * 1.5, this.ground.insetCamera);
      r.setRenderTarget(this.insetRT);
      r.render(this.ground.scene, this.ground.insetCamera);
      r.setRenderTarget(null);
      const a = this.insetAlpha;
      (this.insetDisc.material as MeshBasicMaterial).opacity = a;
      (this.insetRing.material as MeshBasicMaterial).opacity = 0.85 * a;
      this.insetTitle.sprite.material.opacity = a;
      this.insetLine.sprite.material.opacity = a;
      r.autoClear = false;
      r.clearDepth();
      r.render(this.overlay, this.overlayCam);
      r.autoClear = true;
    }
  }

  private emitLook() {
    if (!this.onLookChange) return;
    const cam = this.ground.camera;
    const areaW = Math.max(1, this.w - this.safeLeft);
    const hfov = (2 * Math.atan(Math.tan((cam.fov * Math.PI) / 360) * (areaW / this.h)) * 180) / Math.PI;
    const yaw = this.ground.look.yaw;
    const pitch = this.ground.look.pitch;
    const key = `${yaw.toFixed(1)}|${hfov.toFixed(1)}|${pitch.toFixed(1)}|${cam.fov.toFixed(1)}`;
    if (key === this.lastLook) return;
    this.lastLook = key;
    this.onLookChange(yaw, hfov, pitch, cam.fov);
  }

  lookAt(azDeg: number, elDeg = 10) {
    if (this.view !== "ground") return;
    this.ground.turnTo(azDeg, elDeg);
    this.onUserLook?.();
    this.requestRender();
  }

  private readonly onDown = (e: PointerEvent) => {
    if ((this.view !== "ground" && this.view !== "walk") || e.button !== 0) return;
    this.dragging = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    this.canvas.setPointerCapture?.(e.pointerId);
    this.canvas.style.cursor = "grabbing";
  };

  private readonly onMove = (e: PointerEvent) => {
    const d = this.dragging;
    if (!d || d.id !== e.pointerId || (this.view !== "ground" && this.view !== "walk")) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 3) return;
    if (!d.moved) {
      d.moved = true;
      if (this.view === "ground") this.onUserLook?.();
    }
    d.x = e.clientX;
    d.y = e.clientY;
    if (this.view === "walk" && this.walk) {
      const kw = (this.walk.camera.fov * 2) / this.h;
      this.walk.drag(dx * kw, dy * kw);
    } else {
      const k = this.ground.camera.fov / this.h;
      this.ground.drag(dx * k, dy * k);
    }
    this.requestRender();
  };

  private readonly onUp = (e: PointerEvent) => {
    if (!this.dragging || this.dragging.id !== e.pointerId) return;
    this.dragging = null;
    if (this.view === "ground" || this.view === "walk") this.canvas.style.cursor = "grab";
  };

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    window.clearTimeout(this.flyTimer);
    this.canvas.removeEventListener("webglcontextlost", this.onLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onRestored);
    this.canvas.removeEventListener("pointerdown", this.onDown);
    this.canvas.removeEventListener("pointermove", this.onMove);
    this.canvas.removeEventListener("pointerup", this.onUp);
    this.canvas.removeEventListener("pointercancel", this.onUp);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.teardown();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
