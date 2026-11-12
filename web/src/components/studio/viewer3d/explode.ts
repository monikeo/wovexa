/**
 * Taking a garment apart, for any 3D shape. The built-in garments give each of their pieces its
 * own way out (garment-geometry.ts: the front body forward, the back body back). A fitted shell or
 * a template shape gets one here instead, each piece moving as one: the body stays, each sleeve
 * slides out to its side, legs drop away, and trims move away from the middle of the body (a hood
 * up, a belt forward). The shader then moves every vertex by `aExplode` times `uExplode` (motion.ts).
 */
import * as THREE from 'three';
import type { GarmentGeometry } from './garment-geometry';

/** How long taking apart or putting back together takes, in milliseconds. */
export const APART_MS = 900;

/** Ease in and out, so pieces lift off gently and settle softly. */
export function easeApart(t: number) {
  const k = Math.min(1, Math.max(0, t));
  return k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
}

function centreOf(g: THREE.BufferGeometry) {
  if (!g.boundingBox) g.computeBoundingBox();
  return g.boundingBox!.getCenter(new THREE.Vector3());
}

function fill(g: THREE.BufferGeometry, x: number, y: number, z: number) {
  if (g.getAttribute('aExplode')) return;
  const n = g.getAttribute('position').count;
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    out[i * 3] = x;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = z;
  }
  g.setAttribute('aExplode', new THREE.BufferAttribute(out, 3));
}

/** Give every piece without its own way out one (in place); pieces that have one keep it. */
export function ensureApart(geo: GarmentGeometry) {
  const all = [...geo.parts.map((p) => p.geometry), ...geo.trims.map((t) => t.geometry)];
  if (all.every((g) => g.getAttribute('aExplode'))) return;
  const torso = geo.parts.find((p) => p.id === 'torso')?.geometry;
  const box = new THREE.Box3();
  for (const g of torso ? [torso] : all) {
    if (!g.boundingBox) g.computeBoundingBox();
    if (g.boundingBox) box.union(g.boundingBox);
  }
  if (box.isEmpty()) return;
  const middle = box.getCenter(new THREE.Vector3());
  // A fifth of the body's height: as far as the built-in garments move theirs.
  const away = Math.max(60, (box.max.y - box.min.y) * 0.2);
  for (const p of geo.parts) {
    const side = Math.sign(centreOf(p.geometry).x - middle.x) || 1;
    if (p.id === 'torso') fill(p.geometry, 0, 0, 0);
    else if (p.id === 'sleeveLeft' || p.id === 'sleeveRight') fill(p.geometry, side * away, 0, 0);
    else fill(p.geometry, side * away * 0.4, -away * 0.8, 0);
  }
  for (const t of geo.trims) {
    const out = centreOf(t.geometry).sub(middle);
    if (out.lengthSq() < 1) out.set(0, 1, 0);
    out.normalize().multiplyScalar(away * 0.8);
    fill(t.geometry, out.x, out.y, out.z);
  }
}

/** Whether taking this garment apart moves anything at all (a one-piece shape has nothing to separate). */
export function canTakeApart(geo: GarmentGeometry) {
  for (const g of [...geo.parts.map((p) => p.geometry), ...geo.trims.map((t) => t.geometry)]) {
    const a = g.getAttribute('aExplode');
    if (!a) continue;
    for (let i = 0; i < a.count; i += 97) if (a.getX(i) || a.getY(i) || a.getZ(i)) return true;
  }
  return false;
}
