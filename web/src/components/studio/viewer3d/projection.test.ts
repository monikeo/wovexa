import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { getSize, TEE_CLASSIC } from '@/domain/garments';
import { buildGarment } from './garment-geometry';
import {
  angleAbout,
  buildDepthMap,
  decalFrame,
  dragProjector,
  facingStrength,
  insideOutline,
  keepTriangles,
  meshPieces,
  paintTriangles,
  selectTriangles,
  slideProjector,
  surfaceAlong,
  surfaceAtUv,
  textureAxes,
  toDecal,
  type DecalImage,
  type DecalPlacement,
  type ProjectionMesh,
  type TexturePatch,
  type Vec3,
} from './projection';
import { uvToZone, zoneToUv } from './uv-mapping';

// ---- Helpers ----

function meshOf(g: THREE.BufferGeometry): ProjectionMesh {
  return {
    position: g.getAttribute('position').array as Float32Array,
    normal: g.getAttribute('normal').array as Float32Array,
    uv: g.getAttribute('uv').array as Float32Array,
    index: g.getIndex()!.array,
  };
}

/** A flat grid at depth z, facing +z (or −z when `back`), textured into u ∈ [u0, u1]. */
function quad(x0: number, x1: number, y0: number, y1: number, z: number, u0: number, u1: number, back = false, n = 8): ProjectionMesh {
  const position: number[] = [];
  const uv: number[] = [];
  const normal: number[] = [];
  const index: number[] = [];
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      position.push(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * j) / n, z);
      uv.push(u0 + ((u1 - u0) * i) / n, j / n);
      normal.push(0, 0, back ? -1 : 1);
    }
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      const b = a + 1;
      const c = a + n + 1;
      const d = c + 1;
      if (back) index.push(a, c, b, b, c, d);
      else index.push(a, b, c, b, d, c);
    }
  }
  return { position: new Float32Array(position), uv: new Float32Array(uv), normal: new Float32Array(normal), index: new Uint32Array(index) };
}

/** Artwork whose colour encodes its own position: red runs left to right, green top to bottom. */
function gradientArt(widthMm: number, heightMm: number, pxPerMm: number): DecalImage {
  const width = Math.round(widthMm * pxPerMm);
  const height = Math.round(heightMm * pxPerMm);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      data[o] = (x * 255) / (width - 1);
      data[o + 1] = (y * 255) / (height - 1);
      data[o + 2] = 40;
      data[o + 3] = 255;
    }
  }
  return { width, height, data, pxPerMm, originMm: 0 };
}

function texel(patches: TexturePatch[], x: number, y: number): [number, number, number, number] {
  for (const p of patches) {
    if (x < p.x || y < p.y || x >= p.x + p.width || y >= p.y + p.height) continue;
    const o = ((y - p.y) * p.width + (x - p.x)) * 4;
    return [p.data[o], p.data[o + 1], p.data[o + 2], p.data[o + 3]];
  }
  return [0, 0, 0, 0];
}

function inkedTexels(patches: TexturePatch[]) {
  let n = 0;
  for (const p of patches) for (let i = 3; i < p.data.length; i += 4) if (p.data[i] > 0) n++;
  return n;
}

const vertex = (m: ProjectionMesh, i: number): Vec3 => [m.position[i * 3], m.position[i * 3 + 1], m.position[i * 3 + 2]];
const vnormal = (m: ProjectionMesh, i: number): Vec3 => [m.normal![i * 3], m.normal![i * 3 + 1], m.normal![i * 3 + 2]];
const placement = (point: Vec3, normal: Vec3, up: Vec3, widthMm: number, heightMm: number, rotationDeg = 0): DecalPlacement => ({ projector: { point, normal, up }, widthMm, heightMm, rotationDeg });

// The classic tee at rest (no drape). Low detail: 65 columns × 97 rows per torso panel, front panel first.
const model = TEE_CLASSIC;
const geo = buildGarment(model, getSize(model, 'M'), 'low', 0);
const part = (id: string) => meshOf(geo.parts.find((p) => p.id === id)!.geometry);
const torso = part('torso');
const sleeveLeft = part('sleeveLeft');
const COLS = 65;
const PANEL = COLS * 97;
const torsoTex = { width: Math.round(geo.layout.torsoCircumferenceMm * 2), height: Math.round(geo.layout.torsoHeightMm * 2) };

describe('triangle selection', () => {
  const front = quad(-60, 60, -40, 40, 0, 0, 0.5);
  const behind = quad(-60, 60, -40, 40, -20, 0.5, 1, true);
  const box = decalFrame(placement([0, 0, 0], [0, 0, 1], [0, 1, 0], 80, 40));

  it('takes the triangles inside the box that face the projector', () => {
    const sel = selectTriangles(front, box);
    expect(sel.triangles.length).toBeGreaterThan(0);
    const idx = front.index;
    for (const t of sel.triangles) {
      // Every selected triangle reaches into the 80 × 40 mm box.
      const xs = [0, 1, 2].map((k) => front.position[idx[t * 3 + k] * 3]);
      const ys = [0, 1, 2].map((k) => front.position[idx[t * 3 + k] * 3 + 1]);
      expect(Math.max(...xs)).toBeGreaterThanOrEqual(-40);
      expect(Math.min(...xs)).toBeLessThanOrEqual(40);
      expect(Math.max(...ys)).toBeGreaterThanOrEqual(-20);
      expect(Math.min(...ys)).toBeLessThanOrEqual(20);
    }
    // The grid is 8 × 8 cells of 15 × 10 mm; the box covers columns 2–5 and rows 2–5 fully, plus edges.
    expect(sel.triangles.length).toBeLessThan(front.index.length / 3);
  });

  it('rejects back faces, so nothing prints through to the inside', () => {
    expect(selectTriangles(behind, box).triangles.length).toBe(0);
    // The same cloth turned toward the projector is taken.
    expect(selectTriangles(quad(-60, 60, -40, 40, -20, 0.5, 1), box).triangles.length).toBeGreaterThan(0);
  });

  it('ignores cloth beyond the box depth', () => {
    const far = quad(-60, 60, -40, 40, -400, 0, 0.5);
    expect(selectTriangles(far, box).triangles.length).toBe(0);
  });

  it('fades the artwork out as the cloth turns edge-on', () => {
    expect(facingStrength(1)).toBe(1);
    expect(facingStrength(Math.cos((60 * Math.PI) / 180))).toBe(1);
    const mid = facingStrength(Math.cos((75 * Math.PI) / 180));
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(facingStrength(Math.cos((86 * Math.PI) / 180))).toBe(0);
    expect(facingStrength(-1)).toBe(0);
  });

  it('skips cloth hidden behind nearer cloth', () => {
    // A narrow panel 10 mm in front of a wide one: the wide one only takes ink where it shows.
    const near = quad(-30, 30, -40, 40, 0, 0, 0.5);
    const wide = quad(-90, 90, -40, 40, -10, 0.5, 1);
    const f = decalFrame(placement([0, 0, 0], [0, 0, 1], [0, 1, 0], 160, 60));
    const parts = [near, wide].map((mesh) => ({ mesh, projected: selectTriangles(mesh, f) }));
    const depth = buildDepthMap(parts, f);
    const art = gradientArt(160, 60, 2);
    const target = { width: 720, height: 160 };
    const hidden = paintTriangles(wide, parts[1].projected, art, target, { depth, padPx: 0 });
    const open = paintTriangles(wide, parts[1].projected, art, target, { padPx: 0 });
    // Texture x for garment x on the wide panel: u = 0.5 + 0.5 (x + 90) / 180.
    const tx = (x: number) => Math.floor((0.5 + (0.5 * (x + 90)) / 180) * target.width);
    expect(texel(hidden, tx(0), 80)[3]).toBe(0);
    expect(texel(hidden, tx(15), 80)[3]).toBe(0);
    expect(texel(hidden, tx(60), 80)[3]).toBe(255);
    expect(texel(hidden, tx(-60), 80)[3]).toBe(255);
    expect(texel(open, tx(0), 80)[3]).toBe(255);
    // The near panel is never hidden by the cloth behind it.
    expect(inkedTexels(paintTriangles(near, parts[0].projected, art, target, { depth, padPx: 0 }))).toBe(inkedTexels(paintTriangles(near, parts[0].projected, art, target, { padPx: 0 })));
  });
});

describe('any mesh, any texture', () => {
  it('paints a texture of any size in either UV convention', () => {
    const flat = quad(-60, 60, -40, 40, 0, 0, 1);
    const f = decalFrame(placement([0, 0, 0], [0, 0, 1], [0, 1, 0], 80, 40));
    const sel = selectTriangles(flat, f);
    const art = gradientArt(80, 40, 3);
    const target = { width: 300, height: 200 };
    const threeJs = paintTriangles(flat, sel, art, target, { padPx: 0 });
    const gltf = paintTriangles(flat, sel, art, target, { padPx: 0, flipY: false });
    // The artwork's top edge (green 0) sits at garment y = +20, which is v = 0.75: row 50 when v
    // runs up the texture, row 150 when it runs down. Its bottom edge (green 255) the other way.
    expect(texel(threeJs, 150, 52)[1]).toBeLessThan(20);
    expect(texel(threeJs, 150, 148)[1]).toBeGreaterThan(235);
    expect(texel(gltf, 150, 148)[1]).toBeLessThan(20);
    expect(texel(gltf, 150, 52)[1]).toBeGreaterThan(235);
    // Same footprint, mirrored: x stays, rows swap.
    expect(inkedTexels(gltf)).toBe(inkedTexels(threeJs));
  });

  it('finds a mesh’s separate pieces, and the triangles of one piece', () => {
    const a = quad(-60, 0, -40, 40, 0, 0, 0.5, false, 4);
    const b = quad(0, 60, -40, 40, 0, 0.5, 1, false, 4);
    const offset = a.position.length / 3;
    const join = (x: ArrayLike<number>, y: ArrayLike<number>) => [...Array.from(x), ...Array.from(y)];
    const both: ProjectionMesh = {
      position: Float32Array.from(join(a.position, b.position)),
      normal: Float32Array.from(join(a.normal!, b.normal!)),
      uv: Float32Array.from(join(a.uv, b.uv)),
      index: Uint32Array.from(join(a.index, Array.from(b.index, (i) => i + offset))),
    };
    const pieces = meshPieces(both);
    expect(new Set(pieces).size).toBe(2);
    expect(pieces[0]).not.toBe(pieces[pieces.length - 1]);
    // The pieces meet at x = 0, but share no vertices: one artwork spans both, each paints its own share.
    const sel = selectTriangles(both, decalFrame(placement([0, 0, 0], [0, 0, 1], [0, 1, 0], 60, 40)));
    const left = keepTriangles(sel, (t) => pieces[t] === pieces[0]);
    expect(left.triangles.length).toBeGreaterThan(0);
    expect(left.triangles.length).toBeLessThan(sel.triangles.length);
    expect(left.faceFacing.length).toBe(left.triangles.length);
    // The torso is two pattern pieces, front and back.
    expect(new Set(meshPieces(torso)).size).toBe(2);
  });

  it('tests points against a piece outline', () => {
    const square: [number, number][] = [
      [0.1, 0.1],
      [0.4, 0.1],
      [0.4, 0.4],
      [0.1, 0.4],
    ];
    expect(insideOutline(0.2, 0.3, square)).toBe(true);
    expect(insideOutline(0.5, 0.3, square)).toBe(false);
  });

  it('slides a projector across the surface and keeps it on it', () => {
    const flat = quad(-60, 60, -40, 40, 5, 0, 1);
    const moved = slideProjector([flat], { point: [0, 0, 5], normal: [0, 0, 1], up: [0, 1, 0] }, 12, -7)!;
    expect(moved.point[0]).toBeCloseTo(12, 4);
    expect(moved.point[1]).toBeCloseTo(-7, 4);
    expect(moved.point[2]).toBeCloseTo(5, 4);
    expect(slideProjector([flat], { point: [0, 0, 5], normal: [0, 0, 1], up: [0, 1, 0] }, 400, 0)).toBeNull();
  });
});

describe('projection on the garment', () => {
  it('prints a chest graphic on the front panel only, never through to the back', () => {
    // A front-centre point at chest height.
    const j = 60;
    const centre = PANEL * 0 + j * COLS + 32;
    const f = decalFrame(placement(vertex(torso, centre), vnormal(torso, centre), [0, 1, 0], 360, 300));
    const sel = selectTriangles(torso, f);
    expect(sel.triangles.length).toBeGreaterThan(100);
    for (const t of sel.triangles) {
      // Front panel vertices come first in the torso mesh; the back panel's faces point away.
      expect(torso.index[t * 3]).toBeLessThan(PANEL);
    }
    const patches = paintTriangles(torso, sel, gradientArt(360, 300, 1), torsoTex);
    // Nothing on the back panel, which sits at u < 0.5 in the torso texture.
    for (const p of patches) expect(p.x).toBeGreaterThanOrEqual(Math.floor(torsoTex.width * 0.49));
    expect(inkedTexels(patches)).toBeGreaterThan(1000);
  });

  it('runs on round a side seam: both panels take the same artwork pixel at their shared edge', () => {
    // The wearer's right side seam (x < 0) at mid height: front column 0 meets back column 64.
    const j = 48;
    const fa = j * COLS;
    const ba = PANEL + j * COLS + (COLS - 1);
    expect(vertex(torso, fa)).toEqual(vertex(torso, ba));
    const normal = [vnormal(torso, fa), vnormal(torso, ba)].reduce((s, n) => [s[0] + n[0], s[1] + n[1], s[2] + n[2]] as Vec3);
    const f = decalFrame(placement(vertex(torso, fa), normal, [0, 1, 0], 160, 100));
    const sel = selectTriangles(torso, f);
    const frontTris = [...sel.triangles].filter((t) => torso.index[t * 3] < PANEL);
    const backTris = [...sel.triangles].filter((t) => torso.index[t * 3] >= PANEL);
    expect(frontTris.length).toBeGreaterThan(20);
    expect(backTris.length).toBeGreaterThan(20);

    // Every seam vertex pair (same place, one per panel) maps to the same artwork point.
    for (let row = 30; row <= 66; row++) {
      const a = row * COLS;
      const b = PANEL + row * COLS + (COLS - 1);
      for (let k = 0; k < 3; k++) expect(sel.decal[a * 3 + k]).toBeCloseTo(sel.decal[b * 3 + k], 4);
    }

    // In the painted texture, the texels either side of the seam sample the artwork at the same
    // place: their colours (which encode artwork position) agree to within a texel's step.
    const art = gradientArt(160, 100, 2);
    const patches = paintTriangles(torso, sel, art, torsoTex);
    // Rows are about 7.7 mm apart: 44–52 stay inside the 100 mm tall artwork centred on row 48.
    for (let row = 44; row <= 52; row += 2) {
      const uFront = torso.uv[row * COLS * 2] * torsoTex.width;
      const uBack = torso.uv[(PANEL + row * COLS + COLS - 1) * 2] * torsoTex.width;
      const y = Math.floor((1 - torso.uv[row * COLS * 2 + 1]) * torsoTex.height);
      expect(uFront - uBack).toBeGreaterThan(4); // the panels lie apart in the texture
      const front = texel(patches, Math.floor(uFront) + 1, y);
      const back = texel(patches, Math.ceil(uBack) - 2, y);
      expect(front[3]).toBe(255);
      expect(back[3]).toBe(255);
      expect(Math.abs(front[0] - back[0])).toBeLessThanOrEqual(5);
      expect(Math.abs(front[1] - back[1])).toBeLessThanOrEqual(5);
    }
  });

  it('carries a logo over the shoulder onto the sleeve, skipping the sleeve cap tucked inside', () => {
    // A front point high on the wearer's left chest, near the armhole, facing forward and up.
    const v = 90 * COLS + 58;
    const point = vertex(torso, v);
    expect(point[0]).toBeGreaterThan(0);
    const f = decalFrame(placement(point, vnormal(torso, v), [0, 1, 0], 180, 140));
    const parts = [torso, sleeveLeft].map((mesh) => ({ mesh, projected: selectTriangles(mesh, f) }));
    expect(parts[0].projected.triangles.length).toBeGreaterThan(50);
    expect(parts[1].projected.triangles.length).toBeGreaterThan(20);
    const depth = buildDepthMap(parts, f);
    const art = gradientArt(180, 140, 1.5);
    const sleeveTex = { width: Math.round(geo.layout.sleeveCircumferenceMm * 2), height: Math.round(geo.layout.sleeveLengthMm * 2) };
    const onTorso = paintTriangles(torso, parts[0].projected, art, torsoTex, { depth });
    const onSleeve = paintTriangles(sleeveLeft, parts[1].projected, art, sleeveTex, { depth });
    const sleeveAll = paintTriangles(sleeveLeft, parts[1].projected, art, sleeveTex);
    expect(inkedTexels(onTorso)).toBeGreaterThan(500);
    expect(inkedTexels(onSleeve)).toBeGreaterThan(200);
    // Part of the sleeve in the box is hidden inside the body; it gets no ink.
    expect(inkedTexels(onSleeve)).toBeLessThan(inkedTexels(sleeveAll));
    // What was dropped is the cap: the top of the sleeve texture, where it tucks into the armhole.
    const capRows = (geo.layout.sleeveSeamOffsetMm / geo.layout.sleeveLengthMm) * sleeveTex.height;
    let dropped = 0;
    let droppedInCap = 0;
    for (const p of sleeveAll) {
      for (let y = 0; y < p.height; y++) {
        for (let x = 0; x < p.width; x++) {
          if (!p.data[(y * p.width + x) * 4 + 3] || texel(onSleeve, p.x + x, p.y + y)[3]) continue;
          dropped++;
          if (p.y + y < capRows * 1.6) droppedInCap++;
        }
      }
    }
    expect(dropped).toBeGreaterThan(0);
    expect(droppedInCap / dropped).toBeGreaterThan(0.9);
  });

  it('turns zone artwork into a projection and back without moving it', () => {
    const spec = model.zones.front!;
    const at = zoneToUv(model, geo.layout, 'front', spec.printableWidthMm * 0.7, 90);
    const s = surfaceAtUv(torso, at.u, at.v)!;
    expect(s).not.toBeNull();
    expect(Math.hypot(s.uv[0] - at.u, s.uv[1] - at.v)).toBeLessThan(1e-6);
    // Up on the zone is up the garment on the front.
    expect(s.textureUp[1]).toBeGreaterThan(0.95);
    // Back again: along the normal to the cloth, then to zone millimetres.
    const back = surfaceAlong([torso], [s.point[0] + s.normal[0] * 5, s.point[1] + s.normal[1] * 5, s.point[2] + s.normal[2] * 5], s.normal)!;
    const zone = uvToZone(model, geo.layout, 'torso', back.uv[0], back.uv[1])!;
    expect(zone.zoneId).toBe('front');
    expect(zone.xMm).toBeCloseTo(spec.printableWidthMm * 0.7, 1);
    expect(zone.yMm).toBeCloseTo(90, 1);
    expect(angleAbout(textureAxes(torso, back.triangle).up, s.textureUp, back.normal)).toBeCloseTo(0, 0);
  });

  it('measures rotation clockwise as seen from outside', () => {
    // On the front (normal +z), turning up toward the viewer's right (+x) is +90°.
    expect(angleAbout([0, 1, 0], [1, 0, 0], [0, 0, 1])).toBeCloseTo(90, 6);
    expect(angleAbout([0, 1, 0], [-1, 0, 0], [0, 0, 1])).toBeCloseTo(-90, 6);
    // A rotated frame maps the artwork's top-right corner the same way.
    const f = decalFrame(placement([0, 0, 0], [0, 0, 1], [0, 1, 0], 100, 50, 90));
    const q = toDecal(f, [25, 0, 0]);
    expect(q.x).toBeCloseTo(50, 6);
    expect(q.y).toBeCloseTo(0, 6);
  });

  it('drags along the surface, keeping the artwork upright across the chest', () => {
    const start = 60 * COLS + 32;
    const prev = { point: vertex(torso, start), normal: vnormal(torso, start), up: [0, 1, 0] as Vec3 };
    const to = 62 * COLS + 12;
    const next = dragProjector([torso], prev, [0, 0], { point: vertex(torso, to), normal: vnormal(torso, to) });
    expect(next.point).toEqual(vertex(torso, to));
    expect(Math.abs(next.up[0] * next.normal[0] + next.up[1] * next.normal[1] + next.up[2] * next.normal[2])).toBeLessThan(1e-6);
    expect(next.up[1]).toBeGreaterThan(0.95);
    // With a grab offset the centre lands on the cloth, offset from the pointer.
    const offset = dragProjector([torso], prev, [30, 0], { point: vertex(torso, to), normal: vnormal(torso, to) });
    const onCloth = surfaceAlong([torso], offset.point, offset.normal, 5);
    expect(onCloth).not.toBeNull();
    expect(Math.hypot(onCloth!.point[0] - offset.point[0], onCloth!.point[1] - offset.point[1], onCloth!.point[2] - offset.point[2])).toBeLessThan(0.01);
    expect(offset.point[0]).toBeLessThan(vertex(torso, to)[0]);
  });
});
