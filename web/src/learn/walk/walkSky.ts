import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
} from "three";
import { RAD, dirFromAzEl, type SkyState } from "../geometry";
import type { Site } from "../sites";
import { glowSprite, starField } from "../scene/textures";
import type { Shared } from "../scene/types";

const R_RING = 3000;
const R_EARTH = 5200;
const R_SUN = 5600;
const AZ_N = 720;

export class WalkSky {
  readonly group = new Group();
  private readonly sunDisc: Sprite;
  private readonly sunGlow: Sprite;
  private readonly earth: Mesh;
  private readonly earthMat: ShaderMaterial;
  private readonly ringGeo = new BufferGeometry();
  private readonly ringMat = new MeshBasicMaterial({ color: 0x1d1e22, side: DoubleSide });
  private readonly edgeGeo = new BufferGeometry();
  private readonly edgeMat = new MeshBasicMaterial({ color: 0x8d919c, side: DoubleSide, transparent: true, opacity: 0.6 });
  private readonly sun = new Vector3(0, 1, 0);
  private ringKey = "";

  constructor(shared: Shared) {
    this.group.add(starField(6400));
    this.sunDisc = new Sprite(new SpriteMaterial({ map: shared.disc, color: "#fff7e6", transparent: true, fog: false }));
    this.sunGlow = glowSprite(shared.glow, "#ffc96b", 0.9);
    this.sunGlow.material.depthTest = true;
    this.sunGlow.renderOrder = 3;
    this.earthMat = new ShaderMaterial({
      uniforms: { map: { value: shared.earth }, sunDir: { value: new Vector3(1, 0, 0) } },
      vertexShader:
        "varying vec2 vUv; varying vec3 vN; void main() { vUv = uv; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader:
        "uniform sampler2D map; uniform vec3 sunDir; varying vec2 vUv; varying vec3 vN; void main() { vec3 c = texture2D(map, vUv).rgb; float l = max(dot(normalize(vN), sunDir), 0.0); gl_FragColor = vec4(c * (0.05 + 1.3 * l), 1.0);\n#include <colorspace_fragment>\n}",
    });
    this.earth = new Mesh(new SphereGeometry(1, 48, 24), this.earthMat);
    for (const g of [this.ringGeo, this.edgeGeo]) {
      g.setAttribute("position", new BufferAttribute(new Float32Array((AZ_N + 1) * 2 * 3), 3));
      g.setIndex(strip());
    }
    const ring = new Mesh(this.ringGeo, this.ringMat);
    const edge = new Mesh(this.edgeGeo, this.edgeMat);
    ring.frustumCulled = false;
    edge.frustumCulled = false;
    edge.renderOrder = 2;
    this.group.add(this.sunGlow, this.sunDisc, this.earth, ring, edge);
  }

  sunDir(out: Vector3): Vector3 {
    return out.copy(this.sun);
  }

  update(sky: SkyState, site: Site, d: number): void {
    this.buildRing(site);
    const s = dirFromAzEl(sky.sun.az, sky.sun.el);
    this.sun.set(s[0], s[1], s[2]);
    this.sunDisc.position.copy(this.sun).multiplyScalar(R_SUN);
    const rs = R_SUN * Math.tan(sky.sun.radius * RAD);
    this.sunDisc.scale.setScalar(rs * 2);
    this.sunGlow.position.copy(this.sunDisc.position);
    this.sunGlow.scale.setScalar(rs * 16);
    this.sunGlow.material.opacity = 0.9 * (1 - sky.eclipsed * 0.95);
    const e = dirFromAzEl(sky.earth.az, sky.earth.el);
    this.earth.position.set(e[0] * R_EARTH, e[1] * R_EARTH, e[2] * R_EARTH);
    this.earth.scale.setScalar(R_EARTH * Math.tan(sky.earth.radius * RAD));
    this.earth.rotation.set(0, d * 2 * Math.PI * 1.0027, 0.41);
    (this.earthMat.uniforms.sunDir!.value as Vector3).copy(this.sun);
    const day = sky.sunlight > 0.05;
    this.ringMat.color.set(day ? 0x2b2c31 : 0x111215);
    this.edgeMat.opacity = day ? 0.7 : 0.3;
  }

  private buildRing(site: Site): void {
    const key = `${site.id}|${"terrain" in site && site.terrain ? "dem" : "sim"}`;
    if (key === this.ringKey) return;
    this.ringKey = key;
    const ring = this.ringGeo.getAttribute("position") as BufferAttribute;
    const edge = this.edgeGeo.getAttribute("position") as BufferAttribute;
    for (let i = 0; i <= AZ_N; i++) {
      const az = (i / AZ_N) * 360;
      const top = R_RING * Math.tan(site.horizon(az) * RAD);
      const x = Math.sin(az * RAD) * R_RING;
      const z = -Math.cos(az * RAD) * R_RING;
      ring.setXYZ(i * 2, x, top, z);
      ring.setXYZ(i * 2 + 1, x, -R_RING * 0.3, z);
      edge.setXYZ(i * 2, x, top + 4, z);
      edge.setXYZ(i * 2 + 1, x, top - 4, z);
    }
    ring.needsUpdate = true;
    edge.needsUpdate = true;
  }

  dispose(): void {
    this.ringGeo.dispose();
    this.edgeGeo.dispose();
  }
}

function strip(): number[] {
  const idx: number[] = [];
  for (let i = 0; i < AZ_N; i++) {
    const a = i * 2;
    const b = a + 2;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  return idx;
}
