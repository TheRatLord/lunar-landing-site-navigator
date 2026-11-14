import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  type Texture,
} from "three";

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2d canvas unavailable");
  return [c, ctx];
}

function tex(c: HTMLCanvasElement, srgb = true): CanvasTexture {
  const t = new CanvasTexture(c);
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function softBlob(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  lat: number,
  lon: number,
  rLatDeg: number,
  rLonDeg: number,
  color: string,
  alpha: number,
  hard = 0.55,
) {
  const cx = (0.5 + lon / 360) * W;
  const cy = (0.5 - lat / 180) * H;
  const ry = (rLatDeg / 180) * H;
  const rx = ((rLonDeg / Math.max(0.15, Math.cos((lat * Math.PI) / 180))) / 360) * W;
  for (const off of [-W, 0, W]) {
    ctx.save();
    ctx.translate(cx + off, cy);
    ctx.scale(rx / ry, 1);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, ry);
    g.addColorStop(0, color);
    g.addColorStop(hard, color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = alpha;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, ry, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

export function withPhoto(t: CanvasTexture, url: string, onLoad: () => void): CanvasTexture {
  const [c, ctx] = canvas(2048, 1024);
  ctx.drawImage(t.image, 0, 0, c.width, c.height);
  t.image = c;
  const img = new Image();
  img.decoding = "async";
  img.onload = () => {
    ctx.drawImage(img, 0, 0, c.width, c.height);
    t.needsUpdate = true;
    onLoad();
  };
  img.src = url;
  return t;
}

export function moonTexture(): CanvasTexture {
  const W = 1024;
  const H = 512;
  const [c, ctx] = canvas(W, H);
  const r = rng(7);
  ctx.fillStyle = "#9a9a9c";
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 1800; i++) {
    const v = 110 + Math.floor(r() * 80);
    ctx.fillStyle = `rgba(${v},${v},${v + 2},0.12)`;
    ctx.beginPath();
    ctx.arc(r() * W, r() * H, 2 + r() * 14, 0, Math.PI * 2);
    ctx.fill();
  }
  const maria: [number, number, number, number?][] = [
    [18, -57, 16],
    [33, -16, 9],
    [28, 17, 6],
    [8, 31, 7],
    [17, 59, 4.5],
    [-8, 51, 6],
    [-15, 35, 3.5],
    [-21, -17, 6],
  ];
  for (const [la, lo, rr] of maria) softBlob(ctx, W, H, la, lo, rr, rr, "#4d4d52", 0.85);
  softBlob(ctx, W, H, 56, 0, 4, 25, "#55555a", 0.7);
  softBlob(ctx, W, H, 10, -40, 12, 10, "#4d4d52", 0.6);
  softBlob(ctx, W, H, -53, -169, 20, 20, "#6e6e72", 0.45, 0.3);
  for (let i = 0; i < 400; i++) {
    const lat = Math.asin(r() * 2 - 1) * (180 / Math.PI);
    const lon = r() * 360 - 180;
    const rd = 0.3 + r() ** 4 * 3.5;
    const cx = (0.5 + lon / 360) * W;
    const cy = (0.5 - lat / 180) * H;
    const ry = (rd / 180) * H;
    const rx = ry / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(rx / ry, 1);
    ctx.lineWidth = Math.max(0.6, ry * 0.25);
    ctx.strokeStyle = "rgba(205,205,210,0.2)";
    ctx.beginPath();
    ctx.arc(0, -ry * 0.08, ry, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(40,40,45,0.18)";
    ctx.beginPath();
    ctx.arc(0, ry * 0.08, ry, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  softBlob(ctx, W, H, -43, -11, 1.2, 1.2, "#e8e8ea", 0.9);
  return tex(c);
}

export function earthTexture(): CanvasTexture {
  const W = 512;
  const H = 256;
  const [c, ctx] = canvas(W, H);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#1b3f78");
  g.addColorStop(0.5, "#1f5aa6");
  g.addColorStop(1, "#1b3f78");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const land: [number, number, number, number, string][] = [
    [48, -100, 16, 26, "#4f7a3a"],
    [62, -110, 10, 28, "#6b7f4c"],
    [72, -42, 8, 14, "#e9eef2"],
    [20, -100, 8, 8, "#5d7b3c"],
    [-12, -60, 18, 12, "#3f7a33"],
    [-35, -66, 12, 6, "#6b7f4c"],
    [50, 15, 9, 14, "#5f7d42"],
    [10, 20, 16, 18, "#a08750"],
    [-12, 25, 14, 12, "#4f7a3a"],
    [25, 45, 8, 10, "#b39a5c"],
    [50, 90, 16, 40, "#6b7f4c"],
    [30, 100, 10, 20, "#5d7b3c"],
    [20, 78, 8, 6, "#6f8a45"],
    [0, 110, 6, 12, "#3f7a33"],
    [-25, 135, 9, 15, "#b08a52"],
  ];
  for (const [la, lo, rl, rn, col] of land) softBlob(ctx, W, H, la, lo, rl, rn, col, 1, 0.7);
  ctx.fillStyle = "#eef2f5";
  ctx.fillRect(0, H * 0.92, W, H * 0.08);
  ctx.fillRect(0, 0, W, H * 0.04);
  const r = rng(11);
  for (let i = 0; i < 70; i++) {
    const lat = r() * 140 - 70;
    softBlob(ctx, W, H, lat, r() * 360 - 180, 2 + r() * 4, 6 + r() * 18, "#ffffff", 0.35, 0.2);
  }
  return tex(c);
}

export function regolithTexture(): CanvasTexture {
  const S = 256;
  const [c, ctx] = canvas(S, S);
  ctx.fillStyle = "#8c8c8e";
  ctx.fillRect(0, 0, S, S);
  const r = rng(3);
  for (let i = 0; i < 5000; i++) {
    const v = 90 + Math.floor(r() * 90);
    ctx.fillStyle = `rgba(${v},${v},${v},0.35)`;
    ctx.fillRect(r() * S, r() * S, 1 + r() * 2, 1 + r() * 2);
  }
  for (let i = 0; i < 40; i++) {
    const x = r() * S;
    const y = r() * S;
    const rad = 2 + r() * 9;
    ctx.strokeStyle = "rgba(210,210,210,0.35)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(x, y - 0.6, rad, Math.PI, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(40,40,40,0.35)";
    ctx.beginPath();
    ctx.arc(x, y + 0.6, rad, 0, Math.PI);
    ctx.stroke();
  }
  const t = tex(c);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.repeat.set(60, 60);
  return t;
}

export function glowTexture(): CanvasTexture {
  const S = 128;
  const [c, ctx] = canvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.15, "rgba(255,255,255,0.55)");
  g.addColorStop(0.4, "rgba(255,255,255,0.14)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return tex(c, false);
}

export function discTexture(): CanvasTexture {
  const S = 128;
  const [c, ctx] = canvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.9, "rgba(255,255,255,1)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return tex(c, false);
}

export function ringTexture(): CanvasTexture {
  const S = 256;
  const [c, ctx] = canvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S / 2);
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(0.62, "rgba(255,255,255,0)");
  g.addColorStop(0.7, "rgba(255,255,255,1)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return tex(c, false);
}

export function starField(radius: number): Points {
  const count = 1500;
  const r = rng(5);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const c = new Color();
  for (let i = 0; i < count; i++) {
    const z = r() * 2 - 1;
    const a = r() * Math.PI * 2;
    const s = Math.sqrt(1 - z * z);
    pos[i * 3] = s * Math.cos(a) * radius;
    pos[i * 3 + 1] = z * radius;
    pos[i * 3 + 2] = s * Math.sin(a) * radius;
    const b = 0.25 + r() ** 3 * 0.75;
    c.setRGB(b, b, b * (0.9 + r() * 0.2));
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(pos, 3));
  g.setAttribute("color", new BufferAttribute(col, 3));
  const m = new PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, depthWrite: false });
  const p = new Points(g, m);
  p.renderOrder = -10;
  p.frustumCulled = false;
  return p;
}

interface LabelOpts {
  color?: string;
  px?: number;
  bg?: string;
  anchorX?: number;
  anchorY?: number;
}

export class Label {
  readonly sprite: Sprite;
  private text = "";
  private aspect = 1;
  readonly px: number;
  private readonly opts: Required<LabelOpts>;

  constructor(text: string, opts: LabelOpts = {}) {
    this.opts = {
      color: opts.color ?? "#f2f3f5",
      px: opts.px ?? 15,
      bg: opts.bg ?? "rgba(5,6,10,0.62)",
      anchorX: opts.anchorX ?? 0.5,
      anchorY: opts.anchorY ?? 0.5,
    };
    this.px = this.opts.px;
    const mat = new SpriteMaterial({ transparent: true, depthTest: true, depthWrite: false, sizeAttenuation: false });
    this.sprite = new Sprite(mat);
    this.sprite.center.set(this.opts.anchorX, this.opts.anchorY);
    this.sprite.renderOrder = 10;
    this.set(text);
  }

  set(text: string) {
    if (text === this.text) return;
    this.text = text;
    const scale = 3;
    const fs = this.opts.px * scale;
    const padX = fs * 0.55;
    const padY = fs * 0.32;
    const font = `600 ${fs}px "Inter Variable", Inter, system-ui, sans-serif`;
    const [m, mctx] = canvas(8, 8);
    mctx.font = font;
    const w = Math.ceil(mctx.measureText(text).width + padX * 2);
    const h = Math.ceil(fs * 1.25 + padY * 2);
    m.width = w;
    m.height = h;
    mctx.font = font;
    if (this.opts.bg !== "none") {
      mctx.fillStyle = this.opts.bg;
      const rr = h / 2;
      mctx.beginPath();
      mctx.roundRect(0, 0, w, h, rr);
      mctx.fill();
    }
    mctx.fillStyle = this.opts.color;
    mctx.textBaseline = "middle";
    mctx.textAlign = "center";
    if (this.opts.bg === "none") {
      mctx.shadowColor = "rgba(0,0,0,0.9)";
      mctx.shadowBlur = fs * 0.3;
    }
    mctx.fillText(text, w / 2, h / 2 + fs * 0.04);
    const mat = this.sprite.material;
    mat.map?.dispose();
    mat.map = tex(m);
    mat.needsUpdate = true;
    this.aspect = w / h;
    this.heightPx = h / scale;
  }

  heightPx = 0;

  get widthPx(): number {
    return this.heightPx * this.aspect;
  }

  fit(viewportH: number, fovDeg: number) {
    const k = (2 * Math.tan((fovDeg * Math.PI) / 360)) / Math.max(1, viewportH);
    const hy = this.heightPx * k;
    this.sprite.scale.set(hy * this.aspect, hy, 1);
  }

  fitPixels() {
    this.sprite.scale.set(this.heightPx * this.aspect, this.heightPx, 1);
  }

  dispose() {
    this.sprite.material.map?.dispose();
    this.sprite.material.dispose();
  }
}

export function glowSprite(map: Texture, color: string, opacity = 1): Sprite {
  const s = new Sprite(
    new SpriteMaterial({ map, color, transparent: true, blending: AdditiveBlending, depthWrite: false, opacity }),
  );
  return s;
}

export function arrow(length: number, headLength: number, headWidth: number, color: number): Group {
  const g = new Group();
  const mat = new MeshBasicMaterial({ color });
  const shaftLen = length - headLength;
  const shaft = new Mesh(new CylinderGeometry(headWidth * 0.16, headWidth * 0.16, shaftLen, 12), mat);
  shaft.rotation.z = -Math.PI / 2;
  shaft.position.x = shaftLen / 2;
  const head = new Mesh(new ConeGeometry(headWidth / 2, headLength, 32), mat);
  head.rotation.z = -Math.PI / 2;
  head.position.x = shaftLen + headLength / 2;
  g.add(shaft, head);
  return g;
}
