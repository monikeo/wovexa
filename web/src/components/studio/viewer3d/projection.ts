/**
 * Decal projection onto textured meshes, the way 3D texture painters project decals: the engine
 * behind cross-seam artwork. A projector (a point on the surface, the surface normal there, the
 * artwork's up direction, a size in millimetres and a rotation) spans a box in space. On every
 * mesh, the triangles inside that box that face the projector take the artwork: each triangle's
 * affine map between its texture pixels and the artwork plane paints it into that mesh's texture.
 * Back faces are rejected, so nothing prints through to the inside, and surfaces hidden behind
 * nearer ones (a sleeve cap tucked into an armhole, pants under a jacket) are skipped using a
 * depth map seen from the projector. Pieces that meet at a seam share their edge in space, so
 * both map it to the same artwork pixel: a print runs on over a shoulder or round a side seam.
 *
 * General by design: the input is any indexed mesh (positions and optional normals in
 * millimetres, UVs, index), the output paints a texture of any size, with either UV convention
 * (`flipY`). Nothing here knows about garment parts or print zones; adapters do (rest-shape.ts,
 * projected-paint.ts). Pure functions over typed arrays, no DOM and no three.js, so they run in
 * tests and could move to a worker. WOVEXA passes garments in their own frame (+y up, +z toward
 * the front, wearer's left at +x) with the cloth at rest, before drape folds: artwork is printed
 * on the pressed fabric and then folds with it, so the 3D view and the cut panels agree.
 */

export type Vec3 = readonly [number, number, number];

/** Where artwork is projected from: a point on the garment surface, its outward normal and the artwork's up. */
export interface Projector {
  point: Vec3;
  normal: Vec3;
  up: Vec3;
}

/** A projector with the artwork's size, rotation and mirroring. */
export interface DecalPlacement {
  projector: Projector;
  widthMm: number;
  heightMm: number;
  /** Clockwise as seen from the projector, like a layer rotated in a print zone. */
  rotationDeg: number;
  flipX?: boolean;
  flipY?: boolean;
  /** Millimetres the artwork paints outside its box (outlines, shadows). */
  bleedMm?: number;
}

/** One garment part's triangles: rest positions and normals (mm), texture coordinates and the index. */
export interface ProjectionMesh {
  position: ArrayLike<number>;
  /** Smooth vertex normals; with them the artwork fades out evenly where the cloth turns away. */
  normal?: ArrayLike<number>;
  uv: ArrayLike<number>;
  index: ArrayLike<number>;
}

/** Cloth facing the projector squarely or up to this angle takes the artwork at full strength. */
export const FULL_STRENGTH_DEG = 66;
/** Beyond this angle the artwork has faded out: cloth turning edge-on would smear it. */
export const FADED_OUT_DEG = 84;
const FACING_FULL = Math.cos((FULL_STRENGTH_DEG * Math.PI) / 180);
const FACING_NONE = Math.cos((FADED_OUT_DEG * Math.PI) / 180);

// ---------------------------------------------------------------------------
// Vectors
// ---------------------------------------------------------------------------

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);

export function normalize(a: Vec3): Vec3 | null {
  const l = length(a);
  return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : null;
}

/** `up` made perpendicular to `normal`; when it runs along the normal, garment up, then back, then across. */
export function tangentUp(normal: Vec3, up: Vec3): Vec3 {
  for (const candidate of [up, [0, 1, 0], [0, 0, -1], [1, 0, 0]] as Vec3[]) {
    const t = sub(candidate, scale(normal, dot(candidate, normal)));
    // Ignore directions nearly along the normal: their remainder is mostly rounding.
    if (length(t) > 0.05 * Math.max(1e-9, length(candidate))) return normalize(t)!;
  }
  return [0, 1, 0];
}

/** `v` turned by the smallest rotation that takes direction `from` onto direction `to`. */
export function rotateBetween(v: Vec3, from: Vec3, to: Vec3): Vec3 {
  const axis = cross(from, to);
  const s = length(axis);
  const c = dot(from, to);
  if (s < 1e-9) {
    if (c > 0) return v;
    // Turned right round: half a turn about the axis across `from` nearest `v`, which keeps `v`'s own direction.
    const k = tangentUp(from, v);
    return sub(scale(k, 2 * dot(v, k)), v);
  }
  const k = scale(axis, 1 / s);
  // Rodrigues: v·cosθ + (k × v)·sinθ + k·(k·v)(1 − cosθ).
  return add(add(scale(v, c), scale(cross(k, v), s)), scale(k, dot(k, v) * (1 - c)));
}

/** Clockwise angle in degrees, seen from outside (against `normal`), that turns direction `from` into `to`. */
export function angleAbout(from: Vec3, to: Vec3, normal: Vec3): number {
  const u0 = tangentUp(normal, from);
  const r0 = cross(u0, normal);
  return (Math.atan2(dot(to, r0), dot(to, u0)) * 180) / Math.PI;
}

// ---------------------------------------------------------------------------
// The artwork's frame
// ---------------------------------------------------------------------------

export interface DecalFrame {
  origin: Vec3;
  /** The artwork's right and up edges (rotation applied) and the outward normal: a right-handed frame. */
  right: Vec3;
  up: Vec3;
  normal: Vec3;
  widthMm: number;
  heightMm: number;
  bleedMm: number;
  flipX: boolean;
  flipY: boolean;
  /** How far the box reaches behind the centre (round the body) and in front of it, mm. */
  depthBehind: number;
  depthFront: number;
}

/**
 * The artwork box in garment space. It reaches far enough behind its centre to wrap round the
 * body until the cloth turns away, and less far in front, so cloth hanging over it from further
 * out (a sleeve over the side seam) is neither printed nor allowed to hide it.
 */
export function decalFrame(p: DecalPlacement, origin: Vec3 = p.projector.point): DecalFrame {
  const normal = normalize(p.projector.normal) ?? [0, 0, 1];
  const up0 = tangentUp(normal, p.projector.up);
  const right0 = cross(up0, normal);
  const t = (p.rotationDeg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const bleedMm = Math.max(0, p.bleedMm ?? 0);
  const reach = Math.max(p.widthMm, p.heightMm) / 2 + bleedMm;
  return {
    origin,
    right: sub(scale(right0, c), scale(up0, s)),
    up: add(scale(up0, c), scale(right0, s)),
    normal,
    widthMm: p.widthMm,
    heightMm: p.heightMm,
    bleedMm,
    flipX: !!p.flipX,
    flipY: !!p.flipY,
    depthBehind: reach + 20,
    depthFront: reach * 0.5 + 15,
  };
}

/** A garment point in artwork space: x and y in mm from the box's top-left (y down), and depth toward the projector. */
export function toDecal(f: DecalFrame, p: Vec3): { x: number; y: number; depth: number } {
  const d = sub(p, f.origin);
  const a = dot(d, f.right);
  const b = dot(d, f.up);
  return { x: f.widthMm / 2 + (f.flipX ? -a : a), y: f.heightMm / 2 - (f.flipY ? -b : b), depth: dot(d, f.normal) };
}

/** Whether a garment point lies in the artwork's box (its printable rectangle, not counting bleed). */
export function insideDecal(f: DecalFrame, p: Vec3): boolean {
  const q = toDecal(f, p);
  return q.x >= 0 && q.x <= f.widthMm && q.y >= 0 && q.y <= f.heightMm && q.depth >= -f.depthBehind && q.depth <= f.depthFront;
}

/** Every vertex in artwork space: x, y (mm from the top-left, y down) and depth, three floats per vertex. */
export function decalCoordinates(mesh: ProjectionMesh, f: DecalFrame): Float32Array {
  const p = mesh.position;
  const n = Math.floor(p.length / 3);
  const out = new Float32Array(n * 3);
  const [ox, oy, oz] = f.origin;
  const [rx, ry, rz] = f.right;
  const [ux, uy, uz] = f.up;
  const [nx, ny, nz] = f.normal;
  const hw = f.widthMm / 2;
  const hh = f.heightMm / 2;
  const sx = f.flipX ? -1 : 1;
  const sy = f.flipY ? -1 : 1;
  for (let i = 0; i < n; i++) {
    const dx = p[i * 3] - ox;
    const dy = p[i * 3 + 1] - oy;
    const dz = p[i * 3 + 2] - oz;
    out[i * 3] = hw + sx * (dx * rx + dy * ry + dz * rz);
    out[i * 3 + 1] = hh - sy * (dx * ux + dy * uy + dz * uz);
    out[i * 3 + 2] = dx * nx + dy * ny + dz * nz;
  }
  return out;
}

/** Whether the artwork box can touch an axis-aligned box (a part's bounds): a quick test before projecting. */
export function reachesBounds(f: DecalFrame, min: Vec3, max: Vec3): boolean {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  let d0 = Infinity;
  let d1 = -Infinity;
  for (let k = 0; k < 8; k++) {
    const q = toDecal(f, [k & 1 ? max[0] : min[0], k & 2 ? max[1] : min[1], k & 4 ? max[2] : min[2]]);
    x0 = Math.min(x0, q.x);
    x1 = Math.max(x1, q.x);
    y0 = Math.min(y0, q.y);
    y1 = Math.max(y1, q.y);
    d0 = Math.min(d0, q.depth);
    d1 = Math.max(d1, q.depth);
  }
  const b = f.bleedMm;
  return x1 >= -b && x0 <= f.widthMm + b && y1 >= -b && y0 <= f.heightMm + b && d1 >= -f.depthBehind && d0 <= f.depthFront;
}

// ---------------------------------------------------------------------------
// Triangle selection
// ---------------------------------------------------------------------------

export interface ProjectedPart {
  /** Triangles (index offset / 3) inside the box that face the projector. */
  triangles: Uint32Array;
  /** How squarely each selected triangle faces the projector (cosine of the angle), aligned with `triangles`. */
  faceFacing: Float32Array;
  /** Artwork x, y (mm) and depth for every vertex of the mesh. */
  decal: Float32Array;
  /** Per vertex, how squarely the cloth there faces the projector (from smooth normals when the mesh has them). */
  facing: Float32Array;
}

/**
 * Select the triangles of one part that take the artwork: inside the box (with its bleed), within
 * its depth, and facing the projector. A triangle whose face points away, or edge-on, is a back
 * face: seen from the projector it is the inside of the garment, and it is never selected.
 */
export function selectTriangles(mesh: ProjectionMesh, f: DecalFrame): ProjectedPart {
  const decal = decalCoordinates(mesh, f);
  const pos = mesh.position;
  const idx = mesh.index;
  const n = Math.floor(pos.length / 3);
  const facing = new Float32Array(n);
  const [nx, ny, nz] = f.normal;
  const nor = mesh.normal;
  const x0 = -f.bleedMm;
  const x1 = f.widthMm + f.bleedMm;
  const y0 = -f.bleedMm;
  const y1 = f.heightMm + f.bleedMm;
  const tris: number[] = [];
  const faces: number[] = [];
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const a = idx[t];
    const b = idx[t + 1];
    const c = idx[t + 2];
    const ax = decal[a * 3];
    const bx = decal[b * 3];
    const cx = decal[c * 3];
    if (Math.max(ax, bx, cx) < x0 || Math.min(ax, bx, cx) > x1) continue;
    const ay = decal[a * 3 + 1];
    const by = decal[b * 3 + 1];
    const cy = decal[c * 3 + 1];
    if (Math.max(ay, by, cy) < y0 || Math.min(ay, by, cy) > y1) continue;
    const ad = decal[a * 3 + 2];
    const bd = decal[b * 3 + 2];
    const cd = decal[c * 3 + 2];
    if (Math.max(ad, bd, cd) < -f.depthBehind || Math.min(ad, bd, cd) > f.depthFront) continue;
    // Face normal from the winding (counter-clockwise outside).
    const e1x = pos[b * 3] - pos[a * 3];
    const e1y = pos[b * 3 + 1] - pos[a * 3 + 1];
    const e1z = pos[b * 3 + 2] - pos[a * 3 + 2];
    const e2x = pos[c * 3] - pos[a * 3];
    const e2y = pos[c * 3 + 1] - pos[a * 3 + 1];
    const e2z = pos[c * 3 + 2] - pos[a * 3 + 2];
    const fx = e1y * e2z - e1z * e2y;
    const fy = e1z * e2x - e1x * e2z;
    const fz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(fx, fy, fz);
    if (len < 1e-12) continue;
    const cos = (fx * nx + fy * ny + fz * nz) / len;
    if (cos <= 0) continue; // a back face: never print through to the inside
    tris.push(t / 3);
    faces.push(cos);
  }
  for (const t of tris) {
    for (let k = 0; k < 3; k++) {
      const v = idx[t * 3 + k];
      if (facing[v]) continue;
      if (nor) {
        const l = Math.hypot(nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]) || 1;
        // Never zero, so a filled entry is recognisable; a vertex turned away keeps a tiny value.
        facing[v] = Math.max(1e-6, (nor[v * 3] * nx + nor[v * 3 + 1] * ny + nor[v * 3 + 2] * nz) / l);
      }
    }
  }
  if (!nor) {
    // Without smooth normals each vertex takes the best facing of its selected triangles.
    tris.forEach((t, i) => {
      for (let k = 0; k < 3; k++) {
        const v = idx[t * 3 + k];
        facing[v] = Math.max(facing[v], faces[i]);
      }
    });
  }
  return { triangles: Uint32Array.from(tris), faceFacing: Float32Array.from(faces), decal, facing };
}

/** Strength of the artwork on cloth facing the projector at this cosine: full, then fading to nothing edge-on. */
export function facingStrength(cos: number): number {
  const t = Math.min(1, Math.max(0, (cos - FACING_NONE) / (FACING_FULL - FACING_NONE)));
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------
// Occlusion: what the projector sees first
// ---------------------------------------------------------------------------

export interface DepthMap {
  /** Artwork millimetres of cell (0, 0)'s top-left corner. */
  x0: number;
  y0: number;
  cellMm: number;
  cols: number;
  rows: number;
  /** Nearest cloth to the projector in each cell (largest depth); −Infinity where there is none. */
  depth: Float32Array;
}

/**
 * Rasterise every selected triangle of every part into a small map seen from the projector,
 * keeping the cloth nearest to it. Cloth well behind that is hidden: inside an armhole, under a
 * jacket's hem, behind a sleeve.
 */
export function buildDepthMap(parts: readonly { mesh: ProjectionMesh; projected: ProjectedPart }[], f: DecalFrame): DepthMap {
  const spanW = f.widthMm + 2 * f.bleedMm;
  const spanH = f.heightMm + 2 * f.bleedMm;
  const cellMm = Math.max(0.6, Math.max(spanW, spanH) / 320);
  const cols = Math.max(1, Math.ceil(spanW / cellMm) + 1);
  const rows = Math.max(1, Math.ceil(spanH / cellMm) + 1);
  const depth = new Float32Array(cols * rows).fill(-Infinity);
  const x0 = -f.bleedMm;
  const y0 = -f.bleedMm;
  for (const { mesh, projected } of parts) {
    const { decal, triangles } = projected;
    const idx = mesh.index;
    for (const t of triangles) {
      const a = idx[t * 3];
      const b = idx[t * 3 + 1];
      const c = idx[t * 3 + 2];
      // Cell space: cell (i, j) is sampled at its centre (i + 0.5, j + 0.5).
      const px0 = (decal[a * 3] - x0) / cellMm;
      const py0 = (decal[a * 3 + 1] - y0) / cellMm;
      const px1 = (decal[b * 3] - x0) / cellMm;
      const py1 = (decal[b * 3 + 1] - y0) / cellMm;
      const px2 = (decal[c * 3] - x0) / cellMm;
      const py2 = (decal[c * 3 + 1] - y0) / cellMm;
      const area = (px1 - px0) * (py2 - py0) - (px2 - px0) * (py1 - py0);
      if (Math.abs(area) < 1e-12) continue;
      const d0 = decal[a * 3 + 2];
      const d1 = decal[b * 3 + 2];
      const d2 = decal[c * 3 + 2];
      const i0 = Math.max(0, Math.floor(Math.min(px0, px1, px2) - 0.5));
      const i1 = Math.min(cols - 1, Math.ceil(Math.max(px0, px1, px2) - 0.5));
      const j0 = Math.max(0, Math.floor(Math.min(py0, py1, py2) - 0.5));
      const j1 = Math.min(rows - 1, Math.ceil(Math.max(py0, py1, py2) - 0.5));
      for (let j = j0; j <= j1; j++) {
        const cy = j + 0.5;
        for (let i = i0; i <= i1; i++) {
          const cx = i + 0.5;
          const w0 = ((px1 - cx) * (py2 - cy) - (px2 - cx) * (py1 - cy)) / area;
          const w1 = ((px2 - cx) * (py0 - cy) - (px0 - cx) * (py2 - cy)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
          const d = w0 * d0 + w1 * d1 + w2 * d2;
          const k = j * cols + i;
          if (d > depth[k]) depth[k] = d;
        }
      }
    }
  }
  return { x0, y0, cellMm, cols, rows, depth };
}

/** Whether cloth at artwork point (x, y) and `depth` lies behind nearer cloth, allowing `toleranceMm`. */
export function isOccluded(map: DepthMap, x: number, y: number, depth: number, toleranceMm: number): boolean {
  const i = Math.floor((x - map.x0) / map.cellMm);
  const j = Math.floor((y - map.y0) / map.cellMm);
  if (i < 0 || j < 0 || i >= map.cols || j >= map.rows) return false;
  return depth < map.depth[j * map.cols + i] - toleranceMm;
}

/** Depth tolerance for a triangle: the map's own sampling error grows with how steeply the cloth slopes away. */
function depthTolerance(map: DepthMap, faceCos: number) {
  const c = Math.max(0.08, faceCos);
  return 1.5 + (Math.sqrt(1 - c * c) / c) * map.cellMm;
}

// ---------------------------------------------------------------------------
// Painting into a part's texture
// ---------------------------------------------------------------------------

/** The artwork as pixels: RGBA, not premultiplied (canvas ImageData), with its bleed. */
export interface DecalImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  pxPerMm: number;
  /** Artwork millimetres at the image's top-left corner, on both axes (minus the bleed). */
  originMm: number;
}

/** A painted rectangle of a part's texture: RGBA, not premultiplied, transparent where nothing prints. */
export interface TexturePatch {
  x: number;
  y: number;
  width: number;
  height: number;
  data: Uint8ClampedArray<ArrayBuffer>;
}

export interface PaintOptions {
  /** Hidden-cloth test from every part's selection; without it all facing cloth in the box is painted. */
  depth?: DepthMap;
  /**
   * Pixels to carry the artwork past a triangle's edge into unpainted texture. Seams are island
   * edges in the texture, and filtering there would otherwise mix in bare fabric.
   */
  padPx?: number;
  /** Let patches reach past the texture's edges (a cut panel's bleed can run off the texture). */
  unbounded?: boolean;
  /**
   * How v maps to texture rows, as three.js `Texture.flipY`: true (the default, a CanvasTexture)
   * puts v = 0 on the bottom row; false (glTF's convention) puts v = 0 on the top row.
   */
  flipY?: boolean;
}

const EXACT = 2;
const PADDED = 1;

/**
 * Paint the artwork into a mesh's texture of any size (`width` × `height` px; u right, v as
 * `flipY` says). Each selected triangle maps its texture pixels to artwork millimetres by the
 * affine map its three corners define, samples the artwork (bilinear), fades it where the surface
 * turns away and skips surfaces hidden behind nearer ones. Returns the painted rectangles, one
 * per separate texture region, to composite over the texture (opacity and blending are the
 * caller's).
 */
export function paintTriangles(mesh: ProjectionMesh, projected: ProjectedPart, art: DecalImage, target: { width: number; height: number }, opts: PaintOptions = {}): TexturePatch[] {
  const { triangles } = projected;
  if (!triangles.length) return [];
  const W = target.width;
  const H = target.height;
  const uv = mesh.uv;
  const idx = mesh.index;
  const pad = Math.max(0, opts.padPx ?? 2);
  const flipY = opts.flipY ?? true;
  const row = (v: number) => (flipY ? 1 - v : v) * H;
  // Pixel bounds of each selected triangle, then clusters of overlapping columns: a print near the
  // texture's wrap (the torso's side seam at u = 0 and 1) paints two small patches, not one wide one.
  const n = triangles.length;
  const bx0 = new Float32Array(n);
  const bx1 = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const t = triangles[k];
    let lo = Infinity;
    let hi = -Infinity;
    for (let m = 0; m < 3; m++) {
      const x = uv[idx[t * 3 + m] * 2] * W;
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
    }
    bx0[k] = lo - pad;
    bx1[k] = hi + pad;
  }
  const order = Array.from({ length: n }, (_, k) => k).sort((a, b) => bx0[a] - bx0[b]);
  const clusters: number[][] = [];
  let current: number[] = [];
  let reach = -Infinity;
  for (const k of order) {
    if (current.length && bx0[k] > reach + 2) {
      clusters.push(current);
      current = [];
      reach = -Infinity;
    }
    current.push(k);
    reach = Math.max(reach, bx1[k]);
  }
  if (current.length) clusters.push(current);

  const patches: TexturePatch[] = [];
  for (const cluster of clusters) {
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const k of cluster) {
      const t = triangles[k];
      for (let m = 0; m < 3; m++) {
        const v = idx[t * 3 + m];
        const x = uv[v * 2] * W;
        const y = row(uv[v * 2 + 1]);
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
    const free = !!opts.unbounded;
    const px0 = free ? Math.floor(x0 - pad) : Math.max(0, Math.floor(x0 - pad));
    const py0 = free ? Math.floor(y0 - pad) : Math.max(0, Math.floor(y0 - pad));
    const px1 = free ? Math.ceil(x1 + pad) : Math.min(W, Math.ceil(x1 + pad));
    const py1 = free ? Math.ceil(y1 + pad) : Math.min(H, Math.ceil(y1 + pad));
    if (px1 <= px0 || py1 <= py0) continue;
    const patch: TexturePatch = { x: px0, y: py0, width: px1 - px0, height: py1 - py0, data: new Uint8ClampedArray((px1 - px0) * (py1 - py0) * 4) };
    const state = new Uint8Array(patch.width * patch.height);
    let painted = false;
    for (const pass of [EXACT, PADDED] as const) {
      if (pass === PADDED && !pad) break;
      for (const k of cluster) painted = rasterise(mesh, projected, k, art, W, row, patch, state, pass, pad, opts.depth) || painted;
    }
    if (painted) patches.push(patch);
  }
  return patches;
}

/** Paint one triangle into a patch. Returns whether any pixel took ink. */
function rasterise(
  mesh: ProjectionMesh,
  projected: ProjectedPart,
  k: number,
  art: DecalImage,
  W: number,
  row: (v: number) => number,
  patch: TexturePatch,
  state: Uint8Array,
  pass: typeof EXACT | typeof PADDED,
  pad: number,
  depthMap: DepthMap | undefined,
): boolean {
  const t = projected.triangles[k];
  const idx = mesh.index;
  const uv = mesh.uv;
  const { decal, facing } = projected;
  const a = idx[t * 3];
  const b = idx[t * 3 + 1];
  const c = idx[t * 3 + 2];
  // Texture pixels of the corners (pixel centres sit at +0.5).
  const tx0 = uv[a * 2] * W;
  const ty0 = row(uv[a * 2 + 1]);
  const tx1 = uv[b * 2] * W;
  const ty1 = row(uv[b * 2 + 1]);
  const tx2 = uv[c * 2] * W;
  const ty2 = row(uv[c * 2 + 1]);
  const area = (tx1 - tx0) * (ty2 - ty0) - (tx2 - tx0) * (ty1 - ty0);
  if (Math.abs(area) < 1e-9) return false;
  // Barycentric weights are affine in the pixel position: w = A + B·x + C·y.
  const A0 = (tx1 * ty2 - tx2 * ty1) / area;
  const B0 = (ty1 - ty2) / area;
  const C0 = (tx2 - tx1) / area;
  const A1 = (tx2 * ty0 - tx0 * ty2) / area;
  const B1 = (ty2 - ty0) / area;
  const C1 = (tx0 - tx2) / area;
  // How far outside each edge a pixel may be, as a weight (the weight's gradient is 1 / altitude).
  const lim0 = pass === PADDED ? pad * Math.hypot(B0, C0) : 1e-6;
  const lim1 = pass === PADDED ? pad * Math.hypot(B1, C1) : 1e-6;
  const lim2 = pass === PADDED ? pad * Math.hypot(B0 + B1, C0 + C1) : 1e-6;
  const X0 = decal[a * 3];
  const Y0 = decal[a * 3 + 1];
  const D0 = decal[a * 3 + 2];
  const X1 = decal[b * 3];
  const Y1 = decal[b * 3 + 1];
  const D1 = decal[b * 3 + 2];
  const X2 = decal[c * 3];
  const Y2 = decal[c * 3 + 1];
  const D2 = decal[c * 3 + 2];
  const F0 = facing[a];
  const F1 = facing[b];
  const F2 = facing[c];
  const tolerance = depthMap ? depthTolerance(depthMap, projected.faceFacing[k]) : 0;
  const reachPx = pass === PADDED ? pad : 0;
  const i0 = Math.max(patch.x, Math.floor(Math.min(tx0, tx1, tx2) - reachPx));
  const i1 = Math.min(patch.x + patch.width - 1, Math.ceil(Math.max(tx0, tx1, tx2) + reachPx));
  const j0 = Math.max(patch.y, Math.floor(Math.min(ty0, ty1, ty2) - reachPx));
  const j1 = Math.min(patch.y + patch.height - 1, Math.ceil(Math.max(ty0, ty1, ty2) + reachPx));
  const ppm = art.pxPerMm;
  const src = art.data;
  const AW = art.width;
  const AH = art.height;
  const out = patch.data;
  let painted = false;
  for (let j = j0; j <= j1; j++) {
    const cy = j + 0.5;
    for (let i = i0; i <= i1; i++) {
      const cx = i + 0.5;
      const w0 = A0 + B0 * cx + C0 * cy;
      const w1 = A1 + B1 * cx + C1 * cy;
      const w2 = 1 - w0 - w1;
      if (w0 < -lim0 || w1 < -lim1 || w2 < -lim2) continue;
      const s = (j - patch.y) * patch.width + (i - patch.x);
      if (pass === EXACT) state[s] = EXACT;
      else if (state[s]) continue;
      const depth = w0 * D0 + w1 * D1 + w2 * D2;
      const x = w0 * X0 + w1 * X1 + w2 * X2;
      const y = w0 * Y0 + w1 * Y1 + w2 * Y2;
      if (depthMap && isOccluded(depthMap, x, y, depth, tolerance)) continue;
      const strength = facingStrength(w0 * F0 + w1 * F1 + w2 * F2);
      if (strength <= 0) continue;
      // Bilinear sample of the artwork, premultiplied so transparent edges don't darken.
      const sx = (x - art.originMm) * ppm - 0.5;
      const sy = (y - art.originMm) * ppm - 0.5;
      if (sx <= -1 || sy <= -1 || sx >= AW || sy >= AH) continue;
      const ix = Math.floor(sx);
      const iy = Math.floor(sy);
      const fx = sx - ix;
      const fy = sy - iy;
      let r = 0;
      let g = 0;
      let bl = 0;
      let al = 0;
      for (let q = 0; q < 4; q++) {
        const px = ix + (q & 1);
        const py = iy + (q >> 1);
        if (px < 0 || py < 0 || px >= AW || py >= AH) continue;
        const wq = (q & 1 ? fx : 1 - fx) * (q >> 1 ? fy : 1 - fy);
        const o = (py * AW + px) * 4;
        const aq = src[o + 3] * wq;
        if (!aq) continue;
        r += src[o] * aq;
        g += src[o + 1] * aq;
        bl += src[o + 2] * aq;
        al += aq;
      }
      const alpha = al * strength;
      if (alpha < 0.5) continue;
      const o = s * 4;
      out[o] = r / al;
      out[o + 1] = g / al;
      out[o + 2] = bl / al;
      out[o + 3] = alpha;
      if (pass === PADDED) state[s] = PADDED;
      painted = true;
    }
  }
  return painted;
}

/**
 * Which pattern piece each triangle belongs to. Pieces share no vertices (a seam is two edges that
 * meet in space), so they are the mesh's connected parts. Pieces are numbered from 0.
 */
export function meshPieces(mesh: ProjectionMesh): Int32Array {
  const idx = mesh.index;
  const parent = new Int32Array(Math.floor(mesh.position.length / 3)).map((_, i) => i);
  const find = (v: number) => {
    while (parent[v] !== v) {
      parent[v] = parent[parent[v]];
      v = parent[v];
    }
    return v;
  };
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const a = find(idx[t]);
    const b = find(idx[t + 1]);
    const c = find(idx[t + 2]);
    parent[b] = a;
    parent[find(c)] = a;
  }
  const number = new Map<number, number>();
  const out = new Int32Array(Math.floor(idx.length / 3));
  for (let t = 0; t < out.length; t++) {
    const root = find(idx[t * 3]);
    if (!number.has(root)) number.set(root, number.size);
    out[t] = number.get(root)!;
  }
  return out;
}

/** The same projection limited to the triangles `keep` accepts, e.g. one pattern piece. */
export function keepTriangles(projected: ProjectedPart, keep: (triangle: number) => boolean): ProjectedPart {
  const tris: number[] = [];
  const faces: number[] = [];
  projected.triangles.forEach((t, k) => {
    if (!keep(t)) return;
    tris.push(t);
    faces.push(projected.faceFacing[k]);
  });
  return { ...projected, triangles: Uint32Array.from(tris), faceFacing: Float32Array.from(faces) };
}

/** Whether texture point (u, v) lies inside a closed outline (even-odd rule). */
export function insideOutline(u: number, v: number, outline: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [ui, vi] = outline[i];
    const [uj, vj] = outline[j];
    if (vi > v !== vj > v && u < ((uj - ui) * (v - vi)) / (vj - vi) + ui) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------------------
// Finding the surface: placing, dragging and converting artwork
// ---------------------------------------------------------------------------

export interface SurfacePoint {
  /** Which mesh of the list, which triangle, and where in it. */
  mesh: number;
  triangle: number;
  bary: [number, number, number];
  point: Vec3;
  /** Outward unit normal, smooth when the mesh has vertex normals. */
  normal: Vec3;
  uv: [number, number];
}

function surfacePoint(meshes: readonly ProjectionMesh[], m: number, t: number, w: [number, number, number]): SurfacePoint {
  const mesh = meshes[m];
  const idx = mesh.index;
  const v = [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]];
  const pos = mesh.position;
  const at = (arr: ArrayLike<number>, stride: number, o: number) => w[0] * arr[v[0] * stride + o] + w[1] * arr[v[1] * stride + o] + w[2] * arr[v[2] * stride + o];
  const point: Vec3 = [at(pos, 3, 0), at(pos, 3, 1), at(pos, 3, 2)];
  const face = faceNormal(mesh, t);
  let normal = face;
  if (mesh.normal) {
    const smooth = normalize([at(mesh.normal, 3, 0), at(mesh.normal, 3, 1), at(mesh.normal, 3, 2)]);
    // Smooth normals can disagree with the face where cloth meets at a fold; trust them only when they agree.
    if (smooth && dot(smooth, face) > 0.2) normal = smooth;
  }
  return { mesh: m, triangle: t, bary: w, point, normal, uv: [at(mesh.uv, 2, 0), at(mesh.uv, 2, 1)] };
}

function faceNormal(mesh: ProjectionMesh, t: number): Vec3 {
  const idx = mesh.index;
  const p = mesh.position;
  const a = idx[t * 3];
  const b = idx[t * 3 + 1];
  const c = idx[t * 3 + 2];
  const e1: Vec3 = [p[b * 3] - p[a * 3], p[b * 3 + 1] - p[a * 3 + 1], p[b * 3 + 2] - p[a * 3 + 2]];
  const e2: Vec3 = [p[c * 3] - p[a * 3], p[c * 3 + 1] - p[a * 3 + 1], p[c * 3 + 2] - p[a * 3 + 2]];
  return normalize(cross(e1, e2)) ?? [0, 0, 1];
}

/** The garment point a triangle's barycentric coordinates name, e.g. a pointer hit on the draped mesh mapped back to rest. */
export function pointOnTriangle(meshes: readonly ProjectionMesh[], mesh: number, triangle: number, bary: [number, number, number]): SurfacePoint {
  return surfacePoint(meshes, mesh, triangle, bary);
}

/**
 * Where the line through `origin` along `dir` meets cloth that faces along `dir`, nearest `origin`
 * on either side and within `maxDistance`. Used to keep a projector on the surface when it is
 * dragged or when the garment's size changes under it.
 */
export function surfaceAlong(meshes: readonly ProjectionMesh[], origin: Vec3, dir: Vec3, maxDistance = 250): SurfacePoint | null {
  const d = normalize(dir);
  if (!d) return null;
  let best: { m: number; t: number; w: [number, number, number]; dist: number } | null = null;
  for (let m = 0; m < meshes.length; m++) {
    const p = meshes[m].position;
    const idx = meshes[m].index;
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
      // The face must look back along the line (toward the projector).
      const fx = e1y * e2z - e1z * e2y;
      const fy = e1z * e2x - e1x * e2z;
      const fz = e1x * e2y - e1y * e2x;
      if (fx * d[0] + fy * d[1] + fz * d[2] <= 0) continue;
      // Möller–Trumbore, for the whole line rather than a ray.
      const hx = d[1] * e2z - d[2] * e2y;
      const hy = d[2] * e2x - d[0] * e2z;
      const hz = d[0] * e2y - d[1] * e2x;
      const det = e1x * hx + e1y * hy + e1z * hz;
      if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det;
      const sx = origin[0] - p[a];
      const sy = origin[1] - p[a + 1];
      const sz = origin[2] - p[a + 2];
      const u = (sx * hx + sy * hy + sz * hz) * inv;
      if (u < -1e-7 || u > 1 + 1e-7) continue;
      const qx = sy * e1z - sz * e1y;
      const qy = sz * e1x - sx * e1z;
      const qz = sx * e1y - sy * e1x;
      const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
      if (v < -1e-7 || u + v > 1 + 1e-7) continue;
      const dist = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (Math.abs(dist) > maxDistance || (best && Math.abs(dist) >= Math.abs(best.dist))) continue;
      best = { m, t: t / 3, w: [1 - u - v, u, v], dist };
    }
  }
  return best ? surfacePoint(meshes, best.m, best.t, best.w) : null;
}

/**
 * The garment point at texture coordinates (u, v) of one part, with the cloth's "texture up"
 * there: the direction a print zone's top edge points, for turning zone artwork into a projection.
 */
export function surfaceAtUv(mesh: ProjectionMesh, u: number, v: number): (SurfacePoint & { textureUp: Vec3 }) | null {
  const uv = mesh.uv;
  const idx = mesh.index;
  let best: { t: number; w: [number, number, number]; worst: number } | null = null;
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const a = idx[t];
    const b = idx[t + 1];
    const c = idx[t + 2];
    const u0 = uv[a * 2];
    const v0 = uv[a * 2 + 1];
    const u1 = uv[b * 2];
    const v1 = uv[b * 2 + 1];
    const u2 = uv[c * 2];
    const v2 = uv[c * 2 + 1];
    // Cheap rejection: well outside the triangle's bounds.
    if (u < Math.min(u0, u1, u2) - 0.02 || u > Math.max(u0, u1, u2) + 0.02 || v < Math.min(v0, v1, v2) - 0.02 || v > Math.max(v0, v1, v2) + 0.02) continue;
    const area = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
    if (Math.abs(area) < 1e-14) continue;
    const w0 = ((u1 - u) * (v2 - v) - (u2 - u) * (v1 - v)) / area;
    const w1 = ((u2 - u) * (v0 - v) - (u0 - u) * (v2 - v)) / area;
    const w2 = 1 - w0 - w1;
    const worst = Math.min(w0, w1, w2);
    if (!best || worst > best.worst) best = { t: t / 3, w: [w0, w1, w2], worst };
    if (worst >= 0) break;
  }
  if (!best || best.worst < -0.5) return null;
  // Clamp a point just outside every triangle (between pattern pieces) onto the nearest one.
  const w = best.w.map((x) => Math.max(0, x));
  const sum = w[0] + w[1] + w[2] || 1;
  const hit = surfacePoint([mesh], 0, best.t, [w[0] / sum, w[1] / sum, w[2] / sum]);
  return { ...hit, textureUp: tangentUp(hit.normal, textureAxes(mesh, best.t).up) };
}

/** A triangle's texture directions in garment space: where u (zone right) and v (zone up) increase. */
export function textureAxes(mesh: ProjectionMesh, t: number): { right: Vec3; up: Vec3 } {
  const idx = mesh.index;
  const p = mesh.position;
  const uv = mesh.uv;
  const a = idx[t * 3];
  const b = idx[t * 3 + 1];
  const c = idx[t * 3 + 2];
  const e1: Vec3 = [p[b * 3] - p[a * 3], p[b * 3 + 1] - p[a * 3 + 1], p[b * 3 + 2] - p[a * 3 + 2]];
  const e2: Vec3 = [p[c * 3] - p[a * 3], p[c * 3 + 1] - p[a * 3 + 1], p[c * 3 + 2] - p[a * 3 + 2]];
  const du1 = uv[b * 2] - uv[a * 2];
  const dv1 = uv[b * 2 + 1] - uv[a * 2 + 1];
  const du2 = uv[c * 2] - uv[a * 2];
  const dv2 = uv[c * 2 + 1] - uv[a * 2 + 1];
  const det = du1 * dv2 - du2 * dv1 || 1e-12;
  const right = normalize(scale(sub(scale(e1, dv2), scale(e2, dv1)), 1 / det)) ?? [1, 0, 0];
  const up = normalize(scale(sub(scale(e2, du1), scale(e1, du2)), 1 / det)) ?? [0, 1, 0];
  return { right, up };
}

/** The projector's own plane before the artwork's rotation: right, up and the outward normal. */
export function planeAxes(projector: Projector): { right: Vec3; up: Vec3; normal: Vec3 } {
  const normal = normalize(projector.normal) ?? [0, 0, 1];
  const up = tangentUp(normal, projector.up);
  return { right: cross(up, normal), up, normal };
}

/** Offset of a garment point from the projector's centre in its unrotated plane: (right, up) in mm. */
export function planeOffset(projector: Projector, point: Vec3): [number, number] {
  const { right, up } = planeAxes(projector);
  const d = sub(point, projector.point);
  return [dot(d, right), dot(d, up)];
}

/**
 * Slide a projector across the cloth by (right, up) millimetres in its own plane, landing on the
 * surface there with its up turned to match. Null when there is no cloth at that spot.
 */
export function slideProjector(meshes: readonly ProjectionMesh[], projector: Projector, rightMm: number, upMm: number): Projector | null {
  const { right, up, normal } = planeAxes(projector);
  const target = add(projector.point, add(scale(right, rightMm), scale(up, upMm)));
  const s = surfaceAlong(meshes, target, normal, Math.max(60, Math.hypot(rightMm, upMm) * 3));
  if (!s) return null;
  return { point: s.point, normal: s.normal, up: tangentUp(s.normal, rotateBetween(up, normal, s.normal)) };
}

/**
 * Drag a projector across the garment: the point grabbed `grab` mm from the centre (in its plane)
 * follows the pointer's surface point `hit`. The centre lands on the cloth that grab offset away,
 * and the artwork's up turns with the surface, so it keeps its orientation over the shoulder.
 */
export function dragProjector(meshes: readonly ProjectionMesh[], prev: Projector, grab: readonly [number, number], hit: { point: Vec3; normal: Vec3 }): Projector {
  const n0 = normalize(prev.normal) ?? [0, 0, 1];
  const nh = normalize(hit.normal) ?? n0;
  const upH = tangentUp(nh, rotateBetween(tangentUp(n0, prev.up), n0, nh));
  if (!grab[0] && !grab[1]) return { point: hit.point, normal: nh, up: upH };
  // Step back from the pointer by the grab offset in the plane there, then drop onto the cloth.
  const rightH = cross(upH, nh);
  const estimate = sub(hit.point, add(scale(rightH, grab[0]), scale(upH, grab[1])));
  const s = surfaceAlong(meshes, estimate, nh, Math.max(120, Math.hypot(grab[0], grab[1]) * 2));
  if (!s) return { point: hit.point, normal: nh, up: upH };
  return { point: s.point, normal: s.normal, up: tangentUp(s.normal, rotateBetween(upH, nh, s.normal)) };
}

/** Each triangle's centroid and area-weighted outward normal, per mesh: the table footprint normals read. */
const faceTables = new WeakMap<ProjectionMesh, { centroid: Float32Array; normal: Float32Array; count: number }>();
function facesOf(mesh: ProjectionMesh) {
  let t = faceTables.get(mesh);
  if (t) return t;
  const idx = mesh.index;
  const p = mesh.position;
  const count = Math.floor(idx.length / 3);
  const centroid = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  for (let f = 0; f < count; f++) {
    const a = idx[f * 3] * 3;
    const b = idx[f * 3 + 1] * 3;
    const c = idx[f * 3 + 2] * 3;
    const e1x = p[b] - p[a];
    const e1y = p[b + 1] - p[a + 1];
    const e1z = p[b + 2] - p[a + 2];
    const e2x = p[c] - p[a];
    const e2y = p[c + 1] - p[a + 1];
    const e2z = p[c + 2] - p[a + 2];
    centroid[f * 3] = (p[a] + p[b] + p[c]) / 3;
    centroid[f * 3 + 1] = (p[a + 1] + p[b + 1] + p[c + 1]) / 3;
    centroid[f * 3 + 2] = (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
    normal[f * 3] = e1y * e2z - e1z * e2y;
    normal[f * 3 + 1] = e1z * e2x - e1x * e2z;
    normal[f * 3 + 2] = e1x * e2y - e1y * e2x;
  }
  t = { centroid, normal, count };
  faceTables.set(mesh, t);
  return t;
}

/**
 * Which way the cloth faces on average over a disc round `point` (area-weighted, nearer counts
 * more): the direction to project a whole print along. A crease or fold under the centre then
 * no longer tips the print; cloth facing away from `normal` (the far side, a fold's back) is left out.
 */
export function footprintNormal(meshes: readonly ProjectionMesh[], point: Vec3, normal: Vec3, radiusMm: number): Vec3 {
  const n0 = normalize(normal) ?? [0, 0, 1];
  const r2 = radiusMm * radiusMm;
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (const mesh of meshes) {
    const { centroid, normal: an, count } = facesOf(mesh);
    for (let f = 0; f < count; f++) {
      const dx = centroid[f * 3] - point[0];
      const dy = centroid[f * 3 + 1] - point[1];
      const dz = centroid[f * 3 + 2] - point[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2) continue;
      const nx = an[f * 3];
      const ny = an[f * 3 + 1];
      const nz = an[f * 3 + 2];
      if (nx * n0[0] + ny * n0[1] + nz * n0[2] <= 0) continue;
      const w = 1 - d2 / r2;
      sx += nx * w;
      sy += ny * w;
      sz += nz * w;
    }
  }
  return normalize([sx, sy, sz]) ?? n0;
}

/** A projector turned to face along the cloth's average over a print `sizeMm` across (see footprintNormal), its up kept. */
export function steadyProjector(meshes: readonly ProjectionMesh[], projector: Projector, sizeMm: number): Projector {
  const normal = footprintNormal(meshes, projector.point, projector.normal, Math.max(10, sizeMm / 2));
  return { point: projector.point, normal, up: tangentUp(normal, projector.up) };
}

/**
 * The projector's centre on the current garment: where its axis meets the cloth nearest the stored
 * point. After a size change or a different drape the surface moves; the artwork stays on it.
 */
export function settle(meshes: readonly ProjectionMesh[], projector: Projector): Vec3 {
  return surfaceAlong(meshes, projector.point, projector.normal, 150)?.point ?? projector.point;
}
