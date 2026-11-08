/**
 * Procedural garments (placeholders for calibrated GLBs, spec §28), built in millimetres from
 * the catalogue's pattern measurements: tees, long sleeves, oversized, polo, tank, hoodie,
 * jersey and the Taekwondo dobok with pants and belt.
 *
 * Texture coordinates follow true fabric arc length, measured from each panel's centre line
 * (front and back centre, the top of each sleeve, the outside of each leg), so one texture
 * millimetre is one fabric millimetre wherever a print sits, even where the body narrows.
 *
 * Frame: +y up, +z toward the viewer (garment front), wearer's left at +x. Torso hem at y = 0.
 */
import * as THREE from 'three';
import type { FabricSurface, GarmentModel, GarmentSize, PartId } from '@/domain/garments';

/** Arc-length table for an ellipse x = a·cosθ, z = −b·sinθ, so equal steps are equal distances. */
function arcTable(a: number, b: number, samples = 1024) {
  const lengths = new Float64Array(samples + 1);
  let total = 0;
  let px = a;
  let pz = 0;
  for (let i = 1; i <= samples; i++) {
    const t = (i / samples) * Math.PI * 2;
    const x = a * Math.cos(t);
    const z = -b * Math.sin(t);
    total += Math.hypot(x - px, z - pz);
    lengths[i] = total;
    px = x;
    pz = z;
  }
  const thetaAt = (u: number) => {
    const target = u * total;
    let lo = 0;
    let hi = samples;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (lengths[mid] < target) lo = mid;
      else hi = mid;
    }
    const span = lengths[hi] - lengths[lo] || 1;
    return ((lo + (target - lengths[lo]) / span) / samples) * Math.PI * 2;
  };
  return { total, thetaAt };
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export interface GarmentLayout {
  /** Torso texture: fabric width (u) × body length (v), in mm. Front centre at u = 0.75, back at 0.25. */
  torsoCircumferenceMm: number;
  torsoHeightMm: number;
  frontCenterU: number;
  backCenterU: number;
  /** Sleeve texture, centred on the top line of the sleeve. */
  sleeveCircumferenceMm: number;
  sleeveLengthMm: number;
  /** Distance from the tube root to the shoulder seam along the sleeve. */
  sleeveSeamOffsetMm: number;
  /** Leg texture, centred on the outside of the leg; v runs down from the waistband. */
  legCircumferenceMm: number;
  legLengthMm: number;
  /** Assembly extent for framing, in mm, with the torso hem at y = 0. */
  heightMm: number;
  /** Widest front-view span, sleeves included. */
  widthMm: number;
  bottomMm: number;
}

/** A point on the torso's top edge in texture space, classified so trims can follow it. */
export interface EdgePoint {
  u: number;
  v: number;
  kind: 'neck' | 'armhole' | 'shoulder';
}

export type TrimColor = 'body' | 'sleeves' | 'collar' | 'pants' | 'belt' | 'button';

export interface TrimMesh {
  key: string;
  geometry: THREE.BufferGeometry;
  color: TrimColor;
  surface: FabricSurface | 'plastic';
  /** Textured with this part's map (a pocket shows the torso print through it). */
  mapPart?: PartId;
  doubleSided?: boolean;
}

/** One pattern piece as an outline in its part's texture space, for cut-and-sew printing. */
export interface GarmentIsland {
  id: string;
  label: string;
  part: PartId;
  uv: [number, number][];
}

/** The outline of a grid's texture coordinates: bottom row, right side, top row, left side. */
function gridOutline(uv: ArrayLike<number>, cols: number, rows: number): [number, number][] {
  const at = (i: number, j: number): [number, number] => {
    const o = (j * cols + i) * 2;
    return [uv[o], uv[o + 1]];
  };
  const out: [number, number][] = [];
  for (let i = 0; i < cols; i++) out.push(at(i, 0));
  for (let j = 1; j < rows; j++) out.push(at(cols - 1, j));
  for (let i = cols - 2; i >= 0; i--) out.push(at(i, rows - 1));
  for (let j = rows - 2; j > 0; j--) out.push(at(0, j));
  return out;
}

export interface GarmentGeometry {
  parts: { id: PartId; geometry: THREE.BufferGeometry }[];
  /** Pattern pieces (front, back, sleeves, legs) in texture space: the fabric exactly as printed. */
  islands: GarmentIsland[];
  trims: TrimMesh[];
  layout: GarmentLayout;
  /** Torso top edge, front half then back half, ordered across each panel. */
  torsoEdges: EdgePoint[][];
  /** Kangaroo pocket outline in torso texture space (mm), for its stitching. */
  pocket?: { x0: number; x1: number; y0: number; y1: number };
  /** Where each limb swings from when walking (mm): 1 left sleeve, 2 right sleeve, 3 left leg, 4 right leg. */
  limbPivots: Partial<Record<1 | 2 | 3 | 4, [number, number, number]>>;
}

/** A part's texture in millimetres: fabric width around the part (u) by its length (v). */
export function partSizeMm(geo: Pick<GarmentGeometry, 'layout'>, part: PartId) {
  const l = geo.layout;
  if (part === 'torso') return { w: l.torsoCircumferenceMm, h: l.torsoHeightMm };
  if (part === 'sleeveLeft' || part === 'sleeveRight') return { w: l.sleeveCircumferenceMm, h: l.sleeveLengthMm };
  return { w: l.legCircumferenceMm, h: l.legLengthMm };
}

type Detail = 'low' | 'high';

function gridGeometry(position: Float32Array, uv: Float32Array, nu: number, nv: number, flip: boolean, colors?: Float32Array) {
  const index: number[] = [];
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i;
      const b = a + 1;
      const c = a + (nu + 1);
      const d = c + 1;
      if (flip) index.push(a, c, b, b, c, d);
      else index.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (colors) g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** Arc distance of each column from the centre column of a row, signed. */
function arcFromCentre(xs: Float64Array, ys: Float64Array, zs: Float64Array, centre: number) {
  const n = xs.length;
  const s = new Float64Array(n);
  for (let i = centre + 1; i < n; i++) s[i] = s[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1], zs[i] - zs[i - 1]);
  for (let i = centre - 1; i >= 0; i--) s[i] = s[i + 1] - Math.hypot(xs[i] - xs[i + 1], ys[i] - ys[i + 1], zs[i] - zs[i + 1]);
  return s;
}

/**
 * @param drape How much the cloth falls into folds under its own weight: 0 pressed flat,
 * 1 natural, up to 2 relaxed.
 */
export function buildGarment(model: GarmentModel, size: GarmentSize, detail: Detail = 'high', drape = 1): GarmentGeometry {
  const s = size.scale;
  // Each size follows its size chart: widths by the chest, height by the body length, sleeves
  // and pants by their own measurements. Small details (neck, trims) use the overall scale.
  const sW = size.chestFlatMm / (2 * model.chestHalfWidthMm);
  const H = size.bodyLengthMm;
  const chest = model.chestHalfWidthMm * sW;
  const depth = model.bodyHalfDepthMm * sW;
  const shoulder = model.shoulderHalfWidthMm * sW;
  const neckR = model.neckRadiusMm * s;
  const sleeveless = !model.sleeve;
  const vNeck = model.neckline === 'v' || model.neckline === 'dobok';
  const neckDepth = (model.neckline === 'dobok' ? 84 : 68) * s;
  const roundR = 78 * s;
  const shoulderTop = (ax: number) => H - model.shoulderSlope * (ax - neckR);
  const armpitY = sleeveless ? shoulderTop(shoulder) - (model.armholeDropMm ?? 240) * s : H * 0.64;
  const boxy = model.chestHalfWidthMm >= 290 ? 1.6 : 1;

  // ---- Torso outline functions ----
  const neckCurve = (ax: number, front: boolean) => {
    const t = Math.min(1, ax / neckR);
    const drop = (front ? model.frontNeckDropMm : model.backNeckDropMm) * s;
    if (front && vNeck) return H - drop * (1 - t) ** 1.12;
    if (front && model.neckline === 'scoop') return H - drop * Math.sqrt(Math.max(0, 1 - t * t));
    return H - drop * (1 - t * t);
  };
  const yTop = (x: number, front: boolean) => {
    const ax = Math.abs(x);
    if (ax <= neckR) return neckCurve(ax, front);
    if (!sleeveless || ax <= shoulder) return shoulderTop(ax);
    // Sleeveless: the armhole drops steeply from the strap's end, then sweeps out to the underarm.
    const f = Math.min(1, (ax - shoulder) / Math.max(1, chest * 1.02 - shoulder));
    const top = shoulderTop(shoulder);
    return top - (top - armpitY) * Math.sqrt(f * (2 - f));
  };
  const halfDepth = (y: number) => lerp(depth * 0.95, depth, smoothstep(0, H * 0.5, y));
  const bTop = (x: number, y: number) => {
    const ax = Math.abs(x);
    if (ax < neckR) {
      // The neckline wraps the base of the neck; deep V, dobok and scoop necklines come forward to
      // lie on the chest as they drop below it, so lapels and collar bands sit flat.
      const neck = neckDepth * Math.sqrt(1 - (ax / neckR) ** 2);
      return lerp(neck, halfDepth(y) * 0.96, smoothstep(100 * s, 230 * s, H - y));
    }
    // Armholes stay open; shoulder seams close.
    if (sleeveless) return halfDepth(y) * 0.92 * smoothstep(shoulder, shoulder + 22 * s, ax);
    return 0;
  };
  const ribH = model.hem === 'rib' ? 70 * s : 0;
  const halfWidth = (y: number) => {
    const hem = chest * (ribH ? 0.92 : 0.975);
    let w = lerp(hem, chest, smoothstep(ribH * 0.6, Math.max(ribH + 20 * s, H * 0.45), y));
    if (ribH) w = lerp(hem, w, smoothstep(ribH * 0.75, ribH * 1.15, y));
    // Sleeveless bodies keep their width to the top and the armhole cut shapes the strap; narrowing
    // here too would slide each column's clamped vertices along the cut and fold the mesh.
    if (sleeveless) return w;
    return lerp(w, shoulder, smoothstep(armpitY - 40 * s, H, y));
  };

  // ---- Torso: front and back panels, each centred on its own centre line ----
  const NUh = detail === 'high' ? 112 : 64;
  const NV = detail === 'high' ? 150 : 96;
  const cols = NUh + 1;
  const ellipse = arcTable(chest, depth);
  // Arc-uniform columns: front half θ ∈ [π, 2π], back half θ ∈ [0, π].
  const panelThetas = [true, false].map((front) => Array.from({ length: cols }, (_, i) => ellipse.thetaAt((front ? 0.5 : 0) + (i / NUh) * 0.5)));

  /** Height where a column meets the top edge: neckline, shoulder seam or armhole. */
  const columnTop = (c: number, front: boolean) => {
    const g = (y: number) => y - yTop(halfWidth(y) * c, front);
    const steps = 360;
    let lo = 0;
    for (let n = 1; n <= steps; n++) {
      const y = (n / steps) * H;
      if (g(y) < 0) {
        lo = y;
        continue;
      }
      let hi = y;
      for (let m = 0; m < 22; m++) {
        const mid = (lo + hi) / 2;
        if (g(mid) >= 0) hi = mid;
        else lo = mid;
      }
      return hi;
    }
    return H;
  };
  const panelTops = panelThetas.map((thetas, pi) => thetas.map((t) => columnTop(Math.cos(t), pi === 0)));

  /** A point on the torso: column θ (whose top edge is at `top`) at height y, with cloth folds and baked shading. */
  const surface = (theta: number, top: number, y: number) => {
    const c = Math.cos(theta);
    const sn = Math.sin(theta);
    const x = halfWidth(y) * c;
    const d = Math.max(0, top - y);
    const k = Math.sqrt(1 - (1 - Math.min(1, d / roundR)) ** 2);
    const bt = bTop(x, y);
    let b = bt + (halfDepth(y) - bt) * k;
    // Cloth: hem flare, folds hanging from the chest that deepen toward the hem, wrinkles
    // under the arm. Folds run vertically, so they never band across the body. Boxy cuts fold larger.
    const hem = Math.max(0, 1 - y / (55 * s)) * 4 * s;
    const hang = 0.3 + 0.7 * (1 - smoothstep(H * 0.08, armpitY, y));
    // Whole numbers of folds around the body, so the side seams meet exactly.
    const drape = (Math.sin(theta * (boxy > 1 ? 5 : 7) + Math.sin(y * 0.005) * 0.8) * 0.7 + Math.sin(theta * 3 + 1.3) * 0.3) * hang * 1.7 * s * boxy;
    const side = Math.abs(c) ** 6 * smoothstep(armpitY - 170 * s, armpitY - 20 * s, y) * (1 - smoothstep(armpitY - 20 * s, armpitY + 30 * s, y));
    const underarm = sleeveless ? 0 : side * Math.sin(y * 0.09 + c * 4) * 3.2 * s;
    const rib = ribH && y < ribH ? Math.sin(theta * 160) * 0.6 * s : 0;
    const fold = (hem + drape + underarm + rib) * k;
    const r = 1 + fold / Math.max(chest, 1);
    b += fold * Math.abs(sn);
    // Baked ambient occlusion: shadow under the arms, at the collar, the hem and the sides.
    const sideness = Math.abs(c);
    const underarmShade = sleeveless
      ? smoothstep(0.75, 0.98, sideness) * smoothstep(armpitY - 60 * s, armpitY, y) * 0.6
      : smoothstep(armpitY - 150 * s, armpitY - 10 * s, y) * (1 - smoothstep(armpitY + 10 * s, armpitY + 150 * s, y)) * smoothstep(0.6, 0.95, sideness);
    const hemShade = 1 - smoothstep(0, 28 * s, y);
    const neckShade = Math.abs(x) < neckR * 1.15 ? 1 - Math.min(1, d / (26 * s)) : 0;
    const ao = 1 - 0.26 * underarmShade - 0.08 * hemShade - 0.16 * neckShade - 0.05 * sideness;
    return { x: x * r, z: -b * sn, ao };
  };

  // Rows stay level up to the yoke, just below the deepest cut. Above it each column's rows spread
  // evenly up to its own top edge, so the mesh ends exactly on the neckline, shoulders and
  // armholes: V-necks and armholes are clean lines, and trims drawn along them stay crisp.
  const lowestTop = Math.min(...panelTops.flat());
  const highestTop = Math.max(...panelTops.flat());
  const yokeY = Math.max(12 * s, lowestTop - 30 * s);
  const jA = Math.min(NV - 4, Math.max(2, Math.round((yokeY / H) * NV)));
  const rowY = (j: number, top: number) => (j <= jA ? (j / jA) * yokeY : yokeY + ((Math.max(top, yokeY) - yokeY) * (j - jA)) / (NV - jA));

  // Texture u is the fabric distance from the panel's centre line around the level section at the
  // vertex's own height (across any opening the cut makes), so the texture stays level and true to
  // size. Yoke vertices interpolate between finely spaced sections.
  const sectionArcs = (pi: number, y: number) => {
    const xs = new Float64Array(cols);
    const ys = new Float64Array(cols).fill(y);
    const zs = new Float64Array(cols);
    for (let i = 0; i < cols; i++) {
      const p = surface(panelThetas[pi][i], panelTops[pi][i], y);
      xs[i] = p.x;
      zs[i] = p.z;
    }
    return arcFromCentre(xs, ys, zs, NUh / 2);
  };
  const NL = detail === 'high' ? 80 : 40;
  const levelY = (l: number) => yokeY + ((highestTop - yokeY) * l) / NL;
  const rowArcs = [0, 1].map((pi) => Array.from({ length: jA + 1 }, (_, j) => sectionArcs(pi, (j / jA) * yokeY)));
  const levelArcs = [0, 1].map((pi) => Array.from({ length: NL + 1 }, (_, l) => sectionArcs(pi, levelY(l))));
  let torsoW = 0;
  for (const arcs of [...rowArcs, ...levelArcs]) for (const a of arcs) torsoW = Math.max(torsoW, (a[cols - 1] - a[0]) * 2);
  torsoW *= 1.02;
  const arcAt = (pi: number, i: number, j: number, y: number) => {
    if (j <= jA) return rowArcs[pi][j][i];
    const f = Math.min(NL, Math.max(0, ((y - yokeY) / Math.max(1e-6, highestTop - yokeY)) * NL));
    const l = Math.min(NL - 1, Math.floor(f));
    return lerp(levelArcs[pi][l][i], levelArcs[pi][l + 1][i], f - l);
  };

  const torsoEdges: EdgePoint[][] = [];
  const panels = [0, 1].map((pi) => {
    const centerU = pi === 0 ? 0.75 : 0.25;
    const rows = NV + 1;
    const pos = new Float32Array(cols * rows * 3);
    const uv = new Float32Array(cols * rows * 2);
    const shade = new Float32Array(cols * rows * 3);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const top = panelTops[pi][i];
        const y = rowY(j, top);
        const p = surface(panelThetas[pi][i], top, y);
        const o = j * cols + i;
        pos[o * 3] = p.x;
        pos[o * 3 + 1] = y;
        pos[o * 3 + 2] = p.z;
        uv[o * 2] = centerU + arcAt(pi, i, j, y) / torsoW;
        uv[o * 2 + 1] = y / H;
        shade[o * 3] = shade[o * 3 + 1] = shade[o * 3 + 2] = p.ao;
      }
    }
    // Yoke rows measure their own heights' sections; where a strap curls to the shoulder seam a
    // section can run longer than the one beside it. Keep u moving outward from the centre line
    // on every yoke row, so the texture never folds back on itself near the cut.
    const mid = NUh / 2;
    for (let j = jA + 1; j < rows; j++) {
      const o = j * cols;
      for (let i = mid + 1; i < cols; i++) uv[(o + i) * 2] = Math.max(uv[(o + i) * 2], uv[(o + i - 1) * 2] + 1e-5);
      for (let i = mid - 1; i >= 0; i--) uv[(o + i) * 2] = Math.min(uv[(o + i) * 2], uv[(o + i + 1) * 2] - 1e-5);
    }
    // The top edge, for trims: each column's last vertex lies on it.
    const edge: EdgePoint[] = [];
    for (let i = 0; i < cols; i++) {
      const o = NV * cols + i;
      const ax = Math.abs(pos[o * 3]);
      const kind: EdgePoint['kind'] = ax <= neckR * 1.02 ? 'neck' : sleeveless && ax >= shoulder - 1 ? 'armhole' : 'shoulder';
      edge.push({ u: uv[o * 2], v: uv[o * 2 + 1], kind });
    }
    torsoEdges.push(edge);
    return { pos, uv, shade };
  });
  const torso = mergeGeometries(panels.map((p) => gridGeometry(p.pos, p.uv, NUh, NV, false, p.shade)));
  const islands: GarmentIsland[] = [
    { id: 'front-body', label: 'Front body', part: 'torso', uv: gridOutline(panels[0].uv, cols, NV + 1) },
    { id: 'back-body', label: 'Back body', part: 'torso', uv: gridOutline(panels[1].uv, cols, NV + 1) },
  ];

  const parts: GarmentGeometry['parts'] = [{ id: 'torso', geometry: torso }];
  const trims: TrimMesh[] = [];

  // ---- Sleeves ----
  let sleeveW = 1;
  let sleeveLen = 1;
  const inset = 30 * s;
  if (model.sleeve) {
    const sl = model.sleeve;
    const alpha = (sl.angleDeg * Math.PI) / 180;
    const r0 = sl.rootRadiusMm * sW;
    const r1 = sl.cuffRadiusMm * sW;
    const ratio = 0.8;
    const length = (size.sleeveLengthMm ?? sl.lengthMm * s) + inset;
    sleeveLen = length;
    const ring = arcTable(1, ratio, 512);
    const SU = detail === 'high' ? 96 : 56;
    const SV = sl.lengthMm > 400 ? (detail === 'high' ? 72 : 44) : detail === 'high' ? 40 : 26;
    const cuffT = sl.cuff === 'rib' ? 1 - (60 * s) / length : 1;
    const radiusAt = (t: number) => {
      let r = lerp(r0, r1, smoothstep(0, 1, t));
      // Long sleeves blouse a little above a rib cuff, then gather into it.
      if (sl.cuff === 'rib') r *= t < cuffT ? 1 + 0.12 * smoothstep(cuffT - 0.25, cuffT, t) : 0.86;
      return r;
    };
    const build = (sgn: 1 | -1) => {
      const d = new THREE.Vector3(sgn * Math.cos(alpha), -Math.sin(alpha), 0);
      const n = new THREE.Vector3(sgn * Math.sin(alpha), Math.cos(alpha), 0);
      const kz = new THREE.Vector3(0, 0, sgn);
      const shoulderPt = new THREE.Vector3(sgn * shoulder, shoulderTop(shoulder), 0);
      const c0 = shoulderPt.clone().addScaledVector(n, -r0 * 0.93).addScaledVector(d, -inset);
      const cols = SU + 1;
      const xs = new Float64Array(cols * (SV + 1));
      const ys = new Float64Array(cols * (SV + 1));
      const zs = new Float64Array(cols * (SV + 1));
      const shade = new Float32Array(cols * (SV + 1) * 3);
      const tmp = new THREE.Vector3();
      for (let j = 0; j <= SV; j++) {
        const t = j / SV;
        const radius = radiusAt(t);
        const center = c0.clone().addScaledVector(d, t * length);
        for (let i = 0; i <= SU; i++) {
          // φ = π is the top of the sleeve, mid-texture, where sleeve prints sit.
          const phi = ring.thetaAt(i / SU) + Math.PI;
          const ribbed = sl.cuff === 'rib' && t > cuffT ? 1 + Math.sin(phi * 70) * 0.008 : 1;
          // Drape: the sleeve twists a little as it hangs, more toward the cuff, and a long
          // sleeve stacks into soft rings just above a rib cuff. Whole turns of φ keep the seam closed.
          const twist = (Math.sin(phi * 3 + t * 2.6 + 0.5) * 0.032 + Math.sin(phi * 5 - t * 3.4 + 1.9) * 0.013) * smoothstep(0.08, 0.9, t) * (sl.cuff === 'rib' ? 1 - smoothstep(cuffT - 0.04, cuffT, t) : 1);
          const stack = sl.cuff === 'rib' ? Math.sin(((t * length) / (36 * s)) * Math.PI * 2) * 0.03 * smoothstep(cuffT - 0.32, cuffT - 0.08, t) * (1 - smoothstep(cuffT - 0.05, cuffT, t)) : 0;
          const fold = drape * (twist + stack);
          const wrinkle = (1 + Math.sin(phi * 5 + t * 9) * 0.012 * (1 - t * 0.5) + (t > 0.92 ? (t - 0.92) * 0.25 : 0) + fold) * ribbed;
          tmp.copy(center)
            .addScaledVector(n, radius * Math.cos(phi) * wrinkle)
            .addScaledVector(kz, radius * ratio * -Math.sin(phi) * wrinkle);
          const o = j * cols + i;
          xs[o] = tmp.x;
          ys[o] = tmp.y;
          zs[o] = tmp.z;
          const junction = 1 - smoothstep(0, 0.18, t);
          const underside = Math.max(0, -Math.cos(phi));
          const cuff = smoothstep(0.93, 1, t);
          // Fold valleys catch less light.
          const ao = (1 - 0.24 * junction - 0.1 * underside - 0.06 * cuff) * (1 - Math.min(0.14, Math.max(0, -fold) * 4));
          shade[o * 3] = shade[o * 3 + 1] = shade[o * 3 + 2] = ao;
        }
      }
      return { xs, ys, zs, shade, cols };
    };
    const raw = [build(1), build(-1)];
    // Width: the widest ring (at the root), so every ring fits.
    const arcs = raw.map((r) => {
      const out: Float64Array[] = [];
      for (let j = 0; j <= SV; j++) {
        const a = arcFromCentre(r.xs.subarray(j * r.cols, (j + 1) * r.cols), r.ys.subarray(j * r.cols, (j + 1) * r.cols), r.zs.subarray(j * r.cols, (j + 1) * r.cols), SU / 2);
        sleeveW = Math.max(sleeveW, (a[r.cols - 1] - a[0]) * 1.02);
        out.push(a);
      }
      return out;
    });
    raw.forEach((r, k) => {
      const pos = new Float32Array(r.cols * (SV + 1) * 3);
      const uv = new Float32Array(r.cols * (SV + 1) * 2);
      for (let j = 0; j <= SV; j++) {
        for (let i = 0; i < r.cols; i++) {
          const o = j * r.cols + i;
          pos[o * 3] = r.xs[o];
          pos[o * 3 + 1] = r.ys[o];
          pos[o * 3 + 2] = r.zs[o];
          uv[o * 2] = 0.5 + arcs[k][j][i] / sleeveW;
          uv[o * 2 + 1] = 1 - j / SV;
        }
      }
      parts.push({ id: k === 0 ? 'sleeveLeft' : 'sleeveRight', geometry: gridGeometry(pos, uv, SU, SV, true, r.shade) });
      islands.push({ id: k === 0 ? 'left-sleeve' : 'right-sleeve', label: k === 0 ? 'Left sleeve' : 'Right sleeve', part: k === 0 ? 'sleeveLeft' : 'sleeveRight', uv: gridOutline(uv, r.cols, SV + 1) });
    });
  }

  // ---- Neckline ----
  const neckLoop = () => {
    const loop: THREE.Vector3[] = [];
    const steps = 48;
    for (let i = 0; i <= steps; i++) {
      const x = -neckR + (2 * neckR * i) / steps;
      const y = yTop(x, true);
      loop.push(new THREE.Vector3(x, y, bTop(x, y)));
    }
    for (let i = steps - 1; i > 0; i--) {
      const x = -neckR + (2 * neckR * i) / steps;
      const y = yTop(x, false);
      loop.push(new THREE.Vector3(x, y, -bTop(x, y)));
    }
    return loop;
  };
  if (model.neckline === 'crew' || model.neckline === 'v' || model.neckline === 'dobok' || model.neckline === 'scoop') {
    const tubeR = (model.neckline === 'crew' ? 8.5 : model.neckline === 'v' ? 6 : 4) * s;
    const curve = new THREE.CatmullRomCurve3(neckLoop(), true, 'centripetal');
    trims.push({ key: 'collar', geometry: new THREE.TubeGeometry(curve, 180, tubeR, 12, true), color: 'collar', surface: 'rib' });
  }
  if (model.neckline === 'polo') trims.push(...poloTrims(neckLoop(), H, model, s, halfDepth));
  let topMm = H + 10 * s;
  if (model.extras.hood) {
    const hood = hoodTrims(H, neckR, model, s);
    trims.push(...hood.meshes);
    topMm = hood.topMm;
  }
  if (model.extras.drawcords) trims.push(...drawcords(H, model, s));

  // ---- Kangaroo pocket: the torso surface itself, lifted, so prints continue across it ----
  let pocket: GarmentGeometry['pocket'];
  if (model.extras.pocket === 'kangaroo') {
    const p = panels[0];
    const y0 = (ribH || 0) + 6 * s;
    const y1 = y0 + 220 * s;
    // Level rows below the yoke sit at (j / jA) · yokeY.
    const j0 = Math.round((y0 / yokeY) * jA);
    const j1 = Math.max(j0 + 1, Math.min(jA, Math.round((y1 / yokeY) * jA)));
    const half = Math.round(NUh * 0.16);
    const i0 = NUh / 2 - half;
    const i1 = NUh / 2 + half;
    const nu = i1 - i0;
    const nv = j1 - j0;
    const pos = new Float32Array((nu + 1) * (nv + 1) * 3);
    const uv = new Float32Array((nu + 1) * (nv + 1) * 2);
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        const o = (j0 + j) * cols + (i0 + i);
        const q = j * (nu + 1) + i;
        const x = p.pos[o * 3];
        const z = p.pos[o * 3 + 2];
        const lift = 1 + (5 * s) / Math.max(1, Math.hypot(x, z));
        pos[q * 3] = x * lift;
        pos[q * 3 + 1] = p.pos[o * 3 + 1];
        pos[q * 3 + 2] = z * lift;
        uv[q * 2] = p.uv[o * 2];
        uv[q * 2 + 1] = p.uv[o * 2 + 1];
      }
    }
    trims.push({ key: 'pocket', geometry: gridGeometry(pos, uv, nu, nv, false), color: 'body', surface: model.fabricPresets[0].surface, mapPart: 'torso' });
    const ux0 = 0.75 + rowArcs[0][j0][i0] / torsoW;
    const ux1 = 0.75 + rowArcs[0][j0][i1] / torsoW;
    pocket = { x0: ux0 * torsoW, x1: ux1 * torsoW, y0: H - y1, y1: H - y0 };
  }

  // ---- Pants and belt (uniforms) ----
  let legW = 1;
  let legLen = 1;
  let bottomMm = 0;
  if (model.pants) {
    const pm = model.pants;
    // Pants follow the chart's waist and length where it gives them.
    const pw = size.waistFlatMm && pm.waistFlatMm ? size.waistFlatMm / pm.waistFlatMm : s;
    const pl = size.pantsLengthMm ? size.pantsLengthMm / (pm.riseMm + pm.inseamMm) : s;
    const waistY = H - pm.waistFromHpsMm * s;
    const len = (pm.riseMm + pm.inseamMm) * pl;
    legLen = len;
    bottomMm = waistY - len;
    const legs = buildLegs(pm, pw, pl, waistY, detail);
    legW = legs.width;
    parts.push({ id: 'legLeft', geometry: legs.left }, { id: 'legRight', geometry: legs.right });
    islands.push({ id: 'left-leg', label: 'Left leg', part: 'legLeft', uv: legs.outlines[0] }, { id: 'right-leg', label: 'Right leg', part: 'legRight', uv: legs.outlines[1] });
    if (model.belt) trims.push(...beltTrims(waistY, halfWidth(waistY), halfDepth(waistY), model.belt.widthMm * s, s));
  }

  // ---- Drape ----
  // Real cloth hangs from the shoulders and falls into folds under its own weight. Hanging folds
  // start below the underarm and grow toward the hem, gathered into groups so they read as folds
  // rather than ribbing; the hem waves a little; the body gathers softly under each arm. The
  // field depends only on position, with whole-number fold counts around the body, and moves
  // along welded normals, so seams never open and trims at the same place (pocket, belt) move
  // with the body. Nothing moves above the underarm, so sleeves, collar and hood still meet it.
  if (drape > 0) {
    const R = (chest + depth) / 2;
    const around = (wavelengthMm: number) => Math.max(1, Math.round((2 * Math.PI * R) / (wavelengthMm * s)));
    const kHang = around(105);
    const kFine = around(62);
    const kGroup = around(330);
    const kHem = around(170);
    const kDiag = around(80);
    const torsoFold = (x: number, y: number, z: number) => {
      const th = Math.atan2(x, z);
      const w = Math.min(1, Math.max(0, 1 - y / Math.max(1, armpitY)));
      let d = 0;
      if (w > 0) {
        // Two hanging scales drifting as they fall, and a diagonal family that breaks up the rhythm.
        const hang = Math.sin(kHang * th + (y * 0.0045) / s + 0.8) + 0.45 * Math.sin(kFine * th - (y * 0.008) / s + 2.1) + 0.35 * Math.sin(kDiag * th + (y * 0.016) / s + 4.2);
        const grouped = 0.4 + 0.6 * Math.max(0, Math.sin(kGroup * th + 1.3));
        const hem = (1 - smoothstep(0, 110 * s, y)) * Math.sin(kHem * th + 0.4);
        d += 3.4 * s * hang * grouped * w ** 1.2 + 2 * s * hem * w;
      }
      if (!sleeveless) {
        const ax = Math.abs(x) - chest * 0.9;
        const ay = y - (armpitY - 75 * s);
        const near = Math.exp(-(ax * ax + ay * ay) / (2 * (70 * s) ** 2)) * smoothstep(armpitY, armpitY - 50 * s, y);
        d += near * Math.sin((Math.abs(x) * 0.75 + y * 0.66) / (30 * s)) * 1.7 * s;
      }
      return d * drape;
    };
    for (const p of parts) if (p.id === 'torso') displaceAlongNormals(p.geometry, torsoFold, 3.5 * s * drape);
    for (const t of trims) if (t.key === 'pocket' || t.key.startsWith('belt')) displaceAlongNormals(t.geometry, torsoFold, 0);
  }

  // Motion weight per vertex (see motion.ts): held above the underarm, free toward the hem, the
  // cuffs and the pant hems. Trims follow the torso at their height, so they move with it.
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  const torsoFree = (y: number) => clamp01(1 - y / Math.max(1, armpitY)) ** 1.4;
  const setFree = (g: THREE.BufferGeometry, f: (y: number, i: number) => number) => {
    const pos = g.getAttribute('position');
    const out = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) out[i] = f(pos.getY(i), i);
    g.setAttribute('aFree', new THREE.BufferAttribute(out, 1));
  };
  // Limbs swing about a pivot when walking: each sleeve from its shoulder, each leg from the hip.
  // `aLimb` is (limb number, how far along the limb), 0 at the pivot and 1 at the cuff or hem.
  const limbPivots: GarmentGeometry['limbPivots'] = {};
  const setLimb = (g: THREE.BufferGeometry, limb: 1 | 2 | 3 | 4, along: (i: number) => number, atPivot: (i: number) => boolean) => {
    const pos = g.getAttribute('position');
    const out = new Float32Array(pos.count * 2);
    const pivot = [0, 0, 0];
    let n = 0;
    for (let i = 0; i < pos.count; i++) {
      out[i * 2] = limb;
      out[i * 2 + 1] = along(i);
      if (!atPivot(i)) continue;
      pivot[0] += pos.getX(i);
      pivot[1] += pos.getY(i);
      pivot[2] += pos.getZ(i);
      n++;
    }
    g.setAttribute('aLimb', new THREE.BufferAttribute(out, 2));
    if (n) limbPivots[limb] = [pivot[0] / n, pivot[1] / n, pivot[2] / n];
  };
  for (const p of parts) {
    if (p.id === 'sleeveLeft' || p.id === 'sleeveRight') {
      // Sleeve v runs from 1 at the shoulder to 0 at the cuff.
      const uv = p.geometry.getAttribute('uv');
      setFree(p.geometry, (_y, i) => clamp01(1 - uv.getY(i)) ** 1.5);
      setLimb(p.geometry, p.id === 'sleeveLeft' ? 1 : 2, (i) => clamp01(1 - uv.getY(i)) ** 1.1, (i) => uv.getY(i) > 0.999);
    } else if (p.id === 'legLeft' || p.id === 'legRight') {
      const top = model.pants ? H - model.pants.waistFromHpsMm * s : 0;
      setFree(p.geometry, (y) => clamp01((top - y) / Math.max(1, legLen)) ** 1.2);
      const pos = p.geometry.getAttribute('position');
      // Legs bend from the seat, a little below the waistband.
      const hipY = top - (model.pants?.riseMm ?? 0) * s * 0.55;
      setLimb(p.geometry, p.id === 'legLeft' ? 3 : 4, (i) => clamp01((hipY - pos.getY(i)) / Math.max(1, legLen * 0.8)) ** 1.1, (i) => Math.abs(pos.getY(i) - hipY) < 12 * s);
    } else {
      setFree(p.geometry, torsoFree);
    }
  }
  for (const t of trims) setFree(t.geometry, torsoFree);

  // Front-view span, sleeves and trims included, so wide cuts frame without clipping.
  const span = new THREE.Box3();
  for (const g of [...parts.map((p) => p.geometry), ...trims.map((t) => t.geometry)]) {
    g.computeBoundingBox();
    if (g.boundingBox) span.union(g.boundingBox);
  }

  return {
    parts,
    islands,
    trims,
    torsoEdges,
    pocket,
    limbPivots,
    layout: {
      torsoCircumferenceMm: torsoW,
      torsoHeightMm: H,
      frontCenterU: 0.75,
      backCenterU: 0.25,
      sleeveCircumferenceMm: sleeveW,
      sleeveLengthMm: sleeveLen,
      sleeveSeamOffsetMm: inset,
      legCircumferenceMm: legW,
      legLengthMm: legLen,
      heightMm: topMm - bottomMm,
      widthMm: span.isEmpty() ? chest * 2 : span.max.x - span.min.x,
      bottomMm,
    },
  };
}

/**
 * Move each vertex `offset(x, y, z)` millimetres along its normal, with normals averaged across
 * vertices that share a position (seams), so both sides of a seam move together. With `shadeMm`,
 * fold valleys that deep or deeper are shaded up to 16% darker in the vertex colours.
 */
function displaceAlongNormals(g: THREE.BufferGeometry, offset: (x: number, y: number, z: number) => number, shadeMm: number) {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const nor = g.getAttribute('normal') as THREE.BufferAttribute | undefined;
  if (!nor) return;
  const key = (i: number) => `${Math.round(pos.getX(i) * 20)},${Math.round(pos.getY(i) * 20)},${Math.round(pos.getZ(i) * 20)}`;
  const welded = new Map<string, [number, number, number]>();
  for (let i = 0; i < pos.count; i++) {
    const k = key(i);
    const n = welded.get(k) ?? [0, 0, 0];
    n[0] += nor.getX(i);
    n[1] += nor.getY(i);
    n[2] += nor.getZ(i);
    welded.set(k, n);
  }
  const color = g.getAttribute('color') as THREE.BufferAttribute | undefined;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const d = offset(x, y, z);
    if (!d) continue;
    const n = welded.get(key(i))!;
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    pos.setXYZ(i, x + (n[0] / len) * d, y + (n[1] / len) * d, z + (n[2] / len) * d);
    if (color && shadeMm > 0 && d < 0) {
      const k = 1 - 0.16 * Math.min(1, -d / shadeMm);
      color.setXYZ(i, color.getX(i) * k, color.getY(i) * k, color.getZ(i) * k);
    }
  }
  pos.needsUpdate = true;
  if (color) color.needsUpdate = true;
  g.computeVertexNormals();
}

function mergeGeometries(geoms: THREE.BufferGeometry[]) {
  let vertices = 0;
  let indices = 0;
  for (const g of geoms) {
    vertices += g.getAttribute('position').count;
    indices += g.getIndex()!.count;
  }
  const pos = new Float32Array(vertices * 3);
  const nor = new Float32Array(vertices * 3);
  const uv = new Float32Array(vertices * 2);
  const col = new Float32Array(vertices * 3);
  const index = new Uint32Array(indices);
  let vo = 0;
  let io = 0;
  for (const g of geoms) {
    const n = g.getAttribute('position').count;
    pos.set(g.getAttribute('position').array as Float32Array, vo * 3);
    nor.set(g.getAttribute('normal').array as Float32Array, vo * 3);
    uv.set(g.getAttribute('uv').array as Float32Array, vo * 2);
    const c = g.getAttribute('color');
    if (c) col.set(c.array as Float32Array, vo * 3);
    else col.fill(1, vo * 3, (vo + n) * 3);
    const idx = g.getIndex()!.array;
    for (let k = 0; k < idx.length; k++) index[io + k] = idx[k] + vo;
    vo += n;
    io += idx.length;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  return out;
}

/** Polo: a knitted collar falling over the shoulders, a three-button placket. */
function poloTrims(loop: THREE.Vector3[], H: number, model: GarmentModel, s: number, halfDepth: (y: number) => number): TrimMesh[] {
  // The collar runs round the back from one side of the placket to the other.
  const gap = 18 * s;
  const pts = loop.filter((p) => !(p.z > 0 && Math.abs(p.x) < gap));
  const startIdx = pts.findIndex((p, i) => i > 0 && p.z > 0 && p.x > 0 && pts[i - 1].x <= 0);
  const ordered = startIdx > 0 ? [...pts.slice(startIdx), ...pts.slice(0, startIdx)] : pts;
  const cols = ordered.length;
  const rows = 4;
  const pos = new Float32Array(cols * rows * 3);
  const uv = new Float32Array(cols * rows * 2);
  ordered.forEach((p, i) => {
    const radial = new THREE.Vector3(p.x, 0, p.z * 1.1).normalize();
    const up = 1;
    const rowsPts = [
      p.clone().addScaledVector(radial, 2 * s),
      p.clone().add(new THREE.Vector3(0, 24 * s * up, 0)).addScaledVector(radial, 4 * s),
      p.clone().add(new THREE.Vector3(0, 27 * s, 0)).addScaledVector(radial, 12 * s),
      p.clone().add(new THREE.Vector3(0, -26 * s, 0)).addScaledVector(radial, 46 * s),
    ];
    rowsPts.forEach((q, j) => {
      const o = j * cols + i;
      pos[o * 3] = q.x;
      pos[o * 3 + 1] = q.y;
      pos[o * 3 + 2] = q.z;
      uv[o * 2] = i / (cols - 1);
      uv[o * 2 + 1] = j / (rows - 1);
    });
  });
  const collar = gridGeometry(pos, uv, cols - 1, rows - 1, false);
  const placketTop = H - model.frontNeckDropMm * s;
  const placketLen = 150 * s;
  const z = halfDepth(placketTop - placketLen / 2) + 2.5 * s;
  const placket = new THREE.BoxGeometry(34 * s, placketLen, 3 * s);
  placket.translate(0, placketTop - placketLen / 2, z);
  const meshes: TrimMesh[] = [
    { key: 'polo-collar', geometry: collar, color: 'collar', surface: 'rib', doubleSided: true },
    { key: 'placket', geometry: placket, color: 'body', surface: 'pique' },
  ];
  const n = model.extras.placketButtons ?? 3;
  for (let b = 0; b < n; b++) {
    const g = new THREE.CylinderGeometry(6 * s, 6 * s, 3 * s, 20);
    g.rotateX(Math.PI / 2);
    g.translate(0, placketTop - 26 * s - b * 44 * s, z + 3 * s);
    meshes.push({ key: `button-${b}`, geometry: g, color: 'button', surface: 'plastic' });
  }
  return meshes;
}

/** Hoodie hood, worn up as on a ghost mannequin, with a rib edge round the face opening. */
function hoodTrims(H: number, neckR: number, model: GarmentModel, s: number): { meshes: TrimMesh[]; topMm: number } {
  const c = new THREE.Vector3(0, H + 118 * s, -18 * s);
  const rx = 122 * s;
  const ry = 176 * s;
  const rz = 142 * s;
  const open = (64 * Math.PI) / 180;
  const NU = 72;
  const NV = 40;
  const psi0 = -0.62;
  const psi1 = Math.PI / 2;
  const pos = new Float32Array((NU + 1) * (NV + 1) * 3);
  const uv = new Float32Array((NU + 1) * (NV + 1) * 2);
  for (let j = 0; j <= NV; j++) {
    const psi = lerp(psi0, psi1, j / NV);
    for (let i = 0; i <= NU; i++) {
      const phi = lerp(open, Math.PI * 2 - open, i / NU);
      // Narrower at the face opening, fuller at the back of the head, sitting on the neckline.
      const back = 1 + 0.08 * Math.cos(phi - Math.PI);
      const o = j * (NU + 1) + i;
      const x = rx * Math.cos(psi) * Math.sin(phi) * back;
      const y = ry * Math.sin(psi);
      const z = rz * Math.cos(psi) * Math.cos(phi) * back;
      // Pull the lower rim onto the neckline so the hood grows out of the collar.
      const low = smoothstep(psi0 + 0.35, psi0, psi);
      pos[o * 3] = lerp(c.x + x, x * (neckR / rx) * 1.12, low);
      pos[o * 3 + 1] = lerp(c.y + y, H - 6 * s, low);
      pos[o * 3 + 2] = lerp(c.z + z, z * (neckR / rz) * 0.95, low);
      uv[o * 2] = i / NU;
      uv[o * 2 + 1] = j / NV;
    }
  }
  const shell = gridGeometry(pos, uv, NU, NV, true);
  // Rib along the face opening.
  const edge: THREE.Vector3[] = [];
  for (let j = 0; j <= NV; j++) edge.push(new THREE.Vector3(pos[(j * (NU + 1)) * 3], pos[(j * (NU + 1)) * 3 + 1], pos[(j * (NU + 1)) * 3 + 2]));
  for (let j = NV; j >= 0; j--) {
    const o = j * (NU + 1) + NU;
    edge.push(new THREE.Vector3(pos[o * 3], pos[o * 3 + 1], pos[o * 3 + 2]));
  }
  const rim = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(edge, false, 'centripetal'), 160, 9 * s, 10, false);
  void model;
  return {
    meshes: [
      { key: 'hood', geometry: shell, color: 'body', surface: 'fleece', doubleSided: true },
      { key: 'hood-rim', geometry: rim, color: 'collar', surface: 'rib' },
    ],
    topMm: c.y + ry + 4 * s,
  };
}

function drawcords(H: number, model: GarmentModel, s: number): TrimMesh[] {
  const y0 = H - model.frontNeckDropMm * s + 4 * s;
  const z0 = model.bodyHalfDepthMm * s + 4 * s;
  return [-1, 1].map((sgn, k) => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(sgn * 28 * s, y0, z0 - 6 * s),
      new THREE.Vector3(sgn * 32 * s, y0 - 80 * s, z0 + 4 * s),
      new THREE.Vector3(sgn * 30 * s, y0 - 200 * s, z0 + 6 * s),
      new THREE.Vector3(sgn * 34 * s, y0 - 270 * s, z0 + 5 * s),
    ]);
    return { key: `cord-${k}`, geometry: new THREE.TubeGeometry(curve, 48, 3.2 * s, 8, false), color: 'collar' as const, surface: 'rib' as const };
  });
}

/**
 * Wide uniform pants: two leg tubes that meet at the centre line from the waist to the crotch
 * and hang apart below it. UVs run around from the outside of each leg, down from the waist.
 */
/** `sw` grades widths (by the waist), `sl` grades length. */
function buildLegs(pm: NonNullable<GarmentModel['pants']>, sw: number, sl: number, waistY: number, detail: Detail) {
  const len = (pm.riseMm + pm.inseamMm) * sl;
  const tc = pm.riseMm / (pm.riseMm + pm.inseamMm);
  const NU = detail === 'high' ? 80 : 48;
  const NV = detail === 'high' ? 110 : 64;
  const ring = arcTable(1, 1.04, 512);
  const build = (sgn: 1 | -1) => {
    const cols = NU + 1;
    const xs = new Float64Array(cols * (NV + 1));
    const ys = new Float64Array(cols * (NV + 1));
    const zs = new Float64Array(cols * (NV + 1));
    const shade = new Float32Array(cols * (NV + 1) * 3);
    for (let j = 0; j <= NV; j++) {
      const t = j / NV;
      const y = waistY - t * len;
      const hip = smoothstep(0, tc, t);
      // Above the crotch each leg is half of one seat (a "D" whose flat side is the centre seam),
      // so the pair reads as one waist and seat. Below it, each leg is its own round tube.
      const legs = smoothstep(tc - 0.05, tc + 0.12, t);
      const below = smoothstep(tc - 0.04, 1, t);
      const seatW = lerp(pm.waistHalfWidthMm, pm.hipHalfWidthMm, hip) * sw;
      const seatZ = lerp(pm.waistHalfDepthMm, pm.waistHalfDepthMm * 1.12, hip) * sw;
      const cx = (pm.hipHalfWidthMm * sw) / 2;
      const rx = lerp(pm.thighRadiusMm * sw, pm.hemRadiusMm * sw, smoothstep(tc, 1, t));
      const rz = lerp(seatZ, rx * 1.04, legs);
      for (let i = 0; i <= NU; i++) {
        // i = NU/2 is the outside of the leg; the inseam is at the texture edges.
        const phi = ring.thetaAt(i / NU) + Math.PI;
        const drape = 1 + Math.sin(phi * 6 + t * 7) * 0.022 * below + Math.sin(phi * 3 - t * 3) * 0.012 * below;
        const o = j * cols + i;
        const seatX = seatW * Math.max(0, Math.cos(phi));
        xs[o] = sgn * lerp(seatX, cx + rx * Math.cos(phi) * drape, legs);
        ys[o] = y;
        zs[o] = -sgn * rz * Math.sin(phi) * lerp(1, drape, legs);
        const inner = Math.max(0, -Math.cos(phi));
        const ao = 1 - 0.18 * inner * (1 - smoothstep(tc, tc + 0.25, t)) - 0.12 * (1 - smoothstep(0, 0.08, t)) - 0.05 * smoothstep(0.95, 1, t);
        shade[o * 3] = shade[o * 3 + 1] = shade[o * 3 + 2] = ao;
      }
    }
    return { xs, ys, zs, shade, cols };
  };
  const raw = [build(1), build(-1)];
  let width = 1;
  const arcs = raw.map((r) => {
    const out: Float64Array[] = [];
    for (let j = 0; j <= NV; j++) {
      const a = arcFromCentre(r.xs.subarray(j * r.cols, (j + 1) * r.cols), r.ys.subarray(j * r.cols, (j + 1) * r.cols), r.zs.subarray(j * r.cols, (j + 1) * r.cols), NU / 2);
      width = Math.max(width, (a[r.cols - 1] - a[0]) * 1.02);
      out.push(a);
    }
    return out;
  });
  const geoms = raw.map((r, k) => {
    const pos = new Float32Array(r.cols * (NV + 1) * 3);
    const uv = new Float32Array(r.cols * (NV + 1) * 2);
    for (let j = 0; j <= NV; j++) {
      for (let i = 0; i < r.cols; i++) {
        const o = j * r.cols + i;
        pos[o * 3] = r.xs[o];
        pos[o * 3 + 1] = r.ys[o];
        pos[o * 3 + 2] = r.zs[o];
        uv[o * 2] = 0.5 + arcs[k][j][i] / width;
        uv[o * 2 + 1] = 1 - j / NV;
      }
    }
    // Both legs run their columns towards the viewer's right as seen from their own side,
    // so the same winding faces outward on each.
    void k;
    return { geometry: gridGeometry(pos, uv, NU, NV, true, r.shade), outline: gridOutline(uv, r.cols, NV + 1) };
  });
  return { left: geoms[0].geometry, right: geoms[1].geometry, outlines: [geoms[0].outline, geoms[1].outline], width };
}

/** A rank belt wrapped at the waist over the top, with a square knot and two tails. */
function beltTrims(waistY: number, a: number, b: number, width: number, s: number): TrimMesh[] {
  const ra = a * 1.035 + 5 * s;
  const rb = b * 1.08 + 5 * s;
  const N = 96;
  const pos: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  // Outer face, plus top and bottom edges folding in, as one strip of four rows.
  const rows = [
    { y: width / 2, k: 0.985 },
    { y: width / 2, k: 1 },
    { y: -width / 2, k: 1 },
    { y: -width / 2, k: 0.985 },
  ];
  for (let r = 0; r < rows.length; r++) {
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * Math.PI * 2;
      pos.push(ra * rows[r].k * Math.cos(t), waistY + rows[r].y, -rb * rows[r].k * Math.sin(t));
      uv.push(i / N, r / (rows.length - 1));
    }
  }
  for (let r = 0; r < rows.length - 1; r++) {
    for (let i = 0; i < N; i++) {
      const p = r * (N + 1) + i;
      const q = p + N + 1;
      index.push(p, q, p + 1, p + 1, q, q + 1);
    }
  }
  const band = new THREE.BufferGeometry();
  band.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  band.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  band.setIndex(index);
  band.computeVertexNormals();
  const zFront = rb + 4 * s;
  const knot = new THREE.BoxGeometry(width * 1.55, width * 1.2, 20 * s, 2, 2, 2);
  knot.translate(0, waistY, zFront + 6 * s);
  const tails = [-1, 1].map((sgn) => {
    const g = new THREE.BoxGeometry(width, 290 * s, 6 * s, 1, 8, 1);
    g.translate(0, -145 * s, 0);
    g.rotateZ(sgn * 0.17);
    g.rotateX(-0.06);
    g.translate(sgn * width * 0.45, waistY - width * 0.3, zFront + 10 * s);
    return g;
  });
  return [
    { key: 'belt', geometry: band, color: 'belt', surface: 'rib', doubleSided: true },
    { key: 'belt-knot', geometry: knot, color: 'belt', surface: 'rib' },
    { key: 'belt-tail-0', geometry: tails[0], color: 'belt', surface: 'rib' },
    { key: 'belt-tail-1', geometry: tails[1], color: 'belt', surface: 'rib' },
  ];
}

/** Fabric surface normal maps, generated once, no network asset. One tile is about 5 mm. */
export function createFabricNormalMap(surface: FabricSurface | 'plastic'): THREE.DataTexture {
  const size = 128;
  const height = (x: number, y: number): number => {
    switch (surface) {
      case 'rib':
        return Math.abs(Math.sin((Math.PI * x) / 4));
      case 'pique': {
        const cx = ((x % 16) + 16) % 16;
        const cy = (((y + (Math.floor(x / 16) % 2) * 8) % 16) + 16) % 16;
        return 1 - Math.min(1, Math.hypot(cx - 8, cy - 8) / 8) ** 2;
      }
      case 'fleece':
        return 0.5 + 0.25 * Math.sin(x * 0.37 + Math.sin(y * 0.23) * 2) * Math.sin(y * 0.31 + Math.sin(x * 0.19) * 2);
      case 'mesh': {
        const cx = ((x % 12) + 12) % 12;
        const cy = (((y + (Math.floor(x / 12) % 2) * 6) % 12) + 12) % 12;
        return Math.min(1, Math.hypot(cx - 6, cy - 6) / 3.2);
      }
      case 'diamond':
        return Math.abs(Math.sin((Math.PI * (x + y)) / 16)) * Math.abs(Math.sin((Math.PI * (x - y)) / 16));
      case 'plastic':
        return 0.5;
      default: {
        const rib = Math.abs(Math.sin((Math.PI * x) / 8));
        const loop = 0.65 + 0.35 * Math.abs(Math.sin((Math.PI * (y + (Math.floor(x / 8) % 2) * 4)) / 8));
        return rib * loop;
      }
    }
  };
  const data = new Uint8Array(size * size * 4);
  const strength = surface === 'rib' ? 1.8 : surface === 'mesh' ? 1.6 : 1.4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = height((x + 1) % size, y) - height((x - 1 + size) % size, y);
      const dy = height(x, (y + 1) % size) - height(x, (y - 1 + size) % size);
      const n = new THREE.Vector3(-dx * strength, -dy * strength, 1).normalize();
      const o = (y * size + x) * 4;
      data[o] = (n.x * 0.5 + 0.5) * 255;
      data[o + 1] = (n.y * 0.5 + 0.5) * 255;
      data[o + 2] = (n.z * 0.5 + 0.5) * 255;
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** How each fabric reads under light: normal strength, roughness and sheen. */
export const FABRIC_LOOK: Record<FabricSurface | 'plastic', { normal: number; roughness: number; sheen: number; tileMm: number }> = {
  jersey: { normal: 0.32, roughness: 0.93, sheen: 0.45, tileMm: 5 },
  rib: { normal: 0.5, roughness: 0.92, sheen: 0.4, tileMm: 4 },
  pique: { normal: 0.45, roughness: 0.9, sheen: 0.35, tileMm: 4 },
  fleece: { normal: 0.14, roughness: 0.97, sheen: 0.7, tileMm: 9 },
  mesh: { normal: 0.6, roughness: 0.72, sheen: 0.25, tileMm: 4 },
  diamond: { normal: 0.4, roughness: 0.88, sheen: 0.3, tileMm: 6 },
  plastic: { normal: 0, roughness: 0.35, sheen: 0, tileMm: 10 },
};
