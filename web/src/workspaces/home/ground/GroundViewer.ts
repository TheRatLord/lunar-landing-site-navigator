import * as THREE from "three";
import { CSM } from "three/examples/jsm/csm/CSM.js";
import type { HorizonProfile } from "../../../contract/types";
import { earthTexture } from "../../../learn/scene/textures";
import type { GroundLevel, Vec3 } from "./groundMesh";
import { skyVector } from "./groundMesh";

/** One picture: where the eye is, where it looks, and where the engine puts the Sun and Earth. */
export interface GroundFrame {
  eye: Vec3;
  forward: Vec3;
  fovDeg: number;
  /** Height of the eye above the ground under it (m), for the near plane. */
  aboveGroundM: number;
  /** Unit vectors, east/north/up at the site, from the engine's apparent tracks. */
  toSun: Vec3;
  toEarth: Vec3;
  sunRadiusDeg: number;
  earthRadiusDeg: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
  /** In front of the camera and inside the picture. */
  onScreen: boolean;
}

const FAR_M = 2_000_000;
const MAX_PIXEL_RATIO = 2;
/**
 * Cascaded shadow maps out to the edge of the drawn terrain (50 km half-width, 71 km to a corner).
 * The light boxes reach far up-Sun so a ridge at the far edge still shadows the site at grazing Sun.
 */
const SHADOW_FAR_M = 80_000;
const LIGHT_MARGIN_M = 120_000;
const SHADOW_NORMAL_BIAS_M = 0.5;
const SHADOW_NORMAL_BIAS_TEXELS = 0.6;
const SUN_INTENSITY = 1.15 * Math.PI;
/** A faint blue fill and ambient show the shape of unlit ground. A display aid, not physics. */
const FILL_INTENSITY = 0.1;
const AMBIENT_INTENSITY = 0.025;
/** The engine's horizon beyond the drawn terrain is a ring this far out; the Sun and Earth sit beyond it. */
const SKYLINE_M = 400_000;
const SUN_CUTOFF_Z = -Math.sin((3 * Math.PI) / 180);
const SKY_M = 1_500_000;

// The depth buffer is logarithmic (centimetres near the eye, hundreds of kilometres away), so a
// hand-written shader has to write its depth the same way.
const EARTH_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vNormal;
varying vec2 vUv;
void main() {
  vNormal = normalize(mat3(modelMatrix) * normal);
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`;
// Lit by the same Sun direction as the terrain, so its phase is the one seen from the site. The map
// is decoration: Earth's rotation is not modelled.
const EARTH_FRAGMENT = /* glsl */ `
uniform vec3 toSun;
uniform sampler2D map;
varying vec3 vNormal;
varying vec2 vUv;
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  float lit = smoothstep(-0.04, 0.12, dot(normalize(vNormal), toSun));
  vec3 day = texture2D(map, vUv).rgb;
  gl_FragColor = vec4(day * (0.03 + 0.97 * lit), 1.0);
  #include <colorspace_fragment>
}`;

/**
 * The ground view: LOLA terrain lit only by the engine's Sun direction, shadowed with cascaded
 * shadow maps, ringed by the engine's own horizon beyond the drawn terrain, with the Sun and Earth
 * at their true angular sizes. Draws only when asked, at most once per screen refresh.
 *
 * Adapted from the 3D terrain view of the team's Sightline app (`sightline/web/src/three/TerrainViewer.ts`).
 */
export class GroundViewer {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(55, 1, 1, FAR_M);
  private readonly csm: CSM;
  private readonly terrainMaterial = new THREE.MeshStandardMaterial({ color: 0xa9a9a9, roughness: 1, metalness: 0 });
  private readonly skylineMaterial = new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 1, metalness: 0, side: THREE.DoubleSide });
  private readonly terrain = new THREE.Group();
  private readonly skyline = new THREE.Group();
  private readonly sun: THREE.Group;
  private readonly earth: THREE.Mesh;
  private readonly earthUniforms = { toSun: { value: new THREE.Vector3(0, 0, 1) }, map: { value: earthTexture() as THREE.Texture } };
  private readonly disposables: { dispose(): void }[] = [];
  private frame: GroundFrame | null = null;
  private request: number | null = null;
  private lost = false;
  private lens = { near: 0, aspect: 0, fov: 0 };

  constructor(canvas: HTMLCanvasElement, small: boolean, private readonly onLostChange: (lost: boolean) => void) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !small, logarithmicDepthBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.5 : MAX_PIXEL_RATIO));
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    canvas.addEventListener("webglcontextlost", this.handleLost);
    canvas.addEventListener("webglcontextrestored", this.handleRestored);
    this.camera.up.set(0, 0, 1); // east, north, up

    this.csm = new CSM({
      camera: this.camera,
      parent: this.scene,
      cascades: small ? 3 : 4,
      maxFar: SHADOW_FAR_M,
      mode: "practical",
      shadowMapSize: small ? 1024 : 2048,
      lightDirection: new THREE.Vector3(0, 0, -1),
      lightIntensity: SUN_INTENSITY,
      lightNear: 1,
      lightFar: LIGHT_MARGIN_M + 2 * SHADOW_FAR_M,
      lightMargin: LIGHT_MARGIN_M,
    });
    this.csm.setupMaterial(this.terrainMaterial);
    this.csm.setupMaterial(this.skylineMaterial);

    const fill = new THREE.DirectionalLight(0x8cadff, FILL_INTENSITY);
    fill.position.set(-0.7, 0.7, 1);
    this.scene.add(this.terrain, this.skyline, fill, new THREE.AmbientLight(0xffffff, AMBIENT_INTENSITY));
    this.sun = this.buildSun();
    this.earth = this.buildEarth();
    this.scene.add(this.sun, this.earth);
  }

  private buildSun(): THREE.Group {
    const ball = new THREE.SphereGeometry(1, 48, 24);
    const material = new THREE.MeshBasicMaterial({ color: 0xfff6e6 });
    const glowTexture = radialGlow();
    const glow = (color: number, opacity: number, size: number) => {
      const m = new THREE.SpriteMaterial({ map: glowTexture, color, opacity, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      this.disposables.push(m);
      const s = new THREE.Sprite(m);
      s.scale.setScalar(size);
      return s;
    };
    this.disposables.push(ball, material, glowTexture);
    const group = new THREE.Group();
    // A tight corona and a faint wide halo, as the Sun looks in a camera with no air around it.
    group.add(new THREE.Mesh(ball, material), glow(0xffe2a8, 0.9, 4), glow(0xffb85c, 0.3, 14));
    return group;
  }

  private buildEarth(): THREE.Mesh {
    const ball = new THREE.SphereGeometry(1, 64, 32);
    const material = new THREE.ShaderMaterial({ uniforms: this.earthUniforms, vertexShader: EARTH_VERTEX, fragmentShader: EARTH_FRAGMENT });
    this.disposables.push(ball, material, this.earthUniforms.map.value);
    const earth = new THREE.Mesh(ball, material);
    earth.rotation.x = -Math.PI / 2;
    return earth;
  }

  private readonly handleLost = (e: Event) => {
    e.preventDefault();
    this.lost = true;
    this.onLostChange(true);
  };

  private readonly handleRestored = () => {
    this.lost = false;
    this.onLostChange(false);
    this.schedule();
  };

  /** Replace the terrain being drawn. */
  setTerrain(levels: GroundLevel[]): void {
    this.release(this.terrain);
    for (const level of levels) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(level.positions, 3));
      geometry.setIndex(new THREE.BufferAttribute(level.indices, 1));
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, this.terrainMaterial);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.terrain.add(mesh);
    }
    this.schedule();
  }

  /**
   * The engine's horizon as a ring beyond the drawn terrain: its top edge is the horizon profile,
   * azimuth by azimuth, so whatever the engine says is hidden behind distant terrain is hidden here
   * too. `eyeM` is the height of the observer the profile was computed for.
   */
  setSkyline(horizon: HorizonProfile | null, eyeM: number): void {
    this.release(this.skyline);
    if (horizon && horizon.az_deg.length > 1) {
      const n = horizon.az_deg.length;
      let low = Infinity;
      for (let i = 0; i < n; i++) low = Math.min(low, horizon.elev_deg[i]!);
      const bottom = Math.min(low, 0) - 4;
      const pos = new Float32Array((n + 1) * 2 * 3);
      for (let k = 0; k <= n; k++) {
        const i = k % n;
        const az = horizon.az_deg[i]!;
        const top = skyVector(az, horizon.elev_deg[i]!);
        const foot = skyVector(az, bottom);
        pos.set([top[0] * SKYLINE_M, top[1] * SKYLINE_M, top[2] * SKYLINE_M + eyeM], k * 6);
        pos.set([foot[0] * SKYLINE_M, foot[1] * SKYLINE_M, foot[2] * SKYLINE_M + eyeM], k * 6 + 3);
      }
      const idx: number[] = [];
      for (let k = 0; k < n; k++) {
        const a = 2 * k;
        idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geometry.setIndex(idx);
      // Faces toward the site, so a far slope is lit when the Sun is behind the viewer.
      const normals = new Float32Array(pos.length);
      for (let k = 0; k <= n; k++) {
        const v = skyVector(horizon.az_deg[k % n]!, 0);
        normals.set([-v[0], -v[1], 0.35, -v[0], -v[1], 0.35], k * 6);
      }
      geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
      this.skyline.add(new THREE.Mesh(geometry, this.skylineMaterial));
    }
    this.schedule();
  }

  /** Point the camera and ask for a frame. */
  draw(frame: GroundFrame): void {
    this.frame = frame;
    this.placeCamera(frame);
    this.schedule();
  }

  /** Where a direction from the eye lands on the canvas, in CSS pixels. */
  project(direction: Vec3): ScreenPoint {
    const v = new THREE.Vector3(...direction).add(this.camera.position).project(this.camera);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, onScreen: v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 };
  }

  private placeCamera({ eye, forward, fovDeg, aboveGroundM }: GroundFrame): void {
    const { camera, canvas } = this;
    const near = Math.max(0.3, Math.min(2_000, aboveGroundM * 0.1));
    const aspect = canvas.clientWidth / Math.max(canvas.clientHeight, 1);
    if (near !== this.lens.near || aspect !== this.lens.aspect || fovDeg !== this.lens.fov) {
      this.lens = { near, aspect, fov: fovDeg };
      camera.near = near;
      camera.aspect = aspect;
      camera.fov = fovDeg;
      camera.updateProjectionMatrix();
      this.csm.updateFrustums();
    }
    if (Math.abs(forward[2]) > 0.999) camera.up.set(0, 1, 0);
    else camera.up.set(0, 0, 1);
    camera.position.set(...eye);
    camera.lookAt(eye[0] + forward[0], eye[1] + forward[1], eye[2] + forward[2]);
    camera.updateMatrixWorld();
  }

  private placeSky({ eye, toSun, toEarth, sunRadiusDeg, earthRadiusDeg }: GroundFrame): void {
    const at = new THREE.Vector3(...eye);
    const place = (o: THREE.Object3D, dir: Vec3, radiusDeg: number) => {
      o.position.set(...dir).normalize().multiplyScalar(SKY_M).add(at);
      o.scale.setScalar(SKY_M * Math.tan((radiusDeg * Math.PI) / 180));
    };
    place(this.sun, toSun, sunRadiusDeg);
    place(this.earth, toEarth, earthRadiusDeg);
    this.earthUniforms.toSun.value.set(...toSun).normalize();
  }

  private schedule(): void {
    if (this.request !== null) return;
    this.request = requestAnimationFrame(() => {
      this.request = null;
      this.render();
    });
  }

  private render(): void {
    const { frame, canvas } = this;
    if (!frame || this.lost || canvas.clientWidth === 0 || canvas.clientHeight === 0) return;
    const size = this.renderer.getSize(new THREE.Vector2());
    if (size.x !== canvas.clientWidth || size.y !== canvas.clientHeight) this.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    this.placeCamera(frame);
    this.csm.lightDirection.set(...frame.toSun).normalize().negate();
    // The drawn terrain curves with the Moon (2.3 degrees down at its corners), so a Sun a little below
    // the site's level horizon still lights ground towards it. Further down it lights nothing.
    const sunUp = frame.toSun[2] > SUN_CUTOFF_Z;
    for (const light of this.csm.lights) {
      light.intensity = sunUp ? SUN_INTENSITY : 0;
      const texelM = (light.shadow.camera.right - light.shadow.camera.left) / light.shadow.mapSize.x;
      light.shadow.normalBias = Math.max(SHADOW_NORMAL_BIAS_M, SHADOW_NORMAL_BIAS_TEXELS * texelM);
    }
    this.csm.update();
    this.placeSky(frame);
    this.renderer.render(this.scene, this.camera);
  }

  private release(group: THREE.Group): void {
    for (const child of group.children) if (child instanceof THREE.Mesh) child.geometry.dispose();
    group.clear();
  }

  /** Free the GPU memory now. */
  dispose(): void {
    if (this.request !== null) cancelAnimationFrame(this.request);
    this.request = null;
    this.canvas.removeEventListener("webglcontextlost", this.handleLost);
    this.canvas.removeEventListener("webglcontextrestored", this.handleRestored);
    this.release(this.terrain);
    this.release(this.skyline);
    this.csm.dispose();
    this.csm.remove();
    this.terrainMaterial.dispose();
    this.skylineMaterial.dispose();
    for (const d of this.disposables) d.dispose();
    this.renderer.dispose();
    if (!this.canvas.isConnected) this.renderer.forceContextLoss();
  }
}

/** A soft round glow for the Sun, drawn once into a small canvas. */
function radialGlow(): THREE.CanvasTexture {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.15, "rgba(255,255,255,0.6)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
