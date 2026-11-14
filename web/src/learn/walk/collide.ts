export interface Obstacle {
  x: number;
  z: number;
  r: number;
}

export function pushOut(x: number, z: number, r: number, obs: Obstacle[]): [number, number] {
  let px = x;
  let pz = z;
  for (const o of obs) {
    const dx = px - o.x;
    const dz = pz - o.z;
    const min = r + o.r;
    const d2 = dx * dx + dz * dz;
    if (d2 >= min * min) continue;
    const d = Math.sqrt(d2) || 1e-3;
    px = o.x + (dx / d) * min;
    pz = o.z + (dz / d) * min;
  }
  return [px, pz];
}

export function clampRadius(x: number, z: number, max: number): [number, number, boolean] {
  const d = Math.hypot(x, z);
  if (d <= max) return [x, z, false];
  return [(x / d) * max, (z / d) * max, true];
}
