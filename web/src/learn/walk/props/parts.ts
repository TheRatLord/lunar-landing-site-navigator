import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
  MeshPhongMaterial,
  SRGBColorSpace,
  type BufferGeometry,
  type Material,
} from "three";

export const foil = new MeshPhongMaterial({ color: 0xc9962e, specular: 0xffe3a3, shininess: 70 });
export const silver = new MeshLambertMaterial({ color: 0xc9cbd0 });
export const darkGrey = new MeshLambertMaterial({ color: 0x4a4c52 });
export const cells = new MeshPhongMaterial({ color: 0x1b2a55, specular: 0x8aa0ff, shininess: 70 });

export function mesh(geo: BufferGeometry, mat: Material, x = 0, y = 0, z = 0): Mesh {
  const m = new Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function box(w: number, h: number, d: number, mat: Material, x: number, y: number, z: number): Mesh {
  return mesh(new BoxGeometry(w, h, d), mat, x, y, z);
}

export function strut(group: Group, ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number, mat: Material): void {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  const m = mesh(new CylinderGeometry(r, r, len, 8), mat, (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
  m.lookAt(bx, by, bz);
  m.rotateX(Math.PI / 2);
  group.add(m);
}

export function legs(group: Group, n: number, bodyR: number, bodyY: number, padR: number, padSpan: number, mat: Material): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.PI / n;
    const bx = Math.cos(a) * bodyR;
    const bz = Math.sin(a) * bodyR;
    const px = Math.cos(a) * padSpan;
    const pz = Math.sin(a) * padSpan;
    strut(group, bx, bodyY, bz, px, 0.12, pz, 0.06, mat);
    strut(group, bx * 0.7, bodyY - 0.4, bz * 0.7, px, 0.12, pz, 0.04, mat);
    group.add(mesh(new CylinderGeometry(padR, padR * 1.1, 0.12, 16), mat, px, 0.06, pz));
  }
}

function canvasTexture(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext("2d")!;
  draw(ctx);
  const t = new CanvasTexture(cv);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export function usFlag(): CanvasTexture {
  return canvasTexture(380, 200, (c) => {
    for (let i = 0; i < 13; i++) {
      c.fillStyle = i % 2 ? "#ffffff" : "#b22234";
      c.fillRect(0, (i * 200) / 13, 380, 200 / 13 + 1);
    }
    c.fillStyle = "#3c3b6e";
    c.fillRect(0, 0, 152, (7 * 200) / 13);
    c.fillStyle = "#ffffff";
    for (let r = 0; r < 9; r++)
      for (let k = 0; k < (r % 2 ? 5 : 6); k++) {
        c.beginPath();
        c.arc(12 + k * 25.5 + (r % 2 ? 12.7 : 0), 9 + r * 11.7, 3.2, 0, Math.PI * 2);
        c.fill();
      }
  });
}

function star(c: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number): void {
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = rot + (i * Math.PI) / 5 - Math.PI / 2;
    const rr = i % 2 ? r * 0.38 : r;
    c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  c.closePath();
  c.fill();
}

export function chinaFlag(): CanvasTexture {
  return canvasTexture(300, 200, (c) => {
    c.fillStyle = "#de2910";
    c.fillRect(0, 0, 300, 200);
    c.fillStyle = "#ffde00";
    star(c, 50, 50, 30, 0);
    for (const [x, y] of [
      [100, 20],
      [120, 40],
      [120, 70],
      [100, 90],
    ] as const)
      star(c, x, y, 10, Math.atan2(50 - y, 50 - x) + Math.PI / 2);
  });
}
