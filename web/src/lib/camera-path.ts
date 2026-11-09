/**
 * Camera moves for video (spec MED-08): a smooth glide through camera positions, such as a fly-in
 * from the whole garment to the print, or a tour of saved views. A Catmull-Rom curve passes through
 * every key without stopping, and the whole move eases in and out. Pure, so it is tested in Node.
 */

export type Vec3 = [number, number, number];

export interface CameraKey {
  position: Vec3;
  target: Vec3;
  fovDeg: number;
}

/** Smootherstep: starts and stops with no jolt. */
export const easeInOut = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

function catmullRom(a: number, b: number, c: number, d: number, u: number) {
  const u2 = u * u;
  const u3 = u2 * u;
  return 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3);
}

/** The camera `t` (0 to 1) of the way along a move through `keys`. */
export function pathPose(keys: readonly CameraKey[], t: number): CameraKey {
  if (!keys.length) throw new Error('A camera move needs at least one position.');
  if (keys.length === 1) return keys[0];
  const e = easeInOut(Math.min(1, Math.max(0, t)));
  const segments = keys.length - 1;
  const x = e * segments;
  const i = Math.min(segments - 1, Math.floor(x));
  const u = x - i;
  const k = (n: number) => keys[Math.max(0, Math.min(keys.length - 1, n))];
  const curve = (pick: (key: CameraKey) => Vec3): Vec3 => [0, 1, 2].map((axis) => catmullRom(pick(k(i - 1))[axis], pick(k(i))[axis], pick(k(i + 1))[axis], pick(k(i + 2))[axis], u)) as Vec3;
  return { position: curve((key) => key.position), target: curve((key) => key.target), fovDeg: k(i).fovDeg + (k(i + 1).fovDeg - k(i).fovDeg) * u };
}

/**
 * A close-up of a print: the camera `distance` metres out along the cloth's outward normal from the
 * print's centre, looking at it, held a little above so the garment reads as worn rather than flat.
 */
export function closeUp(point: Vec3, normal: Vec3, distance: number, fovDeg: number): CameraKey {
  const len = Math.hypot(normal[0], normal[1], normal[2]) || 1;
  const n: Vec3 = [normal[0] / len, normal[1] / len, normal[2] / len];
  const lift = distance * 0.12;
  return { position: [point[0] + n[0] * distance, point[1] + n[1] * distance + lift, point[2] + n[2] * distance], target: point, fovDeg };
}

/** How far a camera with this field of view stands to fit `sizeM` metres, with a margin round it. */
export function distanceToFit(sizeM: number, fovDeg: number, margin = 1.35) {
  return Math.max(0.25, ((sizeM / 2) * margin) / Math.tan((fovDeg * Math.PI) / 360));
}
