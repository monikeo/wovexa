/**
 * Procedural crew-neck tee (placeholder for a calibrated GLB, spec §28).
 * Built in millimetres. Texture coordinates follow surface arc length, so one texture
 * pixel covers the same physical area across a print zone and placed artwork keeps its
 * true size on the 3D garment.
 *
 * Coordinate frame: +y up, +z toward the viewer (garment front), wearer's left at +x.
 */
import * as THREE from 'three';
import type { GarmentModel, GarmentSize } from '@/domain/garments';

/** Arc-length table for an ellipse x = a·cosθ, z = −b·sinθ, so u ∈ [0,1] is uniform along the surface. */
function arcTable(a: number, b: number, samples = 2048) {
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

export interface TeeLayout {
  /** Torso texture: circumference (u) × body length (v), in mm. */
  torsoCircumferenceMm: number;
  torsoHeightMm: number;
  frontCenterU: number;
  backCenterU: number;
  /** Sleeve texture: circumference at the print zone (u) × tube length (v), in mm. */
  sleeveCircumferenceMm: number;
  sleeveLengthMm: number;
  /** Distance from the tube root to the shoulder seam along the sleeve. */
  sleeveSeamOffsetMm: number;
  heightMm: number;
}

export interface TeeGeometry {
  torso: THREE.BufferGeometry;
  sleeveLeft: THREE.BufferGeometry;
  sleeveRight: THREE.BufferGeometry;
  collar: THREE.BufferGeometry;
  layout: TeeLayout;
}

export function buildTee(model: GarmentModel, size: GarmentSize): TeeGeometry {
  const s = size.scale;
  const H = model.bodyLengthMm * s;
  const chest = model.chestHalfWidthMm * s;
  const depth = model.bodyHalfDepthMm * s;
  const shoulder = model.shoulderHalfWidthMm * s;
  const neckR = model.neckRadiusMm * s;
  const neckDepth = 68 * s;
  const roundR = 78 * s;
  const armholeY = H * 0.64;
  const { total: circumference, thetaAt } = arcTable(chest, depth);

  const yTop = (x: number, front: boolean) => {
    const ax = Math.abs(x);
    if (ax <= neckR) {
      const drop = (front ? model.frontNeckDropMm : model.backNeckDropMm) * s;
      return H - drop * (1 - (ax / neckR) ** 2);
    }
    return H - model.shoulderSlope * (ax - neckR);
  };
  const bTop = (x: number) => {
    const ax = Math.abs(x);
    return ax < neckR ? neckDepth * Math.sqrt(1 - (ax / neckR) ** 2) : 0;
  };
  const halfWidth = (y: number) => {
    const hem = chest * 0.975;
    const body = lerp(hem, chest, smoothstep(0, H * 0.45, y));
    return lerp(body, shoulder, smoothstep(armholeY - 40 * s, H, y));
  };
  const halfDepth = (y: number) => lerp(depth * 0.95, depth, smoothstep(0, H * 0.5, y));

  // ---- Torso ----
  const NU = 192;
  const NV = 140;
  const pos = new Float32Array((NU + 1) * (NV + 1) * 3);
  const uv = new Float32Array((NU + 1) * (NV + 1) * 2);
  const thetas = Array.from({ length: NU + 1 }, (_, i) => thetaAt(i / NU));
  for (let j = 0; j <= NV; j++) {
    const y = (j / NV) * H;
    for (let i = 0; i <= NU; i++) {
      const theta = thetas[i];
      const c = Math.cos(theta);
      const sn = Math.sin(theta);
      const front = sn < 0; // z = −b·sinθ > 0
      const x = halfWidth(y) * c;
      const top = yTop(x, front);
      const yy = Math.min(y, top);
      const d = top - yy;
      const t = Math.min(1, d / roundR);
      const k = Math.sqrt(1 - (1 - t) ** 2);
      const bt = bTop(x);
      let b = bt + (halfDepth(y) - bt) * k;
      let r = 1;
      // Subtle cloth folds: hem flare, a soft diagonal drape, and side wrinkles under the arm.
      const hem = Math.max(0, 1 - y / (55 * s)) * 4 * s;
      const drape = Math.sin(theta * 6 + y * 0.03) * Math.sin(y * 0.019 - theta * 2.1) * 1.4 * s;
      const side = Math.abs(c) ** 6 * smoothstep(armholeY - 170 * s, armholeY - 20 * s, y) * (1 - smoothstep(armholeY - 20 * s, armholeY + 30 * s, y));
      const underarm = side * Math.sin(y * 0.09 + c * 4) * 3.2 * s;
      const fold = (hem + drape + underarm) * k;
      r = 1 + fold / Math.max(chest, 1);
      b += fold * Math.abs(sn);
      const o = (j * (NU + 1) + i) * 3;
      pos[o] = x * r;
      pos[o + 1] = yy;
      pos[o + 2] = -b * sn;
      const q = (j * (NU + 1) + i) * 2;
      uv[q] = i / NU;
      uv[q + 1] = y / H;
    }
  }
  const torso = gridGeometry(pos, uv, NU, NV);

  // ---- Sleeves ----
  const alpha = (model.sleeveAngleDeg * Math.PI) / 180;
  const r0 = 104 * s;
  const r1 = 80 * s;
  const ratio = 0.8;
  const inset = 30 * s;
  const length = model.sleeveLengthMm * s + inset;
  const ring = arcTable(1, ratio, 512);
  const sleeve = (sgn: 1 | -1) => {
    const d = new THREE.Vector3(sgn * Math.cos(alpha), -Math.sin(alpha), 0);
    const n = new THREE.Vector3(sgn * Math.sin(alpha), Math.cos(alpha), 0);
    const k = new THREE.Vector3(0, 0, sgn);
    const shoulderPt = new THREE.Vector3(sgn * shoulder, yTop(shoulder, true), 0);
    const c0 = shoulderPt.clone().addScaledVector(n, -r0 * 0.93).addScaledVector(d, -inset);
    const SU = 96;
    const SV = 40;
    const p = new Float32Array((SU + 1) * (SV + 1) * 3);
    const tuv = new Float32Array((SU + 1) * (SV + 1) * 2);
    const tmp = new THREE.Vector3();
    for (let j = 0; j <= SV; j++) {
      const t = j / SV;
      const radius = lerp(r0, r1, smoothstep(0, 1, t));
      const center = c0.clone().addScaledVector(d, t * length);
      for (let i = 0; i <= SU; i++) {
        // φ starts under the arm so the print zone (top of the sleeve, φ = π) sits mid-texture.
        const phi = ring.thetaAt(i / SU) + Math.PI;
        const wrinkle = 1 + Math.sin(phi * 5 + t * 9) * 0.012 * (1 - t * 0.5) + (t > 0.92 ? (t - 0.92) * 0.25 : 0);
        tmp.copy(center)
          .addScaledVector(n, radius * Math.cos(phi) * wrinkle)
          .addScaledVector(k, radius * ratio * -Math.sin(phi) * wrinkle);
        const o = (j * (SU + 1) + i) * 3;
        p[o] = tmp.x;
        p[o + 1] = tmp.y;
        p[o + 2] = tmp.z;
        const q = (j * (SU + 1) + i) * 2;
        // u runs so artwork reads correctly when the sleeve is viewed from its own side;
        // v = 1 at the shoulder so the top of the artwork points up the arm.
        tuv[q] = i / SU;
        tuv[q + 1] = 1 - t;
      }
    }
    return gridGeometry(p, tuv, SU, SV, true);
  };

  // ---- Collar rib ----
  const loop: THREE.Vector3[] = [];
  const steps = 40;
  for (let i = 0; i <= steps; i++) {
    const x = -neckR + (2 * neckR * i) / steps;
    loop.push(new THREE.Vector3(x, yTop(x, true), bTop(x)));
  }
  for (let i = steps - 1; i > 0; i--) {
    const x = -neckR + (2 * neckR * i) / steps;
    loop.push(new THREE.Vector3(x, yTop(x, false), -bTop(x)));
  }
  const curve = new THREE.CatmullRomCurve3(loop, true, 'centripetal');
  const collar = new THREE.TubeGeometry(curve, 160, 8.5 * s, 14, true);

  const zoneRadius = lerp(r0, r1, smoothstep(0, 1, (inset + 95 * s) / length));
  return {
    torso,
    sleeveLeft: sleeve(1),
    sleeveRight: sleeve(-1),
    collar,
    layout: {
      torsoCircumferenceMm: circumference,
      torsoHeightMm: H,
      frontCenterU: 0.75,
      backCenterU: 0.25,
      sleeveCircumferenceMm: ring.total * zoneRadius,
      sleeveLengthMm: length,
      sleeveSeamOffsetMm: inset,
      heightMm: H,
    },
  };
}

function gridGeometry(position: Float32Array, uv: Float32Array, nu: number, nv: number, flip = false) {
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
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** Fine knit normal map, tiled across the fabric. Generated once, no network asset. */
export function createKnitNormalMap(): THREE.DataTexture {
  const size = 128;
  const height = (x: number, y: number) => {
    const rib = Math.abs(Math.sin((Math.PI * x) / 8));
    const loop = 0.65 + 0.35 * Math.abs(Math.sin((Math.PI * (y + (Math.floor(x / 8) % 2) * 4)) / 8));
    return rib * loop;
  };
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = height((x + 1) % size, y) - height((x - 1 + size) % size, y);
      const dy = height(x, (y + 1) % size) - height(x, (y - 1 + size) % size);
      const n = new THREE.Vector3(-dx * 1.4, -dy * 1.4, 1).normalize();
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
