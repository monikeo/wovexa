/**
 * Any garment GLB as a shell over the style's pattern (Basic mode). The file gives the look: its
 * folds, seams, collar, hood and pose. The style gives everything else. WOVEXA stands the file
 * upright, facing front, scales it to the chosen size and lines it up with the pattern. Then
 * every point of the shell takes the texture coordinates of the nearest point on the pressed
 * pattern, so print areas, all-over prints, colours, guides, Place mode, motion and photoreal
 * inks work on it as on the built-in garment, whatever the file's own UVs are (or without any).
 * Cloth that reaches past the pattern (a hood on a tee, a longer hem) is plain fabric in its
 * part's colour.
 *
 * Print files, the tech pack and cut-and-sew still come from the pattern: the shell is how the
 * garment looks, not how it is cut.
 */
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshBVH, type HitPointInfo } from 'three-mesh-bvh';
import { getSize, type GarmentModel, type GarmentSize, type PartId } from '@/domain/garments';
import { creditOf, MAX_SHELL_TRIANGLES, type ModelCredit } from '@/domain/model-library';
import type { DesignDocument } from '@/domain/schema';
import { buildGarment, type GarmentGeometry, type GarmentLayout, type TrimColor, type TrimMesh } from './garment-geometry';
import { keepGlb, loadGltf, looksLikeTemplate, parseGarmentShape, readGlbFile, ShapeError } from './garment-glb';

export { creditOf, MAX_SHELL_TRIANGLES };
/** The waist band where a torso is measured, as fractions of the garment's height above its hem. */
const BAND: readonly [number, number] = [0.1, 0.3];
/**
 * Where two layers of the shell lie over the same patch of pattern (a hood over the back, a
 * collar standing up from the neckline, a hem longer than the pattern's), the nearest layer is
 * the garment's own cloth and any layer this much (mm) further out is past the pattern.
 */
const LAYER_MM = 25;
/** Patches of pattern compared for layers, mm square. */
const CELL_MM = 10;
/** Cloth this far (mm) from the pattern is not on it, whatever lies nearer. */
const FAR_MM = 150;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

// ---------------------------------------------------------------------------
// Reading a file
// ---------------------------------------------------------------------------

/** Who made a model and on what terms, as the file states it. */
export type ShellCredit = ModelCredit;

/** What a mesh's name says it is: a pattern part, or trim the pattern doesn't print on. */
export type ShellHint = 'torso' | 'sleeve' | 'leg' | 'belt' | 'collar';
/** Hints as stored per triangle and vertex; 0 is "the name doesn't say". */
export const HINT_CODE: Record<ShellHint, number> = { torso: 1, sleeve: 2, leg: 3, belt: 4, collar: 5 };

/**
 * Read a mesh's name for what it is (`Sleeve_Left`, `Dobok_Trousers`, `V_Collar_Ribbing`,
 * `Black_Belt`, `Jacket_Back_Torso`). Generic names (`Object_2`) say nothing, and the shell is
 * then matched by shape alone.
 */
export function hintOfName(name: string): ShellHint | null {
  const n = name.toLowerCase().replace(/[_.\-]+/g, ' ');
  if (/belt|\bobi\b/.test(n)) return 'belt';
  if (/sleeve|cuff|\barms?\b/.test(n)) return 'sleeve';
  if (/collar|ribbing|\brib\b|neck ?band|neckline|lapel|placket/.test(n)) return 'collar';
  if (/trouser|pant|\blegs?\b|\bshorts?\b|bottom/.test(n)) return 'leg';
  if (/hood/.test(n)) return null;
  if (/jacket|torso|\bbody\b|\bfront\b|\bback\b|chest|shirt|\btee\b|\btop\b|panel/.test(n)) return 'torso';
  return null;
}

/** A garment GLB read as one welded surface, before fitting. */
export interface ParsedShell {
  /** Positions in the file's units with its node transforms applied (glTF: +y up). */
  position: Float32Array;
  index: Uint32Array;
  /** Per triangle, what its mesh's name says it is (a HINT_CODE, or 0). */
  triangleHint: Uint8Array;
  meshes: number;
  triangles: number;
  credit: ShellCredit | null;
}

function boundsOf(p: ArrayLike<number>) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 2 < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = p[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}

/**
 * Weld vertices that share a position (to `tolerance`), then drop degenerate and repeated
 * triangles: a mesh's inside copy, or the same panel exported twice, collapses onto one surface.
 */
export function weld(position: ArrayLike<number>, index: ArrayLike<number>, tolerance: number, triangleHint?: ArrayLike<number>) {
  const inv = 1 / tolerance;
  const ids = new Map<string, number>();
  const count = Math.floor(position.length / 3);
  const remap = new Int32Array(count);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const x = position[i * 3];
    const y = position[i * 3 + 1];
    const z = position[i * 3 + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      remap[i] = -1;
      continue;
    }
    const key = `${Math.round(x * inv)}_${Math.round(y * inv)}_${Math.round(z * inv)}`;
    let j = ids.get(key);
    if (j === undefined) {
      j = out.length / 3;
      ids.set(key, j);
      out.push(x, y, z);
    }
    remap[i] = j;
  }
  const tris: number[] = [];
  const hints: number[] = [];
  const seen = new Set<string>();
  for (let t = 0; t + 2 < index.length; t += 3) {
    const a = remap[index[t]];
    const b = remap[index[t + 1]];
    const c = remap[index[t + 2]];
    if (a < 0 || b < 0 || c < 0 || a === b || b === c || a === c) continue;
    const lo = Math.min(a, b, c);
    const hi = Math.max(a, b, c);
    const key = `${lo}_${a + b + c - lo - hi}_${hi}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tris.push(a, b, c);
    hints.push(triangleHint?.[t / 3] ?? 0);
  }
  return { position: Float32Array.from(out), index: Uint32Array.from(tris), triangleHint: Uint8Array.from(hints) };
}

/** Every mesh of a loaded GLB, welded into one surface in the file's own frame. */
export function shellFromScene(gltf: Pick<GLTF, 'scene' | 'asset'>): ParsedShell {
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry?.getAttribute('position')) meshes.push(m);
  });
  let vertexCount = 0;
  let indexCount = 0;
  for (const m of meshes) {
    const pos = m.geometry.getAttribute('position');
    const idx = m.geometry.getIndex();
    vertexCount += pos.count;
    indexCount += idx ? idx.count - (idx.count % 3) : pos.count - (pos.count % 3);
  }
  const position = new Float32Array(vertexCount * 3);
  const index = new Uint32Array(indexCount);
  const triangleHint = new Uint8Array(indexCount / 3);
  const v = new THREE.Vector3();
  let vo = 0;
  let io = 0;
  for (const m of meshes) {
    const pos = m.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      position[(vo + i) * 3] = v.x;
      position[(vo + i) * 3 + 1] = v.y;
      position[(vo + i) * 3 + 2] = v.z;
    }
    const idx = m.geometry.getIndex();
    const n = idx ? idx.count - (idx.count % 3) : pos.count - (pos.count % 3);
    for (let k = 0; k < n; k++) index[io + k] = vo + (idx ? idx.getX(k) : k);
    const hint = hintOfName(m.name || m.parent?.name || '');
    if (hint) triangleHint.fill(HINT_CODE[hint], io / 3, (io + n) / 3);
    vo += pos.count;
    io += n;
  }
  if (!io) throw new ShapeError('This file has no triangles to show as a garment.');
  const box = boundsOf(position);
  const diagonal = Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]);
  const welded = weld(position, index, Math.max(1e-9, diagonal * 1e-6), triangleHint);
  if (!welded.index.length) throw new ShapeError('This file has no triangles to show as a garment.');
  return { ...welded, meshes: meshes.length, triangles: welded.index.length / 3, credit: creditOf(gltf.asset) };
}

// ---------------------------------------------------------------------------
// Fitting: upright, facing front, at the chosen size, on the pattern
// ---------------------------------------------------------------------------

/** The torso cut across at one height: its centre, half-width and girth (the distance round it). */
export interface TorsoSlice {
  cx: number;
  cz: number;
  halfW: number;
  girth: number;
}

/**
 * Vertices of sleeves cut across between two heights: pieces of cloth joined by their own
 * triangles that close round on themselves (a tube) and keep off the centre line. A sleeve
 * hanging against the body touches it there but isn't joined to it, while the body's own
 * pieces (side panels, a back cut in halves, a placket) are open strips or cross the centre.
 */
function sleeveRings(p: ArrayLike<number>, index: ArrayLike<number>, y0: number, y1: number, cx: number): Set<number> {
  const n = Math.floor(p.length / 3);
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (i: number) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const inBand = new Uint8Array(n);
  for (let t = 0; t + 2 < index.length; t += 3) {
    const a = index[t];
    const b = index[t + 1];
    const c = index[t + 2];
    const cy = (p[a * 3 + 1] + p[b * 3 + 1] + p[c * 3 + 1]) / 3;
    if (cy < y0 || cy > y1) continue;
    parent[find(a)] = find(b);
    parent[find(b)] = find(c);
    inBand[a] = inBand[b] = inBand[c] = 1;
  }
  const pieces = new Map<number, { count: number; sx: number; sz: number; x0: number; x1: number; bins: number }>();
  for (let i = 0; i < n; i++) {
    if (!inBand[i]) continue;
    const r = find(i);
    const piece = pieces.get(r) ?? { count: 0, sx: 0, sz: 0, x0: Infinity, x1: -Infinity, bins: 0 };
    piece.count++;
    piece.sx += p[i * 3];
    piece.sz += p[i * 3 + 2];
    piece.x0 = Math.min(piece.x0, p[i * 3]);
    piece.x1 = Math.max(piece.x1, p[i * 3]);
    pieces.set(r, piece);
  }
  // Which twelfths of a turn round its own middle each piece covers.
  for (let i = 0; i < n; i++) {
    if (!inBand[i]) continue;
    const piece = pieces.get(find(i))!;
    const a = Math.atan2(p[i * 3 + 2] - piece.sz / piece.count, p[i * 3] - piece.sx / piece.count);
    piece.bins |= 1 << Math.min(11, Math.floor(((a + Math.PI) / (2 * Math.PI)) * 12));
  }
  const rings = new Set<number>();
  for (const [root, piece] of pieces) {
    let covered = 0;
    for (let b = piece.bins; b; b &= b - 1) covered++;
    if (piece.count >= 12 && covered >= 10 && (piece.x0 > cx || piece.x1 < cx)) rings.add(root);
  }
  const out = new Set<number>();
  if (!rings.size) return out;
  for (let i = 0; i < n; i++) if (inBand[i] && rings.has(find(i))) out.add(i);
  return out;
}

/** Perimeter of the convex hull of 2D points (x, z pairs): the girth of a cross-section. */
function hullPerimeter(xz: number[]): number {
  const n = xz.length / 2;
  if (n < 3) return 0;
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => xz[a * 2] - xz[b * 2] || xz[a * 2 + 1] - xz[b * 2 + 1]);
  const cross = (o: number, a: number, b: number) => (xz[a * 2] - xz[o * 2]) * (xz[b * 2 + 1] - xz[o * 2 + 1]) - (xz[a * 2 + 1] - xz[o * 2 + 1]) * (xz[b * 2] - xz[o * 2]);
  const hull: number[] = [];
  for (const pass of [order, [...order].reverse()]) {
    const start = hull.length;
    for (const i of pass) {
      while (hull.length >= start + 2 && cross(hull[hull.length - 2], hull[hull.length - 1], i) <= 0) hull.pop();
      hull.push(i);
    }
    hull.pop();
  }
  let perimeter = 0;
  for (let k = 0; k < hull.length; k++) {
    const a = hull[k];
    const b = hull[(k + 1) % hull.length];
    perimeter += Math.hypot(xz[b * 2] - xz[a * 2], xz[b * 2 + 1] - xz[a * 2 + 1]);
  }
  return perimeter;
}

/**
 * The torso between two heights, seen from above. The cloth there is gathered on a coarse grid,
 * and the cluster that surrounds the centre is the torso: sleeves hanging beside it are clusters
 * of their own, while a placket, a pocket or the inside layer joins it. Girth is the distance
 * round that cluster, which holds whether a file's torso is round (worn) or flat (pressed).
 */
export function torsoSlice(p: ArrayLike<number>, y0: number, y1: number, cellMm: number, cxGuess?: number, index?: ArrayLike<number>): TorsoSlice | null {
  const xz: number[] = [];
  const ids: number[] = [];
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (let i = 0; i + 2 < p.length; i += 3) {
    const y = p[i + 1];
    if (y < y0 || y > y1) continue;
    const x = p[i];
    const z = p[i + 2];
    xz.push(x, z);
    ids.push(i / 3);
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    z0 = Math.min(z0, z);
    z1 = Math.max(z1, z);
  }
  const n = xz.length / 2;
  if (n < 8 || !(cellMm > 0)) return null;
  const cols = Math.min(1024, Math.floor((x1 - x0) / cellMm) + 3);
  const rows = Math.min(1024, Math.floor((z1 - z0) / cellMm) + 3);
  const cell = Math.max((x1 - x0) / (cols - 3) || cellMm, (z1 - z0) / (rows - 3) || cellMm, cellMm);
  const cellOf = (x: number, z: number) => (Math.floor((z - z0) / cell) + 1) * cols + Math.floor((x - x0) / cell) + 1;
  // Occupied cells, grown by one so cloth a cell apart (a seam gap, a placket) joins up.
  const occupied = new Uint8Array(cols * rows);
  for (let i = 0; i < n; i++) occupied[cellOf(xz[i * 2], xz[i * 2 + 1])] = 1;
  const grown = new Uint8Array(cols * rows);
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      if (!occupied[r * cols + c]) continue;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) grown[(r + dr) * cols + c + dc] = 1;
    }
  }
  const label = new Int32Array(cols * rows).fill(-1);
  const boxes: { c0: number; c1: number; r0: number; r1: number; count: number }[] = [];
  const queue: number[] = [];
  for (let start = 0; start < cols * rows; start++) {
    if (!grown[start] || label[start] >= 0) continue;
    const id = boxes.length;
    const box = { c0: Infinity, c1: -Infinity, r0: Infinity, r1: -Infinity, count: 0 };
    boxes.push(box);
    label[start] = id;
    queue.length = 0;
    queue.push(start);
    while (queue.length) {
      const k = queue.pop()!;
      const r = Math.floor(k / cols);
      const c = k % cols;
      box.c0 = Math.min(box.c0, c);
      box.c1 = Math.max(box.c1, c);
      box.r0 = Math.min(box.r0, r);
      box.r1 = Math.max(box.r1, r);
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
          const kk = rr * cols + cc;
          if (grown[kk] && label[kk] < 0) {
            label[kk] = id;
            queue.push(kk);
          }
        }
      }
    }
  }
  for (let i = 0; i < n; i++) boxes[label[cellOf(xz[i * 2], xz[i * 2 + 1])]].count++;
  // The torso surrounds the centre line; of the clusters that do, the one with the most cloth.
  const centreCol = Math.floor(((cxGuess ?? (x0 + x1) / 2) - x0) / cell) + 1;
  let pick = -1;
  for (let id = 0; id < boxes.length; id++) {
    const b = boxes[id];
    if (b.c0 > centreCol || b.c1 < centreCol) continue;
    if (pick < 0 || b.count > boxes[pick].count) pick = id;
  }
  if (pick < 0) pick = boxes.reduce((best, b, id) => (b.count > boxes[best].count ? id : best), 0);
  const cx = cxGuess ?? (x0 + x1) / 2;
  const sleeve = index ? sleeveRings(p, index, y0, y1, cx) : null;
  const torso: number[] = [];
  let tx0 = Infinity;
  let tx1 = -Infinity;
  let tz0 = Infinity;
  let tz1 = -Infinity;
  for (let i = 0; i < n; i++) {
    if (label[cellOf(xz[i * 2], xz[i * 2 + 1])] !== pick || sleeve?.has(ids[i])) continue;
    const x = xz[i * 2];
    const z = xz[i * 2 + 1];
    torso.push(x, z);
    tx0 = Math.min(tx0, x);
    tx1 = Math.max(tx1, x);
    tz0 = Math.min(tz0, z);
    tz1 = Math.max(tz1, z);
  }
  const girth = hullPerimeter(torso);
  return girth > 0 ? { cx: (tx0 + tx1) / 2, cz: (tz0 + tz1) / 2, halfW: (tx1 - tx0) / 2, girth } : null;
}

/** A shell in garment millimetres, lined up with the pattern. */
export interface FittedShell {
  position: Float32Array;
  index: Uint32Array;
  /** Per point, what its mesh's name says it is (a HINT_CODE, or 0). */
  vertexHint: Uint8Array;
  /** Turned round to face front: by WOVEXA's reading of the neckline, or the person's choice. */
  turned: boolean;
  /** File units to millimetres. */
  scale: number;
  /** The pattern's torso half-width in the waist band, mm. */
  halfWidthMm: number;
  /** The shell's own torso half-width there, once fitted (a worn, round torso is narrower than a pressed one). */
  shellHalfWidthMm: number;
  /** The pattern's hem height, mm (the shell's hem sits on it). */
  hemMm: number;
}

/** Wind every triangle outward when most of the body's cloth faces in: some files are inside out. */
function windOutward(p: Float32Array, index: Uint32Array, y0: number, y1: number, cz: number, halfW: number): Uint32Array {
  let score = 0;
  let total = 0;
  for (let t = 0; t + 2 < index.length; t += 3) {
    const a = index[t] * 3;
    const b = index[t + 1] * 3;
    const c = index[t + 2] * 3;
    const cx = (p[a] + p[b] + p[c]) / 3;
    const cy = (p[a + 1] + p[b + 1] + p[c + 1]) / 3;
    const czt = (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
    if (cy < y0 || cy > y1 || Math.abs(cx) > 0.8 * halfW) continue;
    const e1x = p[b] - p[a];
    const e1y = p[b + 1] - p[a + 1];
    const e1z = p[b + 2] - p[a + 2];
    const e2x = p[c] - p[a];
    const e2y = p[c + 1] - p[a + 1];
    const e2z = p[c + 2] - p[a + 2];
    const nx = e1y * e2z - e1z * e2y;
    const nz = e1x * e2y - e1y * e2x;
    const ny = e1z * e2x - e1x * e2z;
    const area = Math.hypot(nx, ny, nz);
    // Outward from the body's vertical axis.
    score += Math.sign(nx * cx + nz * (czt - cz)) * area;
    total += area;
  }
  if (!(total > 0) || score > -0.3 * total) return index;
  const flipped = Uint32Array.from(index);
  for (let t = 0; t + 2 < flipped.length; t += 3) {
    flipped[t + 1] = index[t + 2];
    flipped[t + 2] = index[t + 1];
  }
  return flipped;
}

/**
 * Whether a file shows its back on the +z side. Up the centre line, the front neckline dips
 * (and a hood's face opening is empty) while the back rises to the nape or the hood's crown, so
 * the back has more cloth near the top. The cloth is traced where its triangles cross the centre
 * line (so a dense front and a sparse back mesh weigh the same), and each 8 mm row is split front
 * from back at its own middle, so a thin or leaning model reads as well as a round one.
 */
export function showsBack(p: ArrayLike<number>, index: ArrayLike<number>, halfW: number, top: number, bottom: number): boolean {
  const from = bottom + 0.7 * (top - bottom);
  const rows = new Map<number, [number, number]>();
  for (let i = 0; i + 2 < p.length; i += 3) {
    if (p[i + 1] < from || Math.abs(p[i]) > 0.6 * halfW) continue;
    const row = Math.floor(p[i + 1] / 8);
    const r = rows.get(row);
    if (r) {
      r[0] = Math.min(r[0], p[i + 2]);
      r[1] = Math.max(r[1], p[i + 2]);
    } else rows.set(row, [p[i + 2], p[i + 2]]);
  }
  const front = new Set<number>();
  const back = new Set<number>();
  const ends: [number, number][] = [];
  for (let t = 0; t + 2 < index.length; t += 3) {
    // Where this triangle crosses the centre line x = 0: a segment in (y, z).
    ends.length = 0;
    for (let e = 0; e < 3; e++) {
      const a = index[t + e] * 3;
      const b = index[t + ((e + 1) % 3)] * 3;
      const xa = p[a];
      const xb = p[b];
      if ((xa < 0) === (xb < 0) || xa === xb) continue;
      const k = xa / (xa - xb);
      ends.push([p[a + 1] + k * (p[b + 1] - p[a + 1]), p[a + 2] + k * (p[b + 2] - p[a + 2])]);
    }
    if (ends.length < 2) continue;
    const [[y0, z0], [y1, z1]] = ends;
    if (Math.max(y0, y1) < from) continue;
    for (let row = Math.floor(Math.max(from, Math.min(y0, y1)) / 8); row <= Math.floor(Math.max(y0, y1) / 8); row++) {
      const r = rows.get(row);
      if (!r || r[1] - r[0] < 2) continue;
      const y = Math.min(Math.max((row + 0.5) * 8, Math.min(y0, y1)), Math.max(y0, y1));
      const z = y1 === y0 ? (z0 + z1) / 2 : z0 + ((y - y0) / (y1 - y0)) * (z1 - z0);
      (z > (r[0] + r[1]) / 2 ? front : back).add(row);
    }
  }
  return front.size > back.size + 1;
}

/**
 * Stand a shell up, face it front, scale it to the pattern's chest and sit its hem on the
 * pattern's hem. `turn` turns it round from the way its neckline reads.
 */
export function fitShell(shell: ParsedShell, base: GarmentGeometry, turn = false): FittedShell {
  const p = Float32Array.from(shell.position);
  // Garments are thinnest front to back: a file lying flat (thin in y) or side-on (thin in x) is stood up.
  let box = boundsOf(p);
  const ex = box.max[0] - box.min[0];
  const ey = box.max[1] - box.min[1];
  const ez = box.max[2] - box.min[2];
  let stood = false;
  if (ey < 0.8 * Math.min(ex, ez)) {
    stood = true;
    for (let i = 0; i < p.length; i += 3) {
      const y = p[i + 1];
      p[i + 1] = p[i + 2];
      p[i + 2] = -y;
    }
  } else if (ex < 0.8 * Math.min(ey, ez)) {
    stood = true;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i];
      p[i] = p[i + 2];
      p[i + 2] = -x;
    }
  }
  box = boundsOf(p);
  if (stood) {
    // Which end is up is a guess for a file that wasn't upright. A top carries more cloth up high
    // (sleeves, shoulders, a collar or hood), so the middle of its cloth sits above half height;
    // upside down, turn it over.
    let area = 0;
    let moment = 0;
    const idx = shell.index;
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const a = idx[t] * 3;
      const b = idx[t + 1] * 3;
      const c = idx[t + 2] * 3;
      const e1x = p[b] - p[a];
      const e1y = p[b + 1] - p[a + 1];
      const e1z = p[b + 2] - p[a + 2];
      const e2x = p[c] - p[a];
      const e2y = p[c + 1] - p[a + 1];
      const e2z = p[c + 2] - p[a + 2];
      const s = Math.hypot(e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x);
      area += s;
      moment += (s * (p[a + 1] + p[b + 1] + p[c + 1])) / 3;
    }
    const middle = (box.min[1] + box.max[1]) / 2;
    if (area > 0 && moment / area < middle - 0.01 * (box.max[1] - box.min[1])) {
      for (let i = 0; i < p.length; i += 3) {
        p[i + 1] = -p[i + 1];
        p[i + 2] = -p[i + 2];
      }
      box = boundsOf(p);
    }
  }
  const height = box.max[1] - box.min[1];
  if (!(height > 0)) throw new ShapeError('This model is flat. WOVEXA needs a garment with some height to fit.');

  // What each point's mesh name says it is (0: nothing). Names only tell pieces apart when the
  // file names at least two kinds (a jacket and sleeves, a body and a collar): one mesh called
  // "TShirt" is the whole garment, not its body.
  const vertexHint = new Uint8Array(p.length / 3);
  const kinds = new Set(shell.triangleHint);
  kinds.delete(0);
  if (kinds.size >= 2) {
    for (let t = 0; t < shell.triangleHint.length; t++) {
      const h = shell.triangleHint[t];
      if (h) vertexHint[shell.index[t * 3]] = vertexHint[shell.index[t * 3 + 1]] = vertexHint[shell.index[t * 3 + 2]] = h;
    }
  }
  // The body to measure: the meshes named as the body when the file says which they are, else all of it.
  const named = vertexHint.includes(HINT_CODE.torso);
  const body = named ? pointsWhere(p, (i) => vertexHint[i] === HINT_CODE.torso) : p;
  const bodyBox = boundsOf(body);
  const bodyHeight = bodyBox.max[1] - bodyBox.min[1];

  const torso = base.parts.find((q) => q.id === 'torso')?.geometry;
  if (!torso) throw new ShapeError('This style has no body to fit a 3D model over.');
  const tp = torso.getAttribute('position').array;
  const tb = boundsOf(tp);
  const th = tb.max[1] - tb.min[1];
  const baseBand: [number, number] = [tb.min[1] + BAND[0] * th, tb.min[1] + BAND[1] * th];
  // A uniform's pattern has legs. Without names to say which cloth is the jacket, it is found
  // where the pattern has it within the whole height, and lined up by its waist band.
  const legs = base.parts.some((q) => q.id === 'legLeft' || q.id === 'legRight');
  const byWaist = legs && !named;
  let shellBand: [number, number] = [bodyBox.min[1] + BAND[0] * bodyHeight, bodyBox.min[1] + BAND[1] * bodyHeight];
  if (byWaist) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const q of base.parts) {
      const b = boundsOf(q.geometry.getAttribute('position').array);
      lo = Math.min(lo, b.min[1]);
      hi = Math.max(hi, b.max[1]);
    }
    const span = Math.max(1, hi - lo);
    shellBand = [box.min[1] + ((baseBand[0] - lo) / span) * height, box.min[1] + ((baseBand[1] - lo) / span) * height];
  }
  const band = torsoSlice(body, shellBand[0], shellBand[1], 0.012 * (named ? bodyHeight : height), (box.min[0] + box.max[0]) / 2, named ? undefined : shell.index);
  const target = torsoSlice(tp, baseBand[0], baseBand[1], 0.012 * th, 0);
  if (!band || !target) throw new ShapeError('WOVEXA couldn’t find a body in this model. Use a garment standing upright with its front or back to the camera.');

  // Same girth as the pattern: a worn (round) or pressed (flat) torso both come out the chosen size.
  const scale = target.girth / band.girth;
  // A named body also gives its length, so a model cut slimmer or longer than the size chart is
  // brought to the chart both ways (within a third, so it keeps its character).
  const scaleY = named ? Math.min(1.33 * scale, Math.max(0.75 * scale, th / Math.max(1e-9, bodyHeight))) : scale;
  // Tops sit their hem (the lowest body cloth near the centre line, not a hanging sleeve) on the
  // pattern's hem; an unnamed uniform lines up its jacket's waist band instead.
  let anchor = (shellBand[0] + shellBand[1]) / 2;
  let baseAnchor = (baseBand[0] + baseBand[1]) / 2;
  if (!byWaist) {
    let hem = Infinity;
    for (let i = 0; i + 2 < body.length; i += 3) if (Math.abs(body[i] - band.cx) < 0.7 * band.halfW && body[i + 1] < hem) hem = body[i + 1];
    anchor = Number.isFinite(hem) ? hem : bodyBox.min[1];
    baseAnchor = tb.min[1];
  }
  const toY = (y: number) => (y - anchor) * scaleY + baseAnchor;
  for (let i = 0; i < p.length; i += 3) {
    p[i] = (p[i] - band.cx) * scale;
    p[i + 1] = toY(p[i + 1]);
    p[i + 2] = (p[i + 2] - band.cz) * scale + target.cz;
  }
  const shellHalfW = band.halfW * scale;
  const fb = boundsOf(p);
  const index = windOutward(p, shell.index, toY(shellBand[0]), toY(shellBand[1]), target.cz, shellHalfW);
  const turned = showsBack(p, index, shellHalfW, fb.max[1], fb.min[1]) !== turn;
  if (turned) {
    for (let i = 0; i < p.length; i += 3) {
      p[i] = -p[i];
      p[i + 2] = 2 * target.cz - p[i + 2];
    }
  }
  return { position: p, index, vertexHint, turned, scale, halfWidthMm: target.halfW, shellHalfWidthMm: shellHalfW, hemMm: tb.min[1] };
}

/** The points (x, y, z) whose index passes `keep`. */
function pointsWhere(p: Float32Array, keep: (i: number) => boolean): Float32Array {
  const out: number[] = [];
  for (let i = 0; i < p.length / 3; i++) if (keep(i)) out.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
  return Float32Array.from(out);
}

/**
 * Where a sleeve points in the front view, as an angle in radians: from the shoulder pivot to the
 * middle of the cloth farthest from it, the cuff. Shoulder and underarm cloth near the pivot
 * don't sway it.
 */
function reachAngle(xy: number[], px: number, py: number): number | null {
  const n = xy.length / 2;
  if (n < 12) return null;
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = Math.hypot(xy[i * 2] - px, xy[i * 2 + 1] - py);
  const cut = Float32Array.from(d).sort()[Math.floor(n * 0.85)];
  let sx = 0;
  let sy = 0;
  let k = 0;
  for (let i = 0; i < n; i++) {
    if (d[i] < cut) continue;
    sx += xy[i * 2];
    sy += xy[i * 2 + 1];
    k++;
  }
  return k ? Math.atan2(sy / k - py, sx / k - px) : null;
}

/**
 * The pattern's sleeves turned at the shoulder to hang like the shell's (straight out, angled or
 * down), so each point of a shell's sleeve finds its own sleeve on the pattern, not the body.
 */
export function poseSleeves(base: GarmentGeometry, fitted: FittedShell): Map<PartId, Float32Array> {
  const out = new Map<PartId, Float32Array>();
  const fb = boundsOf(fitted.position);
  const above = fitted.hemMm + 0.12 * (fb.max[1] - fb.min[1]);
  const sides = [
    ['sleeveLeft', 1, 1],
    ['sleeveRight', 2, -1],
  ] as const;
  for (const [id, limb, side] of sides) {
    const part = base.parts.find((q) => q.id === id);
    const pivot = base.limbPivots[limb];
    if (!part || !pivot) continue;
    // A sleeve is the cloth out beyond its own garment's torso; the pattern's sleeve is the whole part.
    const outside = (src: ArrayLike<number>, minY: number, reach: number) => {
      const xy: number[] = [];
      for (let i = 0; i + 2 < src.length; i += 3) {
        const x = src[i] * side;
        if (x > reach && src[i + 1] > minY) xy.push(x, src[i + 1]);
      }
      return xy;
    };
    const src = part.geometry.getAttribute('position').array;
    const px = pivot[0] * side;
    const py = pivot[1];
    // A file that names its sleeves says exactly which cloth they are.
    const named: number[] = [];
    if (fitted.vertexHint.includes(HINT_CODE.sleeve)) {
      const p = fitted.position;
      for (let i = 0; i < fitted.vertexHint.length; i++) if (fitted.vertexHint[i] === HINT_CODE.sleeve && p[i * 3] * side > 0) named.push(p[i * 3] * side, p[i * 3 + 1]);
    }
    const shellAngle = reachAngle(named.length >= 24 ? named : outside(fitted.position, above, 1.1 * fitted.shellHalfWidthMm), px, py);
    const ownAngle = reachAngle(outside(src, -Infinity, -Infinity), px, py);
    if (shellAngle === null || ownAngle === null) continue;
    const by = Math.max(-1.2, Math.min(1.2, shellAngle - ownAngle));
    if (Math.abs(by) < 0.04) continue;
    const c = Math.cos(by);
    const s = Math.sin(by);
    const posed = Float32Array.from(src);
    for (let i = 0; i < posed.length; i += 3) {
      const x = posed[i] * side - px;
      const y = posed[i + 1] - py;
      posed[i] = (px + c * x - s * y) * side;
      posed[i + 1] = py + s * x + c * y;
    }
    out.set(id, posed);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Transfer: the pattern's texture coordinates onto the shell
// ---------------------------------------------------------------------------

const LIMB: Partial<Record<PartId, 1 | 2 | 3 | 4>> = { sleeveLeft: 1, sleeveRight: 2, legLeft: 3, legRight: 4 };
const ROLE: Record<PartId, TrimColor> = { torso: 'body', sleeveLeft: 'sleeves', sleeveRight: 'sleeves', legLeft: 'pants', legRight: 'pants' };

/** A part's texture in fabric millimetres: around its tube (u) by its length (v). */
function partMm(l: GarmentLayout, id: PartId): [number, number] {
  if (id === 'torso') return [l.torsoCircumferenceMm, l.torsoHeightMm];
  if (id === 'sleeveLeft' || id === 'sleeveRight') return [l.sleeveCircumferenceMm, l.sleeveLengthMm];
  return [l.legCircumferenceMm, l.legLengthMm];
}

interface Target {
  id: PartId;
  bvh: MeshBVH;
  position: ArrayLike<number>;
  index: ArrayLike<number>;
  uv: ArrayLike<number>;
}

interface Builder {
  keys: Map<number, number>;
  position: number[];
  normal: number[];
  uv: number[];
  index: number[];
}

const newBuilder = (): Builder => ({ keys: new Map(), position: [], normal: [], uv: [], index: [] });

const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Give every point of a fitted shell the pattern's texture coordinates at the nearest point of
 * the (posed) pressed pattern, and split it into the pattern's parts. Async: it yields between
 * batches so the page stays responsive on large files.
 */
export async function transferShell(fitted: FittedShell, base: GarmentGeometry, posed: Map<PartId, Float32Array> = new Map(), onProgress?: (fraction: number) => void): Promise<GarmentGeometry> {
  const targets: Target[] = [];
  for (const bp of base.parts) {
    const sourceIndex = bp.geometry.getIndex();
    const uv = bp.geometry.getAttribute('uv');
    if (!sourceIndex || !uv) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(posed.get(bp.id) ?? bp.geometry.getAttribute('position').array), 3));
    g.setIndex(new THREE.BufferAttribute(Uint32Array.from(sourceIndex.array), 1));
    // Building the tree reorders the index in place, so read it afterwards.
    const bvh = new MeshBVH(g);
    targets.push({ id: bp.id, bvh, position: g.getAttribute('position').array, index: g.getIndex()!.array, uv: uv.array });
  }
  if (!targets.some((t) => t.id === 'torso')) throw new ShapeError('This style has no body to fit a 3D model over.');

  const p = fitted.position;
  const n = p.length / 3;
  const shellGeometry = new THREE.BufferGeometry();
  shellGeometry.setAttribute('position', new THREE.BufferAttribute(p, 3));
  shellGeometry.setIndex(new THREE.BufferAttribute(fitted.index, 1));
  shellGeometry.computeVertexNormals();
  const normal = shellGeometry.getAttribute('normal').array as Float32Array;

  const A = new THREE.Vector3();
  const B = new THREE.Vector3();
  const C = new THREE.Vector3();
  const bary = new THREE.Vector3();
  const point = new THREE.Vector3();
  const hit: HitPointInfo = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
  const near = new THREE.Vector3();

  const uvAt = (k: number, face: number, at: THREE.Vector3): [number, number] => {
    const t = targets[k];
    const a = t.index[face * 3];
    const b = t.index[face * 3 + 1];
    const c = t.index[face * 3 + 2];
    A.fromArray(t.position, a * 3);
    B.fromArray(t.position, b * 3);
    C.fromArray(t.position, c * 3);
    const w = THREE.Triangle.getBarycoord(at, A, B, C, bary);
    if (!w) return [t.uv[a * 2], t.uv[a * 2 + 1]];
    return [w.x * t.uv[a * 2] + w.y * t.uv[b * 2] + w.z * t.uv[c * 2], w.x * t.uv[a * 2 + 1] + w.y * t.uv[b * 2 + 1] + w.z * t.uv[c * 2 + 1]];
  };

  // Points of a mesh named as a part look only on that part; a named belt or collar is trim in its own colour.
  const all = targets.map((_, k) => k);
  const among = (ids: PartId[]) => {
    const ks = targets.flatMap((t, k) => (ids.includes(t.id) ? [k] : []));
    return ks.length ? ks : all;
  };
  const allowed: number[][] = [];
  allowed[0] = all;
  allowed[HINT_CODE.torso] = among(['torso']);
  allowed[HINT_CODE.sleeve] = among(['sleeveLeft', 'sleeveRight']);
  allowed[HINT_CODE.leg] = among(['legLeft', 'legRight']);
  allowed[HINT_CODE.belt] = all;
  allowed[HINT_CODE.collar] = all;
  const forced: (TrimColor | null)[] = [];
  forced[HINT_CODE.belt] = 'belt';
  forced[HINT_CODE.collar] = 'collar';

  // Nearest pattern point for every shell point.
  const vPart = new Int8Array(n);
  const vU = new Float32Array(n);
  const vV = new Float32Array(n);
  const vDist = new Float32Array(n).fill(Infinity);
  const vNearX = new Float32Array(n);
  let last = 0;
  for (let i = 0; i < n; i++) {
    point.fromArray(p, i * 3);
    let best = -1;
    let bestDistance = Infinity;
    let bestFace = 0;
    const candidates = allowed[fitted.vertexHint[i]] ?? all;
    for (let j = 0; j < candidates.length; j++) {
      // The part the previous point landed on first: neighbours usually share it.
      const k = candidates.includes(last) ? (j === 0 ? last : candidates[j] === last ? candidates[0] : candidates[j]) : candidates[j];
      const r = targets[k].bvh.closestPointToPoint(point, hit, 0, bestDistance);
      if (r && r.distance < bestDistance) {
        best = k;
        bestDistance = r.distance;
        bestFace = r.faceIndex;
        near.copy(r.point);
      }
    }
    if (best >= 0) {
      last = best;
      const [u, v] = uvAt(best, bestFace, near);
      vPart[i] = best;
      vU[i] = u;
      vV[i] = v;
      vDist[i] = bestDistance;
      vNearX[i] = near.x;
    }
    if ((i & 4095) === 4095) {
      onProgress?.((0.9 * i) / n);
      await pause();
    }
  }

  // The nearest layer of cloth over each patch of pattern is the garment's own; layers further out
  // (a hood over the back, cloth past the hem or cuff) are past the pattern and stay plain.
  const grids = targets.map((t) => {
    const [w, h] = partMm(base.layout, t.id);
    const cu = Math.max(1, Math.ceil(w / CELL_MM));
    const cv = Math.max(1, Math.ceil(h / CELL_MM));
    return { cu, cv, min: new Float32Array(cu * cv).fill(Infinity) };
  });
  const cellOf = (i: number) => {
    const g = grids[vPart[i]];
    const cu = Math.min(g.cu - 1, Math.max(0, Math.floor(vU[i] * g.cu)));
    const cv = Math.min(g.cv - 1, Math.max(0, Math.floor(vV[i] * g.cv)));
    return cv * g.cu + cu;
  };
  for (let i = 0; i < n; i++) {
    if (forced[fitted.vertexHint[i]]) continue;
    const g = grids[vPart[i]];
    const c = cellOf(i);
    if (vDist[i] < g.min[c]) g.min[c] = vDist[i];
  }
  const vRole = new Array<TrimColor | null>(n).fill(null);
  for (let i = 0; i < n; i++) {
    const named = forced[fitted.vertexHint[i]];
    if (named) {
      vRole[i] = named;
      continue;
    }
    const d = vDist[i];
    if (d <= FAR_MM && d <= grids[vPart[i]].min[cellOf(i)] + LAYER_MM) continue;
    const id = targets[vPart[i]].id;
    // Standing up from the neckline is the collar; a hood and everything else, the part's own colour.
    vRole[i] = id === 'torso' && vV[i] > 0.85 && Math.abs(vNearX[i]) < 0.45 * fitted.halfWidthMm && d < 45 ? 'collar' : ROLE[id];
  }

  // The same point on another part, for triangles that straddle a seam.
  const requeried = new Map<number, [number, number]>();
  const uvOn = (i: number, k: number): [number, number] => {
    if (vPart[i] === k) return [vU[i], vV[i]];
    const key = i * 8 + k;
    let q = requeried.get(key);
    if (!q) {
      point.fromArray(p, i * 3);
      const r = targets[k].bvh.closestPointToPoint(point, hit);
      q = r ? uvAt(k, r.faceIndex, r.point) : [vU[i], vV[i]];
      requeried.set(key, q);
    }
    return q;
  };

  const builders = targets.map(newBuilder);
  const plain = new Map<TrimColor, Builder>();
  const put = (b: Builder, key: number, i: number, u: number, v: number) => {
    let k = b.keys.get(key);
    if (k === undefined) {
      k = b.position.length / 3;
      b.keys.set(key, k);
      b.position.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
      b.normal.push(normal[i * 3], normal[i * 3 + 1], normal[i * 3 + 2]);
      b.uv.push(u, v);
    }
    b.index.push(k);
  };
  const index = fitted.index;
  const tri = [0, 0, 0];
  const uvs: [number, number][] = [
    [0, 0],
    [0, 0],
    [0, 0],
  ];
  for (let t = 0; t + 2 < index.length; t += 3) {
    tri[0] = index[t];
    tri[1] = index[t + 1];
    tri[2] = index[t + 2];
    const [a, b, c] = tri;
    const pastRole = [vRole[a], vRole[b], vRole[c]].filter((r): r is TrimColor => r !== null);
    if (pastRole.length >= 2) {
      let pb = plain.get(pastRole[0]);
      if (!pb) plain.set(pastRole[0], (pb = newBuilder()));
      for (const i of tri) put(pb, i, i, p[i * 3] / 600, p[i * 3 + 1] / 600);
      continue;
    }
    // The part most of the triangle is on (or, with three different parts, the nearest point's).
    const pa = vPart[a];
    const k = pa === vPart[b] || pa === vPart[c] ? pa : vPart[b] === vPart[c] ? vPart[b] : vPart[vDist[a] <= vDist[b] && vDist[a] <= vDist[c] ? a : vDist[b] <= vDist[c] ? b : c];
    for (let m = 0; m < 3; m++) uvs[m] = uvOn(tri[m], k);
    // Each part's texture wraps round its tube (side seam, underarm, inside leg): a triangle across
    // the wrap takes its low side past 1, and the texture repeats.
    const wrap = Math.max(uvs[0][0], uvs[1][0], uvs[2][0]) - Math.min(uvs[0][0], uvs[1][0], uvs[2][0]) > 0.5;
    const builder = builders[k];
    for (let m = 0; m < 3; m++) {
      const i = tri[m];
      const shift = wrap && uvs[m][0] < 0.5;
      put(builder, i * 4 + (vPart[i] !== k ? 2 : 0) + (shift ? 1 : 0), i, uvs[m][0] + (shift ? 1 : 0), uvs[m][1]);
    }
  }

  const parts: GarmentGeometry['parts'] = [];
  const limbPivots: GarmentGeometry['limbPivots'] = {};
  targets.forEach((target, k) => {
    const b = builders[k];
    if (!b.index.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.position, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(b.normal, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    g.setIndex(b.index);
    const m = b.uv.length / 2;
    const free = new Float32Array(m);
    const limbId = LIMB[target.id];
    const limb = limbId ? new Float32Array(m * 2) : null;
    const pivot = [0, 0, 0];
    let pivotCount = 0;
    for (let i = 0; i < m; i++) {
      const v = b.uv[i * 2 + 1];
      // As for template shapes: torso v is height over body length; sleeves and legs run v from 1 at the seam to 0 at the end.
      free[i] = target.id === 'torso' ? clamp01(1 - v / 0.64) ** 1.4 : clamp01(1 - v) ** 1.5;
      if (!limb || !limbId) continue;
      limb[i * 2] = limbId;
      limb[i * 2 + 1] = clamp01(1 - v) ** 1.1;
      if (v > 0.97) {
        pivot[0] += b.position[i * 3];
        pivot[1] += b.position[i * 3 + 1];
        pivot[2] += b.position[i * 3 + 2];
        pivotCount++;
      }
    }
    g.setAttribute('aFree', new THREE.BufferAttribute(free, 1));
    if (limb && limbId) {
      g.setAttribute('aLimb', new THREE.BufferAttribute(limb, 2));
      if (pivotCount) limbPivots[limbId] = [pivot[0] / pivotCount, pivot[1] / pivotCount, pivot[2] / pivotCount];
      else if (base.limbPivots[limbId]) limbPivots[limbId] = base.limbPivots[limbId];
    }
    // Ambient occlusion is baked into this later.
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(m * 3).fill(1), 3));
    parts.push({ id: target.id, geometry: g });
  });
  if (!parts.some((q) => q.id === 'torso')) throw new ShapeError('WOVEXA couldn’t line this model up with the pattern. Check that it is a garment standing upright.');

  const top = boundsOf(base.parts.find((q) => q.id === 'torso')!.geometry.getAttribute('position').array).max[1];
  const trims: TrimMesh[] = [];
  for (const [role, b] of plain) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.position, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(b.normal, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    g.setIndex(b.index);
    const free = new Float32Array(b.position.length / 3);
    for (let i = 0; i < free.length; i++) free[i] = clamp01(1 - (b.position[i * 3 + 1] - fitted.hemMm) / Math.max(1, (top - fitted.hemMm) * 0.64)) ** 1.4;
    g.setAttribute('aFree', new THREE.BufferAttribute(free, 1));
    // Shaded like the rest of the shell: ambient occlusion is baked into this too.
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(free.length * 3).fill(1), 3));
    trims.push({ key: `shell-${role}`, geometry: g, color: role, surface: role === 'collar' || role === 'belt' ? 'rib' : 'jersey', doubleSided: true });
  }

  for (const t of targets) t.bvh.geometry.dispose();
  shellGeometry.dispose();
  onProgress?.(1);

  // Frame the stage on the shell itself.
  const span = boundsOf(fitted.position);
  return {
    ...base,
    parts,
    trims,
    limbPivots,
    layout: { ...base.layout, heightMm: span.max[1] - span.min[1], widthMm: span.max[0] - span.min[0], bottomMm: span.min[1] },
  };
}

// ---------------------------------------------------------------------------
// From a stored file to live garment geometry
// ---------------------------------------------------------------------------

/** A shell fitted over a style at a size: the live garment geometry. */
export async function fitOver(shell: ParsedShell, model: GarmentModel, size: GarmentSize, turn = false, onProgress?: (fraction: number) => void): Promise<GarmentGeometry> {
  // The pressed pattern: the shell brings its own folds.
  const base = buildGarment(model, size, 'high', 0);
  try {
    const fitted = fitShell(shell, base, turn);
    return await transferShell(fitted, base, poseSleeves(base, fitted), onProgress);
  } finally {
    for (const t of base.trims) t.geometry.dispose();
  }
}

const parsedShells = new Map<string, Promise<ParsedShell>>();
const fittedShells = new Map<string, Promise<GarmentGeometry>>();

/** Read a stored shell once per asset. */
export function cachedShell(assetId: string, read: () => Promise<ArrayBuffer>): Promise<ParsedShell> {
  let pending = parsedShells.get(assetId);
  if (!pending) {
    pending = read().then(async (data) => shellFromScene(await loadGltf(data)));
    pending.catch(() => parsedShells.delete(assetId));
    parsedShells.set(assetId, pending);
  }
  return pending;
}

/** A stored shell fitted over a style at a size; the last few fits are kept, so switching back is instant. */
export function shellGarment(assetId: string, read: () => Promise<ArrayBuffer>, model: GarmentModel, size: GarmentSize, turn: boolean): Promise<GarmentGeometry> {
  const key = `${assetId}:${model.id}:${size.code}:${turn ? 1 : 0}`;
  let pending = fittedShells.get(key);
  if (!pending) {
    pending = cachedShell(assetId, read).then((shell) => fitOver(shell, model, size, turn));
    pending.catch(() => fittedShells.delete(key));
    fittedShells.set(key, pending);
    while (fittedShells.size > 4) fittedShells.delete(fittedShells.keys().next().value!);
  }
  return pending;
}

export type GarmentShapeRecord = NonNullable<DesignDocument['garment']['shape']>;

/**
 * Bring in a garment GLB the person chose. A file made from a WOVEXA template keeps its exact
 * print layout; any other garment becomes a shell fitted over this style. Throws ShapeError with
 * what to fix.
 */
export async function importGarmentModel(file: File, model: GarmentModel, sizeCode: string): Promise<GarmentShapeRecord> {
  const data = await readGlbFile(file);
  const gltf = await loadGltf(data);
  const name = file.name.replace(/\.glb$/i, '').slice(0, 120) || '3D model';
  if (looksLikeTemplate(gltf.scene)) {
    const shape = await parseGarmentShape(data, model);
    const assetId = await keepGlb(file.name, data);
    const madeAt = shape.info.sizeCode && model.sizes.some((s) => s.code === shape.info.sizeCode) ? shape.info.sizeCode : sizeCode;
    return { kind: 'template', assetId, name, modelId: model.id, sizeCode: madeAt };
  }
  const shell = shellFromScene(gltf);
  if (shell.triangles > MAX_SHELL_TRIANGLES) {
    throw new ShapeError(`${file.name} has ${shell.triangles.toLocaleString('en')} triangles; the limit is ${MAX_SHELL_TRIANGLES.toLocaleString('en')}. Reduce it in Blender (Decimate) or with gltf-transform simplify, then load it again.`);
  }
  // Fit it once now, so a file that can't stand in for a garment is refused here, with the reason.
  const check = buildGarment(model, getSize(model, sizeCode), 'low', 0);
  fitShell(shell, check);
  const assetId = await keepGlb(file.name, data);
  parsedShells.set(assetId, Promise.resolve(shell));
  return { kind: 'shell', assetId, name, modelId: model.id, sizeCode, ...(shell.credit ? { credit: shell.credit } : {}) };
}
